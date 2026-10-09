import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { proxyRequest } from './helpers/theme-proxy-request.mjs';

const base = new URL('../extensions/pincode-checker/', import.meta.url);
const source = (path) => readFileSync(new URL(path, base), 'utf8');
const script = (name) => source(`blocks/${name}.liquid`).match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/{{[^}]+}}/g, 'test');
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const node = () => ({
  dataset: {}, attributes: new Map(), handlers: {}, hidden: true, textContent: '', value: '', childElementCount: 0,
  addEventListener(name, handler) { this.handlers[name] = handler; },
  setAttribute(name, value) { this.attributes.set(name, value); },
  getAttribute(name) { return this.attributes.get(name) ?? null; },
  removeAttribute(name) { this.attributes.delete(name); },
  getAttribute(name) { return this.attributes.get(name); },
  hasAttribute(name) { return this.attributes.has(name); },
  removeAttribute(name) { this.attributes.delete(name); },
  replaceChildren() { this.childElementCount = 0; }, append() {}, querySelector() { return null; }, querySelectorAll() { return []; }
});

test('executed checker cancels queued policy refresh and rejects an in-flight policy after a successful check', async () => {
  for (const fireBeforeCheck of [false, true]) {
    const nodes = new Map();
    const root = node();
    root.hidden = false;
    root.isConnected = true;
    root.dataset = { productId: '42', surface: 'product', appearanceSource: 'block', unlockPrompt: 'Check postal', checking: 'Checking', showCountdown: 'false', showJourney: 'false' };
    const submit = node();
    const form = { querySelectorAll: () => [submit] };
    const requests = [];
    const timers = new Map();
    let timerId = 0;
    let invalidate;
    const document = {
      ...node(),
      getElementById(id) {
        if (id === 'pin-checker-test') return root;
        if (!nodes.has(id)) nodes.set(id, node());
        return nodes.get(id);
      },
      createDocumentFragment: node, createElement: node
    };
    document.getElementById('pin-country-test').value = 'US';
    document.getElementById('pin-input-test').value = '10001';
    document.getElementById('pin-cart-items-test').textContent = '[]';
    const context = {
      document, URLSearchParams, AbortController, Element: class {},
      MutationObserver: class { observe() {} disconnect() {} },
      setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
      clearTimeout(id) { timers.delete(id); },
      window: { incodeThemeContext: {
        productForm: () => form, productContext: () => ({ variantId: 'gid://shopify/ProductVariant/84', quantity: 3 }),
        productForms: () => [form], purchaseButtons: () => [submit],
        contextKey: () => 'gid://shopify/ProductVariant/84:3', formContextKey: () => 'gid://shopify/ProductVariant/84:3',
        cartUrl: (path) => `/${path}`,
        lockButtons: (_owner, buttons, disabled) => [submit].forEach((button) => {
          if (disabled && buttons.includes(button)) button.dataset.pincodeAtcDisabled = 'true';
          else delete button.dataset.pincodeAtcDisabled;
        }),
        watch: (_root, callback) => { invalidate = callback; }
      } },
      fetch: (url, options) => {
        if (url === '/cart/update.js') return Promise.resolve({ ok: true });
        return new Promise((resolve) => requests.push({ url, options, resolve }));
      }
    };
    context.window.incodeThemeContext.request = proxyRequest(context.fetch);
    vm.runInNewContext(script('delivery-checker'), context);
    requests[0].resolve({ ok: true, json: async () => ({ require_valid_pin: true }) });
    await settle();
    assert.equal(submit.dataset.pincodeAtcDisabled, 'true');
    invalidate();
    assert.equal(timers.size, 1);
    if (fireBeforeCheck) {
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      callback();
    }
    const check = nodes.get('pin-btn-test').handlers.click();
    assert.equal(timers.size, 0, 'runCheck must cancel the pending initPolicy timer');
    if (fireBeforeCheck) assert.equal(requests[1].options.signal.aborted, true);
    const latest = requests.at(-1);
    assert.equal(new URL(latest.url, 'https://shop.test').searchParams.get('qty'), '3');
    latest.resolve({ ok: true, json: async () => ({ available: true, require_valid_pin: true, message: 'Available' }) });
    await check;
    assert.equal(submit.dataset.pincodeAtcDisabled, undefined);
    if (fireBeforeCheck) {
      requests[1].resolve({ ok: true, json: async () => ({ require_valid_pin: true, available: false }) });
      await settle();
    }
    assert.equal(submit.dataset.pincodeAtcDisabled, undefined, 'late policy must not relock a successful check');
    assert.equal(nodes.get('pin-result-test').textContent, 'Available');
    assert.equal(requests.length, fireBeforeCheck ? 3 : 2);
  }
});

