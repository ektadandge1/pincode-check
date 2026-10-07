import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const base = new URL('../extensions/pincode-checker/', import.meta.url);
const source = (path) => readFileSync(new URL(path, base), 'utf8');
const script = (name) => source(`blocks/${name}.liquid`).match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/{{[^}]+}}/g, 'test');
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

const element = () => ({
  dataset: {}, hidden: true, isConnected: true, value: 'US', textContent: '', childElementCount: 0,
  addEventListener() {}, setAttribute() {}, removeAttribute() {}, replaceChildren() {}, append() {},
  querySelector() { return element(); }, querySelectorAll() { return []; }, closest() { return null; }
});

const fixture = (name) => {
  const document = new EventTarget();
  const nodes = new Map();
  const root = element();
  root.hidden = false;
  root.dataset.surface = 'page';
  let initializations = 0;
  root.dataset = new Proxy(root.dataset, { set(target, key, value) {
    if (key === 'initialized' || key === 'pincodeInitialized') initializations++;
    target[key] = value;
    return true;
  } });
  const rootId = name === 'delivery-checker' ? 'pin-checker-test' : name === 'delivery-service-options' ? 'incode-service-card-test' : 'incode-eta-test';
  document.getElementById = (id) => {
    if (id === rootId) return root.isConnected ? root : null;
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  document.querySelectorAll = () => [];
  document.documentElement = element();
  const window = {};
  const context = vm.createContext({
    document, window, Event, URLSearchParams, AbortController, Element: class {},
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 1, clearTimeout() {},
    fetch: async () => ({ ok: true, json: async () => ({ enabled: false }) })
  });
  return { document, window, context, root, count: () => initializations };
};

test('all four blocks defer the helper without suppressing ParserBlockingScript', () => {
  for (const name of ['delivery-checker', 'delivery-service-options', 'estimated-delivery-date', 'delivery-checker-embed']) {
    const liquid = source(`blocks/${name}.liquid`);
    assert.match(liquid, /<script src="{{ 'delivery-theme-context\.js' \| asset_url }}" defer><\/script>/);
    assert.doesNotMatch(liquid, /theme-check-disable.*ParserBlockingScript/);
  }
});

test('extracted block scripts wait for the helper ready event and initialize each root once across duplicate scripts', async () => {
  for (const name of ['delivery-checker', 'delivery-service-options', 'estimated-delivery-date']) {
    const fixtureData = fixture(name);
    const { context, document, window } = fixtureData;
    vm.runInContext(script(name), context);
    vm.runInContext(script(name), context);
    assert.equal(fixtureData.count(), 0, `${name} must not mark its root before dependency readiness`);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    assert.equal(fixtureData.count(), 0);
    vm.runInContext(source('assets/delivery-theme-context.js'), context);
    await settle();
    assert.ok(window.incodeThemeContext);
    assert.equal(fixtureData.count(), 1);
    vm.runInContext(source('assets/delivery-theme-context.js'), context);
    document.dispatchEvent(new Event('incode:theme-context-ready'));
    document.dispatchEvent(new Event('DOMContentLoaded'));
    vm.runInContext(script(name), context);
    await settle();
    assert.equal(fixtureData.count(), 1, `${name} must ignore repeat ready signals and existing helper scripts`);
  }
});

test('DOMContentLoaded is a readiness fallback and detached roots are not initialized', async () => {
  for (const name of ['delivery-checker', 'delivery-service-options', 'estimated-delivery-date']) {
    const data = fixture(name);
    vm.runInContext(script(name), data.context);
    // Model a helper already exported before DOMContentLoaded, without its ready event.
    const other = fixture(name);
    vm.runInContext(source('assets/delivery-theme-context.js'), other.context);
    data.window.incodeThemeContext = other.window.incodeThemeContext;
    data.document.dispatchEvent(new Event('DOMContentLoaded'));
    await settle();
    assert.equal(data.count(), 1);
    const detached = fixture(name);
    vm.runInContext(script(name), detached.context);
    detached.root.isConnected = false;
    vm.runInContext(source('assets/delivery-theme-context.js'), detached.context);
    assert.equal(detached.count(), 0);
  }
});

test('card asset waits for the helper even when scripts arrive out of order, with one shared scanner', () => {
  const document = new EventTarget();
  document.documentElement = element();
  document.querySelectorAll = () => [];
  const window = {};
  let observers = 0;
  const context = vm.createContext({
    document, window, Event,
    MutationObserver: class { constructor() { observers++; } observe() {} },
    setTimeout: () => 1, clearTimeout() {}
  });
  const code = source('assets/delivery-card-eta.js');
  vm.runInContext(code, context);
  vm.runInContext(code, context);
  assert.equal(window.incodeCardEta, undefined);
  assert.equal(observers, 0);
  document.dispatchEvent(new Event('DOMContentLoaded'));
  assert.equal(observers, 0);
  vm.runInContext(source('assets/delivery-theme-context.js'), context);
  assert.equal(typeof window.incodeCardEta, 'function');
  assert.equal(observers, 1);
  vm.runInContext(code, context);
  document.dispatchEvent(new Event('incode:theme-context-ready'));
  assert.equal(observers, 1);
});
