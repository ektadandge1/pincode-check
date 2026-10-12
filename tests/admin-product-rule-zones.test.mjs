import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { injectedServer } from "./helpers/injected-server.mjs";

const source = readFileSync(new URL("../app/routes/app.delivery-settings.tsx", import.meta.url), "utf8");
const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
};
const compiledRoute = ts.transpileModule(source, { compilerOptions, fileName: "app.delivery-settings.tsx" }).outputText;
const shop = "admin-zones.myshopify.com";
const foreignShop = "foreign-zones.myshopify.com";
const zone = (id, overrides = {}) => ({ id, shop, name: `Zone ${id}`, country: "US", enabled: true, ...overrides });
const defaultZones = [zone(2), zone(7), zone(10), zone(11, { enabled: false }), zone(12, { shop: foreignShop })];
const params = {
  intent: "create_target", targetName: "Collection A", targetKind: "collection", targetValue: "collection-a",
  targetZoneIdsCsv: "7", targetPriority: "100", targetRequireValidPin: "on",
  targetProcessingDays: "1", targetTransitDays: "2", targetInventoryMode: "any", targetActivationMode: "always",
};
const expectedData = {
  shop, name: "Collection A", targetKind: "collection", targetValue: "collection-a", zoneIdsCsv: "7",
  countryCode: null, stateRegion: null, inventoryMode: "any", customSuccessMessage: null,
  activationMode: "always", activeFromLocal: null, activeUntilLocal: null, weekdaysCsv: "",
  startTimeLocal: null, endTimeLocal: null, requireValidPin: true, processingDays: 1, transitDays: 2,
  excluded: false, priority: 100,
};
const existingTarget = (overrides = {}) => ({ id: 41, ...expectedData, enabled: true, ...overrides });
const invalidSelection = "Select up to 100 valid delivery zones, or leave the selection empty for all zones.";
const unavailableSelection = "One or more selected zones are disabled or unavailable. Remove them or choose enabled zones from this store.";