test('executed appearance functions apply shared shop controls only in shop mode', () => {
  const style = {
    font_family: 'inter', font_size: 16, heading_size: 21, border_radius: 8,
    text_color: '#123456', accent_color: '#234567', button_color: '#345678', button_text_color: '#456789',
    card_background: '#567890', journey_background: '#678901', journey_active_color: '#789012', show_journey: false
  };
  for (const name of ['delivery-checker', 'estimated-delivery-date']) {
    const code = script(name);
    const start = code.indexOf('    const applyStorefrontStyle =');
    const end = code.indexOf(name === 'delivery-checker' ? '    const productContextParams =' : '    const getSelectedVariantId =', start);
    for (const mode of ['shop', 'block', undefined]) {
      const properties = new Map();
      const journey = { hidden: false };
      const root = { dataset: { appearanceSource: mode, showJourney: 'true' }, style: { setProperty: (name, value) => properties.set(name, value) }, querySelector: (selector) => selector === '.incode-eta__journey' ? journey : null };
      vm.runInNewContext(`${code.slice(start, end)}\napplyStorefrontStyle(style);`, { root, style, fonts: { inter: 'Inter, system-ui, sans-serif' } });
      if (mode === 'block') {
        assert.equal(properties.size, 0);
        assert.equal(root.dataset.showJourney, 'true');
        assert.equal(journey.hidden, false);
      } else if (name === 'delivery-checker') {
        assert.equal(properties.get('--pc-btn'), '#345678');
        assert.equal(properties.get('--pc-card'), '#567890');
        assert.equal(properties.get('--pc-radius'), '8px');
        assert.equal(properties.get('--pc-journey-active'), '#789012');
        assert.equal(root.dataset.showJourney, 'false');
      } else {
        assert.equal(properties.get('--eta-accent'), '#234567');
        assert.equal(properties.get('--eta-card'), '#567890');
        assert.equal(properties.get('--eta-radius'), '8px');
        assert.equal(journey.hidden, true);
      }
    }
    const schema = JSON.parse(source(`blocks/${name}.liquid`).match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
    const setting = schema.settings.find((item) => item.id === 'appearance_source');
    assert.equal(setting.default, 'shop');
    assert.deepEqual(setting.options.map((option) => option.value), ['shop', 'block']);
  }
});

test('executed ETA uses the general fallback on every automatic ETA surface', async () => {
  for (const surface of ['index', 'page', 'product', 'cart']) {
    const root = node();
    root.isConnected = true;
    root.dataset = { surface, productId: surface === 'product' ? '42' : '', appearanceSource: 'block' };
    const nodes = new Map();
    root.querySelector = (selector) => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); };
    nodes.set('.incode-eta__status', { hidden: false, querySelector: () => node() });
    const requests = [];
    const context = {
      document: { getElementById: () => root }, URLSearchParams, AbortController,
      window: { incodeThemeContext: {
        productContext: () => ({ variantId: 'gid://shopify/ProductVariant/84', quantity: 4 }), watch() {},
        cartParams: async (params) => { params.set('cartItems', '[{"productId":"42","variantId":"gid://shopify/ProductVariant/84","quantity":5}]'); }
      } },
      clearTimeout() {},
      fetch: async (url) => { requests.push(url); return { ok: true, json: async () => ({ enabled: true }) }; }
    };
    context.window.incodeThemeContext.request = proxyRequest(context.fetch);
    vm.runInNewContext(script('estimated-delivery-date'), context);
    await settle();
    const params = new URL(requests[0], 'https://shop.test').searchParams;
    assert.equal(params.get('targeted'), null);
    if (surface === 'cart') assert.equal(params.get('surface'), 'cart');
    if (surface === 'product') assert.equal(params.get('qty'), '4');
  }
  assert.match(source('assets/delivery-checker.css'), /\.pin-checker\[hidden\], \.pin-checker \[hidden\]/);
});

