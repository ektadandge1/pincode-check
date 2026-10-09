import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { proxyRequest } from './helpers/theme-proxy-request.mjs';

const base = new URL('../extensions/pincode-checker/', import.meta.url);
const source = (path) => readFileSync(new URL(path, base), 'utf8');
const widgets = [
  ['checker', 'blocks/delivery-checker.liquid', 'pin-checker-', 'pincodeInitialized'],
  ['eta', 'blocks/estimated-delivery-date.liquid', 'incode-eta-', 'initialized'],
  ['product', 'assets/product-delivery-pickup.js', 'product-service-', 'productServiceReady'],
  ['service', 'assets/delivery-service-card.js', 'incode-service-card-', 'initialized'],
];
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

class Element {
  constructor() {
    this.dataset = {};
    this.handlers = new Map();
    this.nodes = new Map();
    this.children = [];
    this.attributes = new Map();
    this.isConnected = true;
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.style = { setProperty() {} };
  }
  addEventListener(name, callback, options = {}) {
    const handlers = this.handlers.get(name) || [];
    handlers.push({ callback, signal: options.signal });
    this.handlers.set(name, handlers);
  }
  emit(name, target = this, extra = {}) {
    const event = { type: name, target, ...extra };
    return Promise.all((this.handlers.get(name) || []).filter(({ signal }) => !signal?.aborted).map(({ callback }) => callback(event)));
  }
  listenerCount(name) { return (this.handlers.get(name) || []).filter(({ signal }) => !signal?.aborted).length; }
  querySelector(selector) {
    if (selector.startsWith('[id="')) return this.querySelector(selector.slice(5, -2));
    if (selector === '[id$="-postal-history"]') return this.children.find((child) => child.id?.endsWith('-postal-history')) || null;
    if (!this.nodes.has(selector)) { const node = new Element(); node.parent = this; this.nodes.set(selector, node); }
    return this.nodes.get(selector);
  }
  querySelectorAll() { return []; }
  contains(node) { return node === this || Boolean(node?.parent && this.contains(node.parent)); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  replaceChildren() { this.children = []; }
  focus() {}
}

const fixture = (widget, deferred = false) => {
  const [kind, path, prefix, marker] = widget;
  const code = path.endsWith('.js') ? source(path) : source(path).match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/{{[^}]+}}/g, 'test');
  const document = new Element();
  document.documentElement = new Element();
  document.createElement = () => new Element();
  document.createDocumentFragment = () => new Element();
  const roots = [];
  document.querySelectorAll = () => roots.filter((root) => root.isConnected);
  document.getElementById = (id) => {
    const root = roots.find((root) => root.isConnected && (root.id === id || id.endsWith(`-${root.key}`)));
    return root ? root.id === id ? root : root.querySelector(id) : null;
  };
  const makeRoot = (key = 'test') => {
    const root = new Element();
    root.key = key;
    root.id = `${prefix}${key}`;
    root.dataset = { surface: 'product', productId: '42', appearanceSource: 'block', country: 'US', showLocal: 'true', showPickup: 'true', showCountdown: 'true', displayMode: 'date,journey,countdown' };
    root.querySelector('pin-country-' + key).value = 'US';
    root.querySelector('pin-input-' + key).value = '10001';
    root.querySelector('select').value = 'US';
    root.querySelector('input').value = '10001';
    root.querySelector('[data-product-country]').value = 'US';
    root.querySelector('[data-product-postal]').value = '10001';
    root.querySelector('.incode-eta__status span:last-child').textContent = 'Calculating';
    root.forms = [new Element(), new Element()];
    root.buttons = root.forms.map((form) => { const button = new Element(); form.append(button); return button; });
    roots.push(root);
    return root;
  };
  const first = makeRoot();
  const requests = [];
  const observers = [];
  const watches = [];
  const timers = new Map();
  let nextTimer = 0;
  const timer = (callback) => { timers.set(++nextTimer, callback); return nextTimer; };
  const window = { setInterval: timer, clearInterval: (id) => timers.delete(id) };
  const helper = {
    productContext: () => ({ variantId: 'gid://shopify/ProductVariant/84', quantity: 2 }),
    contextKey: () => 'gid://shopify/ProductVariant/84:2',
    formContextKey: () => 'gid://shopify/ProductVariant/84:2',
    purchaseButtons: (root) => root.buttons,
    productForms: (root) => root.forms,
    lockButtons: (root, buttons, disabled) => {
      for (const button of root.buttons) {
        if (disabled && buttons.includes(button)) button.dataset.pincodeAtcDisabled = 'true';
        else delete button.dataset.pincodeAtcDisabled;
      }
    },
    releaseEstimate: () => Promise.resolve(),
    expiryDelay: () => 1000,
    cutoffTime: () => Date.now() + 10000,
    postalHistory: (root) => { const list = new Element(); list.id = `${root.id}-postal-history`; root.append(list); },
    watch: (root, invalidate, cleanup) => {
      const events = new AbortController();
      const dispose = () => { events.abort(); cleanup(); };
      const watch = { root, invalidate, dispose, signal: events.signal };
      watches.push(watch);
      document.addEventListener('shopify:section:unload', (event) => { if (event.target.contains(root)) dispose(); }, { signal: events.signal });
      return { signal: events.signal };
    },
  };
  const context = vm.createContext({
    window, document, Element, URLSearchParams, AbortController, Date,
    setTimeout: timer, clearTimeout: (id) => timers.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
  });
  helper.request = proxyRequest(context.fetch);
  const load = () => vm.runInContext(code, context);
  const ready = () => { window.incodeThemeContext = helper; return document.emit('incode:theme-context-ready'); };
  const mutate = () => {
    for (const observer of [...observers]) if (!observer.disconnected) observer.callback([]);
    for (const watch of watches) if (!watch.root.isConnected && !watch.signal.aborted) watch.dispose();
  };
  const button = (root) => root.querySelector(kind === 'checker' ? `pin-btn-${root.key}` : kind === 'product' ? '[data-product-check]' : 'button');
  const status = (root) => root.querySelector(kind === 'checker' ? `pin-result-${root.key}` : kind === 'eta' ? '.incode-eta__status span:last-child' : kind === 'product' ? '[data-product-status]' : '.incode-service-card__status');
  if (!deferred) window.incodeThemeContext = helper;
  load();
  return { kind, marker, first, roots, makeRoot, document, requests, watches, observers, timers, load, ready, mutate, button, status };
};