function actionFixture({ zones = defaultZones, targets = [], writeError = null, targeting = true } = {}) {
  const records = structuredClone(targets);
  const calls = { auth: [], access: [], zones: [], reads: [], writes: [], invalidations: [], events: [] };
  const admin = {};
  const load = injectedServer({});
  const plans = load("app/services/plans.server.ts");
  const access = { ...plans.accessForPlan("standard"), features: { ...plans.STANDARD_FEATURES, targeting } };
  const prisma = {
    zone: {
      count: async (args) => {
        calls.zones.push(structuredClone(args));
        const { where } = args;
        return zones.filter((item) => item.shop === where.shop && item.enabled === where.enabled && where.id.in.includes(item.id)).length;
      },
    },
    deliveryTarget: {
      findUnique: async (args) => {
        calls.reads.push({ method: "findUnique", ...structuredClone(args) });
        const { shop: owner, name } = args.where.shop_name;
        return records.find((item) => item.shop === owner && item.name === name) ?? null;
      },
      findFirst: async (args) => {
        calls.reads.push({ method: "findFirst", ...structuredClone(args) });
        return records.find((item) => item.id === args.where.id && item.shop === args.where.shop) ?? null;
      },
      create: async (args) => {
        calls.writes.push({ method: "create", ...structuredClone(args) });
        if (writeError) throw writeError;
        const record = { id: Math.max(0, ...records.map((item) => item.id)) + 1, ...args.data };
        records.push(record);
        calls.events.push("create");
        return record;
      },
      update: async (args) => {
        calls.writes.push({ method: "update", ...structuredClone(args) });
        if (writeError) throw writeError;
        const record = records.find((item) => item.id === args.where.id);
        assert.ok(record, "update must address an existing record");
        Object.assign(record, args.data);
        calls.events.push("update");
        return record;
      },
    },
  };
  const mocks = {
    "../db.server": prisma,
    "../services/billing.server": { requireActiveBilling: async (request) => {
      calls.auth.push(request);
      return { admin, session: { shop } };
    } },
    "../services/plan-access.server": { resolvePlanAccess: async (args) => { calls.access.push(args); return access; } },
    "../services/plans.server": plans,
    "../services/delivery-checker.server": { clearDeliveryCheckCaches: (owner) => {
      calls.invalidations.push(owner);
      calls.events.push("invalidate");
    } },
    "../services/postal-code-importer.server": {},
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiledRoute)((specifier) => {
    if (specifier in mocks) return mocks[specifier];
    if (["react", "react-router", "react/jsx-runtime", "@shopify/polaris"].includes(specifier)) return {};
    if (specifier.startsWith("../utils/")) return load(`app/utils/${specifier.slice("../utils/".length)}.ts`);
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return {
    calls, records,
    submit: async (overrides = {}) => {
      const request = new Request("https://fixture.test/app/delivery-settings", {
        method: "POST", body: new URLSearchParams({ ...params, ...overrides }),
      });
      const result = await module.exports.action({ request });
      assert.equal(calls.auth.at(-1), request);
      assert.deepEqual(calls.access.at(-1), { shop, admin });
      return result;
    },
  };
}

test("actual action creates three independent collection rules in the same zone with distinct timing", async () => {
  const f = actionFixture();
  for (let index = 0; index < 3; index += 1) {
    const name = `Collection ${String.fromCharCode(65 + index)}`;
    const value = `collection-${String.fromCharCode(97 + index)}`;
    assert.deepEqual(await f.submit({
      targetName: name, targetValue: value, targetProcessingDays: String(index + 1), targetTransitDays: String((index + 1) * 2),
      shop: foreignShop,
    }), { ok: true, message: `Targeting rule "${name}" created for collection ${value}.`, intent: "create_target" });
    assert.deepEqual(f.calls.writes[index], { method: "create", data: {
      ...expectedData, name, targetValue: value, processingDays: index + 1, transitDays: (index + 1) * 2, enabled: true,
    } });
  }
  assert.deepEqual(f.records.map(({ id, name, zoneIdsCsv, processingDays, transitDays }) => ({ id, name, zoneIdsCsv, processingDays, transitDays })), [
    { id: 1, name: "Collection A", zoneIdsCsv: "7", processingDays: 1, transitDays: 2 },
    { id: 2, name: "Collection B", zoneIdsCsv: "7", processingDays: 2, transitDays: 4 },
    { id: 3, name: "Collection C", zoneIdsCsv: "7", processingDays: 3, transitDays: 6 },
  ]);
  assert.deepEqual(f.calls.zones, Array.from({ length: 3 }, () => ({ where: { shop, enabled: true, id: { in: [7] } } })));
  assert.deepEqual(f.calls.invalidations, [shop, shop, shop]);
  assert.deepEqual(f.calls.events, ["create", "invalidate", "create", "invalidate", "create", "invalidate"]);
});

test("actual action trims, deduplicates and numerically sorts multiple zones", async () => {
  const f = actionFixture();
  assert.equal((await f.submit({ targetZoneIdsCsv: " 10, 2 ,7,10, 2 " })).ok, true);
  assert.deepEqual(f.calls.zones, [{ where: { shop, enabled: true, id: { in: [10, 2, 7] } } }]);
  assert.deepEqual(f.calls.writes, [{ method: "create", data: { ...expectedData, zoneIdsCsv: "2,7,10", enabled: true } }]);
  assert.deepEqual(f.calls.invalidations, [shop]);
});

for (const csv of ["", "   "]) {
  test(`actual action saves ${JSON.stringify(csv)} as unrestricted all zones without querying zones`, async () => {
    const f = actionFixture();
    assert.equal((await f.submit({ targetZoneIdsCsv: csv })).ok, true);
    assert.deepEqual(f.calls.writes, [{ method: "create", data: { ...expectedData, zoneIdsCsv: "", enabled: true } }]);
    assert.deepEqual(f.calls.zones, []);
    assert.deepEqual(f.calls.invalidations, [shop]);
  });
}

test("actual action accepts exactly 100 distinct zones and deduplicates before applying the limit", async () => {
  const zones = Array.from({ length: 100 }, (_, index) => zone(index + 1));
  const f = actionFixture({ zones });
  const reversed = zones.toReversed().map((item) => item.id).join(",");
  assert.equal((await f.submit({ targetZoneIdsCsv: `${reversed},100,1` })).ok, true);
  assert.equal(f.records[0].zoneIdsCsv, zones.map((item) => item.id).join(","));
  assert.equal(f.calls.zones[0].where.id.in.length, 100);
  assert.deepEqual(f.calls.invalidations, [shop]);
});

test("actual edit changes then clears zones without losing geography, inventory, schedule, timing or disabled status", async () => {
  const preserved = {
    countryCode: "US", stateRegion: "NY", inventoryMode: "in_stock", activationMode: "weekly",
    weekdaysCsv: "1,3,5", startTimeLocal: "09:00", endTimeLocal: "17:00",
    customSuccessMessage: "Arrives in {transit_days} days", requireValidPin: false, excluded: true,
    processingDays: 3, transitDays: 6, priority: 8,
  };
  const f = actionFixture({ targets: [existingTarget({ ...preserved, enabled: false })] });
  const editParams = {
    intent: "update_target", targetId: "41", targetCountryCode: "us", targetStateRegion: "NY", targetInventoryMode: "in_stock",
    targetActivationMode: "weekly", targetWeekdaysCsv: "5,1,3,1", targetStartTimeLocal: "09:00", targetEndTimeLocal: "17:00",
    targetCustomSuccessMessage: preserved.customSuccessMessage, targetRequireValidPin: "", targetExcluded: "on",
    targetProcessingDays: "3", targetTransitDays: "6", targetPriority: "8",
  };
  for (const [raw, canonical] of [["10, 2,10", "2,10"], ["", ""]]) {
    assert.deepEqual(await f.submit({ ...editParams, targetZoneIdsCsv: raw }), {
      ok: true, message: 'Targeting rule "Collection A" updated for collection collection-a.', intent: "update_target",
    });
    assert.deepEqual(f.calls.writes.at(-1), {
      method: "update", where: { id: 41 }, data: { ...expectedData, ...preserved, zoneIdsCsv: canonical },
    });
    assert.deepEqual(f.records, [existingTarget({ ...preserved, enabled: false, zoneIdsCsv: canonical })]);
  }
  assert.deepEqual(f.calls.reads, Array.from({ length: 2 }, () => [
    { method: "findUnique", where: { shop_name: { shop, name: "Collection A" } } },
    { method: "findFirst", where: { id: 41, shop } },
  ]).flat());
  assert.deepEqual(f.calls.zones, [{ where: { shop, enabled: true, id: { in: [10, 2] } } }]);
  assert.deepEqual(f.calls.invalidations, [shop, shop]);
  assert.deepEqual(f.calls.events, ["update", "invalidate", "update", "invalidate"]);
});

const badSelections = [
  ["disabled zone", "11", unavailableSelection],
  ["deleted zone", "13", unavailableSelection],
  ["foreign zone", "12", unavailableSelection],
  ["mixed owned/foreign", "7,12", unavailableSelection],
  ["mixed enabled/disabled", "7,11", unavailableSelection],
  ["zero", "0", invalidSelection], ["negative", "-7", invalidSelection],
  ["leading zero", "07", invalidSelection], ["decimal", "7.0", invalidSelection],
  ["fraction", "7.5", invalidSelection], ["exponent", "7e0", invalidSelection],
  ["plus sign", "+7", invalidSelection], ["letters", "seven", invalidSelection],
  ["leading comma", ",7", invalidSelection], ["trailing comma", "7,", invalidSelection],
  ["empty token", "7,,2", invalidSelection], ["whitespace token", "7, ,2", invalidSelection],
  ["alternate separator", "7|2", invalidSelection], ["JSON", '["7"]', invalidSelection],
  ["mixed malformed", "7,nope", invalidSelection], ["NaN", "NaN", invalidSelection],
  ["infinity", "Infinity", invalidSelection], ["unsafe integer", "9007199254740992", invalidSelection],
  ["overflowing integer", "9".repeat(400), invalidSelection],
  ["over 100 distinct zones", Array.from({ length: 101 }, (_, index) => index + 1).join(","), invalidSelection],
  ["over 2000 raw characters despite duplicates", Array.from({ length: 1001 }, () => "7").join(","), invalidSelection],
];

for (const [label, csv, message] of badSelections) {
  for (const intent of ["create_target", "update_target"]) {
    test(`actual ${intent} rejects ${label} without mutations or invalidation`, async () => {
      const f = actionFixture({ targets: [existingTarget({ name: "Existing", zoneIdsCsv: "2,7" })] });
      const before = structuredClone(f.records);
      assert.deepEqual(await f.submit({ intent, targetId: "41", targetZoneIdsCsv: csv }), { ok: false, message });
      assert.deepEqual(f.records, before);
      assert.deepEqual(f.calls.writes, []);
      assert.deepEqual(f.calls.invalidations, []);
      assert.deepEqual(f.calls.events, []);
      assert.deepEqual(f.calls.reads, []);
      assert.deepEqual(f.calls.zones, message === invalidSelection ? [] : [{
        where: { shop, enabled: true, id: { in: csv.split(",").map(Number) } },
      }]);
    });
  }
}

for (const [label, overrides, targets, message] of [
  ["duplicate name", {}, [existingTarget()], "A targeting rule with this name already exists."],
  ["foreign target", { intent: "update_target", targetId: "41" }, [existingTarget({ shop: foreignShop })], "Targeting rule not found."],
  ["deleted target", { intent: "update_target", targetId: "42" }, [existingTarget({ name: "Existing" })], "Targeting rule not found."],
  ["invalid timing", { targetTransitDays: "61" }, [], "ETA override days must be integers from 0 to 60, or left blank."],
]) {
  test(`actual save rejects ${label} with no writes or invalidation`, async () => {
    const f = actionFixture({ targets });
    const before = structuredClone(f.records);
    assert.deepEqual(await f.submit(overrides), { ok: false, message });
    assert.deepEqual(f.records, before);
    assert.deepEqual(f.calls.writes, []);
    assert.deepEqual(f.calls.invalidations, []);
  });
}

test("a failed database write propagates and never invalidates or changes persisted rules", async () => {
  const error = new Error("database unavailable");
  for (const intent of ["create_target", "update_target"]) {
    const f = actionFixture({ writeError: error, targets: [existingTarget({ name: "Existing" })] });
    const before = structuredClone(f.records);
    await assert.rejects(f.submit({ intent, targetId: "41" }), (caught) => caught === error);
    assert.equal(f.calls.writes.length, 1);
    assert.deepEqual(f.records, before);
    assert.deepEqual(f.calls.invalidations, []);
    assert.deepEqual(f.calls.events, []);
  }
});

test("targeting feature enforcement prevents reads, mutations and invalidation", async () => {
  const f = actionFixture({ targeting: false });
  await assert.rejects(f.submit(), (error) => error instanceof Response && error.status === 402);
  assert.deepEqual(f.calls.zones, []);
  assert.deepEqual(f.calls.reads, []);
  assert.deepEqual(f.calls.writes, []);
  assert.deepEqual(f.calls.invalidations, []);
});

// Extract actual nodes rather than reproducing UI logic in a test-only component.
const ast = ts.createSourceFile("app.delivery-settings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function sourceNode(predicate) {
  const matches = [];
  const visit = (node) => { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); };
  visit(ast);
  assert.equal(matches.length, 1, "source extraction must identify exactly one node");
  return matches[0];
}
const declaration = (name) => sourceNode((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === name).parent.parent.getText(ast);
const classNode = (name) => sourceNode((node) => ts.isJsxElement(node) && node.openingElement.attributes.properties.some(
  (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "className" && attribute.initializer?.text === name,
));
const pickerNode = sourceNode((node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "input"
  && node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "name" && attribute.initializer?.text === "targetZoneIdsCsv")).parent;
const jsx = (type, props, key) => ({ type, props, key });
const components = {
  BlockStack: "BlockStack", InlineStack: "InlineStack", Tag: "Tag", Button: "Button", Text: "Text", Badge: "Badge",
  Autocomplete: Object.assign(() => {}, { TextField: "Autocomplete.TextField" }),
};
function execute(code, bindings) {
  const compiled = ts.transpileModule(code, { compilerOptions, fileName: "extracted.tsx" }).outputText;
  return new Function("require", "exports", ...Object.keys(bindings), compiled)((specifier) => {
    assert.equal(specifier, "react/jsx-runtime");
    return { jsx, jsxs: jsx };
  }, {}, ...Object.values(bindings));
}
function descendants(tree, predicate) {
  const found = [];
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object" || !node.props) return;
    if (predicate(node)) found.push(node);
    visit(node.props.children);
  };
  visit(tree);
  return found;
}
const text = (node) => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : node == null || typeof node === "boolean" ? "" : String(node);
const only = (tree, predicate) => {
  const matches = descendants(tree, predicate);
  assert.equal(matches.length, 1);
  return matches[0];
};
const zoneDeclarations = ["selectedTargetZones", "targetZoneOptions", "visibleTargetZones", "targetZonesLabel"].map(declaration).join("\n");

function uiFixture({ csv = "7", zones = defaultZones.filter((item) => item.shop === shop), busy = false } = {}) {
  let targetForm = { ...expectedData, kind: "collection", value: "collection-a", zoneIdsCsv: csv, processingDays: "1", transitDays: "2" };
  let targetZoneSearch = "";
  const bindings = {
    ...components, data: { zones, products: [] }, MAX_TARGET_ZONES: 100, pageBusy: busy, isAdvanced: true,
    setTargetForm: (next) => { targetForm = typeof next === "function" ? next(targetForm) : next; },
    setTargetZoneSearch: (next) => { targetZoneSearch = next; },
  };
  const context = () => ({ ...bindings, targetForm, targetZoneSearch });
  return {
    bindings, context,
    get form() { return targetForm; },
    get search() { return targetZoneSearch; },
    picker: () => execute(`${zoneDeclarations}\nreturn (${pickerNode.getText(ast)});`, context()),
    preview: () => execute(`${zoneDeclarations}\nreturn (${classNode("incode-rule-preview").getText(ast)});`, { ...context(), productSearch: "" }),
    cards: (targets) => execute(`${zoneDeclarations}\n${declaration("weekdayLabels")}\n${declaration("targetCards")}\nreturn targetCards;`, {
      ...context(), data: { ...bindings.data, targets }, compactCollectionName: (value) => value,
      editTarget: () => {}, fetcher: { Form: "Form" }, isIntentSaving: () => false,
    }),
  };
}

test("actual JSX uses a controlled searchable multi-select and one hidden canonical CSV, not the search text", () => {
  const f = uiFixture({ csv: "7,10" });
  let picker = f.picker();
  let autocomplete = only(picker, (node) => node.type === components.Autocomplete);
  assert.equal(autocomplete.props.allowMultiple, true);
  assert.deepEqual(autocomplete.props.selected, ["7", "10"]);
  assert.deepEqual(autocomplete.props.options.map((item) => item.value), ["2", "7", "10"]);
  assert.equal(autocomplete.props.textField.props.value, "");
  autocomplete.props.textField.props.onChange("  zOnE 2  ");
  picker = f.picker();
  autocomplete = only(picker, (node) => node.type === components.Autocomplete);
  assert.equal(autocomplete.props.textField.props.value, "  zOnE 2  ");
  assert.deepEqual(autocomplete.props.options.map((item) => item.value), ["2", "7", "10"]);
  assert.deepEqual(autocomplete.props.selected, ["7", "10"]);
  assert.deepEqual(only(picker, (node) => node.type === "input").props, { type: "hidden", name: "targetZoneIdsCsv", value: "7,10" });
  autocomplete.props.onSelect(["10", "2", "10"]);
  picker = f.picker();
  assert.equal(f.form.zoneIdsCsv, "10,2");
  assert.equal(f.form.processingDays, "1");
  assert.equal(f.form.transitDays, "2");
  assert.deepEqual(only(picker, (node) => node.type === components.Autocomplete).props.selected, ["10", "2"]);
  assert.equal(only(picker, (node) => node.type === "input").props.value, "10,2");
  autocomplete.props.textField.props.onClearButtonClick();
  assert.equal(f.search, "");
  assert.equal(f.form.zoneIdsCsv, "10,2");
});

test("actual picker filters unselected search results, keeps disabled selections visible and labels unavailable zones", () => {
  const f = uiFixture({ csv: "7,11,13" });
  const autocomplete = only(f.picker(), (node) => node.type === components.Autocomplete);
  autocomplete.props.textField.props.onChange("does not exist");
  const picker = f.picker();
  assert.deepEqual(only(picker, (node) => node.type === components.Autocomplete).props.options, [
    { label: "Zone 7 (US)", value: "7", disabled: false },
    { label: "Zone 11 (US) - disabled", value: "11", disabled: true },
  ]);
  assert.deepEqual(descendants(picker, (node) => node.type === "Tag").map(text), ["Zone 7", "Zone 11 (disabled)", "Unavailable zone #13"]);
  assert.equal(only(picker, (node) => node.type === "input").props.value, "7,11,13");
});

test("actual removable tags and clear selection update the hidden CSV and live preview without altering timing", () => {
  const f = uiFixture({ csv: "2,7,10" });
  const before = { ...f.form };
  assert.equal(text(only(f.preview(), (node) => node.props.className === "incode-rule-preview__facts")), "Zone 2, Zone 7, Zone 101 prep days2PIN required");
  const tags = descendants(f.picker(), (node) => node.type === "Tag");
  tags[1].props.onRemove();
  assert.deepEqual(f.form, { ...before, zoneIdsCsv: "2,10" });
  assert.deepEqual(descendants(f.picker(), (node) => node.type === "Tag").map(text), ["Zone 2", "Zone 10"]);
  assert.equal(only(f.picker(), (node) => node.type === "input").props.value, "2,10");
  only(f.picker(), (node) => node.type === "Button" && text(node) === "Clear selection").props.onClick();
  assert.deepEqual(f.form, { ...before, zoneIdsCsv: "" });
  assert.deepEqual(descendants(f.picker(), (node) => node.type === "Tag"), []);
  assert.equal(only(f.picker(), (node) => node.type === "input").props.value, "");
  assert.equal(text(only(f.picker(), (node) => node.type === "Text")), "Applies to all zones.");
  assert.equal(text(only(f.preview(), (node) => node.props.className === "incode-rule-preview__facts")), "All zones1 prep days2PIN required");
});

test("actual picker enforces 100 selections and blocks tag removal while saving", () => {
  const f = uiFixture();
  const before = { ...f.form };
  only(f.picker(), (node) => node.type === components.Autocomplete).props.onSelect(Array.from({ length: 101 }, (_, index) => String(index + 1)));
  assert.deepEqual(f.form, before);
  const busy = uiFixture({ csv: "2,7", busy: true });
  const picker = busy.picker();
  assert.equal(only(picker, (node) => node.type === components.Autocomplete).props.textField.props.disabled, true);
  assert.deepEqual(descendants(picker, (node) => node.type === "Tag").map((node) => node.props.onRemove), [undefined, undefined]);
  assert.equal(only(picker, (node) => node.type === "Button").props.disabled, true);
});

test("actual edit handler retains all restrictions, cancels dirty edits, and reset clears selection and searches", () => {
  const f = uiFixture({ csv: "" });
  const initial = { ...f.form };
  const baseline = { current: initial };
  let editingId = null;
  let productSearch = "stale search";
  let confirmations = 0;
  const scrolls = [];
  const bindings = {
    ...f.context(), targetBaseline: baseline, emptyTargetForm: { current: initial },
    setEditingTargetId: (id) => { editingId = id; }, setProductSearch: (value) => { productSearch = value; },
    window: { confirm: () => { confirmations += 1; return false; } },
    document: { getElementById: (id) => ({ scrollIntoView: (options) => scrolls.push({ id, options }) }) },
  };
  const target = existingTarget({ zoneIdsCsv: "7,11,13", countryCode: "US", stateRegion: "NY", inventoryMode: "backorder",
    activationMode: "date_range", activeFromLocal: "2026-10-10", activeUntilLocal: "2026-10-20", customSuccessMessage: "Special delivery", excluded: true });
  const edit = () => execute(`${declaration("editTarget")}\nreturn editTarget;`, { ...bindings, targetForm: f.form });
  edit()(target);
  const draft = {
    name: "Collection A", kind: "collection", value: "collection-a", zoneIdsCsv: "7,11,13", priority: "100",
    requireValidPin: true, processingDays: "1", transitDays: "2", excluded: true,
    countryCode: "US", stateRegion: "NY", inventoryMode: "backorder", customSuccessMessage: "Special delivery",
    activationMode: "date_range", activeFromLocal: "2026-10-10", activeUntilLocal: "2026-10-20",
    weekdaysCsv: "1,2,3,4,5", startTimeLocal: "09:00", endTimeLocal: "17:00",
  };
  assert.deepEqual(f.form, draft);
  assert.equal(baseline.current, f.form);
  assert.equal(editingId, 41);
  assert.equal(productSearch, "");
  assert.equal(f.search, "");
  assert.equal(confirmations, 0);
  assert.deepEqual(scrolls, [{ id: "targeting", options: { behavior: "smooth" } }]);
  f.bindings.setTargetForm((current) => ({ ...current, zoneIdsCsv: "2" }));
  edit()(existingTarget({ id: 42 }));
  assert.equal(confirmations, 1);
  assert.deepEqual(f.form, { ...draft, zoneIdsCsv: "2" });
  assert.equal(editingId, 41);
  assert.deepEqual(baseline.current, draft);
  f.bindings.setTargetZoneSearch("stale zone search");
  execute(`${declaration("resetTargetForm")}\nresetTargetForm();`, bindings);
  assert.equal(editingId, null);
  assert.equal(productSearch, "");
  assert.equal(f.search, "");
  assert.equal(baseline.current, initial);
  assert.deepEqual(f.form, {
    name: "", kind: "product", value: "", zoneIdsCsv: "", priority: "100", requireValidPin: true,
    processingDays: "", transitDays: "", excluded: false, countryCode: "", stateRegion: "", inventoryMode: "any",
    customSuccessMessage: "", activationMode: "always", activeFromLocal: "", activeUntilLocal: "",
    weekdaysCsv: "1,2,3,4,5", startTimeLocal: "09:00", endTimeLocal: "17:00",
  });
});

test("successful target saves reset the draft but failed or pending saves retain its zone restrictions", () => {
  const effect = sourceNode((node) => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes('fetcher.data.intent === "create_target"')).arguments[0].getText(ast);
  for (const [state, data, expected] of [
    ["idle", { ok: true, intent: "create_target" }, 1], ["idle", { ok: true, intent: "update_target" }, 1],
    ["idle", { ok: false, intent: "update_target" }, 0], ["submitting", { ok: true, intent: "create_target" }, 0],
    ["idle", { ok: true, intent: "save_settings" }, 0],
  ]) {
    let resets = 0;
    execute(`(${effect})();`, { fetcher: { state, data }, resetTargetForm: () => { resets += 1; } });
    assert.equal(resets, expected, `${state} ${JSON.stringify(data)}`);
  }
});

test("actual saved cards summarize each rule's own zones, geography, schedule and distinct days", () => {
  const f = uiFixture({ csv: "2" });
  const targets = [
    existingTarget({ id: 1, name: "Collection A", zoneIdsCsv: "7", countryCode: "US", stateRegion: "NY" }),
    existingTarget({ id: 2, name: "Collection B", zoneIdsCsv: "2,10", processingDays: 2, transitDays: 4, inventoryMode: "in_stock" }),
    existingTarget({ id: 3, name: "Collection C", zoneIdsCsv: "", processingDays: 3, transitDays: 6, activationMode: "weekly", weekdaysCsv: "1,3", startTimeLocal: "09:00", endTimeLocal: "17:00" }),
    existingTarget({ id: 4, name: "Unavailable", zoneIdsCsv: "11,13" }),
  ];
  const cards = f.cards(targets);
  const summaries = cards.map((card) => Object.fromEntries(
    only(card, (node) => node.props.className === "incode-target-card__grid").props.children.map((node) => node.props.children.map(text)),
  ));
  assert.deepEqual(summaries, [
    { Matches: "collection-a", Geography: "US / NY", Zones: "Zone 7", Inventory: "any", Schedule: "Always", Behavior: "Included \u00b7 Lock ATC \u00b7 1d prep \u00b7 2d transit", Message: "Global message" },
    { Matches: "collection-a", Geography: "All countries", Zones: "Zone 2, Zone 10", Inventory: "in stock", Schedule: "Always", Behavior: "Included \u00b7 Lock ATC \u00b7 2d prep \u00b7 4d transit", Message: "Global message" },
    { Matches: "collection-a", Geography: "All countries", Zones: "All zones", Inventory: "any", Schedule: "Mon, Wed 09:00-17:00", Behavior: "Included \u00b7 Lock ATC \u00b7 3d prep \u00b7 6d transit", Message: "Global message" },
    { Matches: "collection-a", Geography: "All countries", Zones: "Zone 11 (disabled), Unavailable zone #13", Inventory: "any", Schedule: "Always", Behavior: "Included \u00b7 Lock ATC \u00b7 1d prep \u00b7 2d transit", Message: "Global message" },
  ]);
  assert.deepEqual(cards.map((card) => text(only(card, (node) => node.type === "Text" && node.props.as === "h3"))), targets.map((target) => target.name));
});