test('product resolver uses verified main form outside app section and watches the same context, not recommendations', () => {
  const main = node();
  main.dataset.productId = '42';
  main.id = 'main-product-form';
  const quantity = { value: '4', name: 'quantity', matches: () => true, form: main };
  const variant = { value: '84', name: 'id' };
  main.elements = Object.assign([variant, quantity], { namedItem: (name) => name === 'id' ? variant : quantity });
  main.querySelector = () => null;
  main.closest = () => null;
  main.contains = (target) => target === quantity;
  const recommendation = { ...main, dataset: { productId: '99' }, closest: () => ({}) };
  const local = { querySelectorAll: () => [recommendation] };
  const root = { dataset: { productId: '42', initialVariant: '84' }, closest: () => local, isConnected: true };
  const handlers = new Map();
  let observer;
  const document = { documentElement: {}, dispatchEvent() {}, querySelectorAll: () => [recommendation, main], addEventListener: (name, callback) => handlers.set(name, callback) };
  const window = {};
  vm.runInNewContext(source('assets/delivery-theme-context.js'), {
    document, window, AbortController, Event,
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() {} }
  });
  assert.equal(window.incodeThemeContext.productForm(root), main);
  assert.equal(window.incodeThemeContext.productContext(root).quantity, 4);
  assert.equal(window.incodeThemeContext.productContext(root).variantId, 'gid://shopify/ProductVariant/84');
  let invalidations = 0;
  window.incodeThemeContext.watch(root, () => invalidations++, () => {});
  quantity.value = '5';
  handlers.get('input')({ target: quantity });
  assert.equal(invalidations, 1);
  observer();
  assert.equal(invalidations, 1, 'the observer must not replay an input invalidation after a check starts');
  const otherQuantity = { ...quantity, form: recommendation };
  handlers.get('input')({ target: otherQuantity });
  assert.equal(invalidations, 1);
  variant.value = '85';
  observer();
  assert.equal(invalidations, 2);
  assert.equal(window.incodeThemeContext.productContext(root).variantId, 'gid://shopify/ProductVariant/85');
  document.querySelectorAll = () => [recommendation];
  assert.equal(window.incodeThemeContext.productForm(root), null);
  assert.equal(window.incodeThemeContext.productContext(root).variantId, 'gid://shopify/ProductVariant/84');
  assert.equal(window.incodeThemeContext.productContext(root).quantity, 1);
});

test('product resolver prefers a matching local form and verifies hidden metadata, section JSON and initial variant', () => {
  const root = { dataset: { productId: '42', initialVariant: '84' }, closest: () => local };
  let localForms = [];
  const local = { querySelectorAll: () => localForms };
  const global = node();
  global.dataset.productId = '42';
  global.closest = () => null;
  const window = {};
  vm.runInNewContext(source('assets/delivery-theme-context.js'), { window, Event, document: { dispatchEvent() {}, querySelectorAll: () => [global] } });
  const hidden = node();
  hidden.closest = () => null;
  hidden.querySelector = (selector) => selector.includes('product-id') ? { value: '42' } : { value: '84' };
  localForms = [hidden];
  assert.equal(window.incodeThemeContext.productForm(root), hidden);
  const section = { dataset: { product: JSON.stringify({ id: 42, variants: [{ id: 84 }, { id: 85 }] }) }, querySelectorAll: () => [] };
  const sectionForm = node();
  sectionForm.querySelector = (selector) => selector.includes('product-id') ? null : { value: '85' };
  sectionForm.closest = (selector) => selector.startsWith('.shopify-section') ? section : null;
  localForms = [sectionForm];
  assert.equal(window.incodeThemeContext.productForm(root), sectionForm);
  const fallbackForm = node();
  fallbackForm.closest = () => null;
  let selected = '84';
  fallbackForm.querySelector = (selector) => selector.includes('product-id') ? null : { value: selected };
  localForms = [fallbackForm];
  assert.equal(window.incodeThemeContext.productForm(root), fallbackForm);
  selected = '85';
  assert.equal(window.incodeThemeContext.productForm(root), fallbackForm, 'verified form remains matched after a variant change');
  const wrongProduct = node();
  wrongProduct.dataset.productId = '99';
  wrongProduct.closest = () => null;
  wrongProduct.querySelector = () => ({ value: '84' });
  localForms = [wrongProduct];
  assert.equal(window.incodeThemeContext.productForm(root), global, 'wrong product metadata must not be overridden by variant fallback');
});