for (const widget of widgets) {
  test(`${widget[0]}: persistent scanner handles late helper, new IDs and cloned markers exactly once`, async () => {
    const data = fixture(widget, true);
    data.load();
    await data.document.emit('DOMContentLoaded');
    assert.equal(data.first.dataset[data.marker], undefined);
    const late = data.makeRoot('late');
    const detached = data.makeRoot('detached');
    detached.isConnected = false;
    data.mutate();
    assert.equal(data.watches.length, 0);
    await data.ready();
    assert.equal(data.watches.length, 2);
    const observerCount = data.observers.length;
    data.load();
    await data.ready();
    await data.document.emit('shopify:section:load');
    data.mutate();
    assert.equal(data.observers.length, observerCount);
    assert.equal(data.watches.length, 2);
    assert.equal(late.dataset[data.marker], 'true');
    const ajax = data.makeRoot('ajax');
    ajax.dataset[data.marker] = 'true';
    data.mutate();
    data.mutate();
    assert.equal(data.watches.length, 3, 'a cloned marker must not suppress a new element');
    if (data.kind !== 'eta') assert.equal(data.button(ajax).listenerCount('click'), 1);
    assert.equal(detached.dataset[data.marker], undefined);
  });

  test(`${widget[0]}: same-ID AJAX replacement aborts old work and ignores late success and failure`, async () => {
    for (const failure of [false, true]) {
      const data = fixture(widget);
      if (data.kind === 'product' || data.kind === 'service') void data.button(data.first).emit('click');
      const pending = data.requests.at(-1);
      assert.ok(pending);
      data.first.isConnected = false;
      const replacement = data.makeRoot();
      data.mutate();
      assert.equal(pending.options.signal.aborted, true);
      assert.equal(data.first.dataset[data.marker], undefined);
      assert.equal(replacement.dataset[data.marker], 'true');
      assert.equal(data.watches.length, 2);
      if (failure) pending.reject(new Error('Late network failure'));
      else pending.resolve({ ok: true, json: async () => ({ enabled: true, available: true, require_valid_pin: true, message: 'Old result', estimated_date: '2026-10-10' }) });
      await settle();
      assert.notEqual(data.status(replacement).textContent, 'Old result');
      assert.equal(data.timers.size, 0);
      if (data.kind !== 'eta') {
        assert.equal(data.button(data.first).listenerCount('click'), 0);
        assert.equal(data.button(replacement).listenerCount('click'), 1);
      }
    }
  });

  test(`${widget[0]}: unload cleans up while connected and permits explicit section reload`, async () => {
    const data = fixture(widget);
    if (data.kind !== 'eta') void data.button(data.first).emit('click');
    const pending = data.requests.at(-1);
    await data.document.emit('shopify:section:unload', data.first);
    assert.equal(pending.options.signal.aborted, true);
    assert.equal(data.first.dataset[data.marker], undefined);
    assert.equal(data.first.children.length, 0, 'postal history must not accumulate on reinitialization');
    data.mutate();
    data.load();
    assert.equal(data.watches.length, 1, 'an unloaded section must stay inactive until section load');
    await data.document.emit('shopify:section:load', data.first);
    data.mutate();
    assert.equal(data.watches.length, 2);
    assert.equal(data.first.dataset[data.marker], 'true');
    if (data.kind !== 'eta') {
      assert.equal(data.button(data.first).listenerCount('click'), 1);
      assert.equal(data.button(data.first).disabled, false);
    }
  });
}

test('checker ATC guards cover all associated buttons and submits without marked descendants, not unrelated products', async () => {
  const data = fixture(widgets[0]);
  data.requests[0].resolve({ ok: true, json: async () => ({ require_valid_pin: true }) });
  await settle();
  for (const button of data.first.buttons) assert.equal(button.dataset.pincodeAtcDisabled, 'true');
  const guard = async (name, target) => {
    let prevented = false;
    let stopped = false;
    await data.document.emit(name, target, { preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
    return { prevented, stopped };
  };
  for (const form of data.first.forms) {
    assert.deepEqual(await guard('submit', form), { prevented: true, stopped: true });
    form.children = [];
    assert.deepEqual(await guard('submit', form), { prevented: true, stopped: true });
  }
  const child = new Element();
  data.first.buttons[1].append(child);
  assert.deepEqual(await guard('click', child), { prevented: true, stopped: true });
  const dynamicForm = new Element();
  const dynamicButton = new Element();
  dynamicForm.append(dynamicButton);
  data.first.forms.push(dynamicForm);
  data.first.buttons.push(dynamicButton);
  data.mutate();
  assert.equal(dynamicButton.dataset.pincodeAtcDisabled, 'true');
  assert.deepEqual(await guard('submit', dynamicForm), { prevented: true, stopped: true });
  assert.deepEqual(await guard('click', dynamicButton), { prevented: true, stopped: true });
  const unrelated = new Element();
  unrelated.dataset.pincodeAtcDisabled = 'true';
  assert.deepEqual(await guard('click', unrelated), { prevented: false, stopped: false });
  assert.deepEqual(await guard('submit', new Element()), { prevented: false, stopped: false });
  await data.document.emit('shopify:section:unload', data.first);
  assert.deepEqual(await guard('submit', data.first.forms[0]), { prevented: false, stopped: false });
  for (const button of data.first.buttons) assert.equal(button.dataset.pincodeAtcDisabled, undefined);
});

test('checker and ETA unload clear rendered countdown and expiry timers', async () => {
  for (const widget of widgets.slice(0, 2)) {
    const data = fixture(widget);
    if (data.kind === 'checker') {
      data.requests[0].resolve({ ok: true, json: async () => ({ enabled: true }) });
      await settle();
      void data.button(data.first).emit('click');
    }
    data.requests.at(-1).resolve({ ok: true, json: async () => ({
      available: true, estimated_date: '2026-10-10', seconds_until_cutoff: 10,
      delivery_date_range: 'Oct 10 - Oct 12',
    }) });
    await settle();
    assert.equal(data.timers.size, 2, `${data.kind} should have countdown and expiry timers`);
    await data.document.emit('shopify:section:unload', data.first);
    assert.equal(data.timers.size, 0);
    assert.equal(data.watches[0].signal.aborted, true);
  }
});

test('checker policy refresh race keeps a successful check unlocked with the expanded helper contract', async () => {
  for (const fireBeforeCheck of [false, true]) {
    const data = fixture(widgets[0]);
    data.first.dataset.showCountdown = 'false';
    data.requests[0].resolve({ ok: true, json: async () => ({ require_valid_pin: true }) });
    await settle();
    data.watches[0].invalidate();
    assert.equal(data.timers.size, 1);
    if (fireBeforeCheck) {
      const [id, callback] = data.timers.entries().next().value;
      data.timers.delete(id);
      callback();
    }
    void data.button(data.first).emit('click');
    assert.equal(data.timers.size, 0);
    if (fireBeforeCheck) assert.equal(data.requests[1].options.signal.aborted, true);
    data.requests.at(-1).resolve({ ok: true, json: async () => ({ available: true, require_valid_pin: true, message: 'Available' }) });
    await settle();
    if (fireBeforeCheck) {
      data.requests[1].resolve({ ok: true, json: async () => ({ require_valid_pin: true, available: false }) });
      await settle();
    }
    assert.equal(data.status(data.first).textContent, 'Available');
    for (const button of data.first.buttons) assert.equal(button.dataset.pincodeAtcDisabled, undefined);
  }
});

test('service pickup requests cannot update an unloaded or superseded form', async () => {
  for (const unload of [false, true]) {
    for (const failure of [false, true]) {
      const data = fixture(widgets[3]);
      void data.button(data.first).emit('click');
      data.requests[0].resolve({ ok: true, json: async () => ({ available: true, pickup_available: true }) });
      await settle();
      await data.first.querySelector('[data-service-pickup]').emit('click');
      const pending = data.requests[1];
      assert.ok(pending);
      const formStatus = data.first.querySelector('[data-service-pickup-form-status]');
      if (unload) await data.document.emit('shopify:section:unload', data.first);
      else await data.first.querySelector('input').emit('input');
      const oldStatus = formStatus.textContent;
      assert.equal(pending.options.signal.aborted, true);
      if (failure) pending.reject(new Error('Late pickup failure'));
      else pending.resolve({ ok: true, json: async () => ({ pickup_locations: [], message: 'Stale pickup result' }) });
      await settle();
      assert.equal(formStatus.textContent, oldStatus);
    }
  }
});

test('mobile date clipping override stays inline and permits wrapping', () => {
  const liquid = source('blocks/delivery-checker.liquid');
  assert.match(liquid.match(/<style>([\s\S]*?)<\/style>/)[1], /@media \(max-width: 520px\)[\s\S]*small::after\s*\{\s*white-space:normal; overflow-wrap:anywhere;/);
});
