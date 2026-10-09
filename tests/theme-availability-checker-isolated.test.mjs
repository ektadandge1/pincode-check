import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { proxyRequest } from './helpers/theme-proxy-request.mjs';

const base = new URL('../extensions/pincode-checker/', import.meta.url);
const source = (path) => readFileSync(new URL(path, base), 'utf8');
const code = source('assets/availability-checker.js');
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const element = (value = '') => ({
  value, disabled: false, textContent: '', dataset: {}, handlers: {}, children: [],
  setAttribute(name, value) { this[name] = value; },
  append(...items) { this.children.push(...items); },
  replaceChildren(fragment) { this.children = fragment.children; },
  addEventListener(name, handler) { (this.handlers[name] ||= []).push(handler); },
  fire(name, event = {}) { return Promise.all((this.handlers[name] || []).map((handler) => handler(event))); },
  focus() { this.focused = true; }
});

const fixture = ({ surface = 'product', deferred = false, cart = [{ product_id: 42, variant_id: 84, quantity: 7 }] } = {}) => {
  const document = new EventTarget();
  document.readyState = 'complete';
  document.documentElement = {};
  document.createElement = () => element();
  document.createDocumentFragment = () => element();
  const nodes = new Map([
    ['select', element('CA')], ['input', element('K1A 0B1')],
    ['button', element()], ['.incode-availability__status', element()]
  ]);
  const root = { ...element(), dataset: { surface, productId: '42', initialVariant: '84' }, isConnected: true, querySelector: (selector) => nodes.get(selector) };
  const roots = [root];
  document.querySelectorAll = () => roots.filter((entry) => !entry.dataset.ready);
  const window = { Shopify: { routes: { root: '/fr/' } } };
  const requests = [];
  let observers = 0;
  let watches = 0;
  let invalidate;
  let cleanup;
  const product = { variantId: 'gid://shopify/ProductVariant/84', quantity: 2 };
  const context = vm.createContext({
    document, window, Event, URLSearchParams, AbortController,
    MutationObserver: class { constructor() { observers++; } observe() {} },
    fetch: (url, options) => {
      if (url === '/fr/cart.js') {
        requests.push({ url, options });
        return Promise.resolve({ ok: true, json: async () => ({ items: cart }) });
      }
      return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
    }
  });
  const loadHelper = () => {
    const dispatch = document.dispatchEvent;
    document.dispatchEvent = () => true;
    vm.runInContext(source('assets/delivery-theme-context.js'), context);
    document.dispatchEvent = dispatch;
    window.incodeThemeContext.productContext = () => product;
    window.incodeThemeContext.request = proxyRequest(context.fetch);
    window.incodeThemeContext.watch = (_root, callback, dispose) => {
      watches++;
      invalidate = callback;
      cleanup = dispose;
      return {};
    };
    document.dispatchEvent(new Event('incode:theme-context-ready'));
  };
  if (!deferred) loadHelper();
  vm.runInContext(code, context);
  return { nodes, root, roots, requests, document, context, product, loadHelper,
    invalidate: () => invalidate(), cleanup: () => cleanup(), counts: () => ({ observers, watches }) };
};

test('standalone checker waits for its helper and initializes dynamic sections once without automatic checks', () => {
  const data = fixture({ deferred: true });
  assert.equal(data.root.dataset.ready, undefined);
  vm.runInContext(code, data.context);
  data.document.dispatchEvent(new Event('DOMContentLoaded'));
  assert.equal(data.root.dataset.ready, undefined);
  data.loadHelper();
  data.document.dispatchEvent(new Event('incode:theme-context-ready'));
  data.document.dispatchEvent(new Event('shopify:section:load'));
  vm.runInContext(code, data.context);
  assert.deepEqual(data.counts(), { observers: 1, watches: 1 });
  assert.equal(data.nodes.get('button').handlers.click.length, 1);
  const dynamic = { ...data.root, dataset: { ...data.root.dataset } };
  delete dynamic.dataset.ready;
  data.roots.push(dynamic);
  data.document.dispatchEvent(new Event('shopify:section:load'));
  data.document.dispatchEvent(new Event('shopify:section:load'));
  assert.equal(dynamic.dataset.ready, 'true');
  assert.equal(data.counts().watches, 2);
  assert.equal(data.requests.length, 0);
});

test('manual checks read live variants and quantities and Enter does not submit the theme form', async () => {
  const data = fixture();
  data.product.variantId = 'gid://shopify/ProductVariant/99';
  data.product.quantity = 5;
  let prevented = false;
  const pending = data.nodes.get('input').fire('keydown', { key: 'Enter', preventDefault() { prevented = true; } });
  const params = new URL(data.requests[0].url, 'https://shop.test').searchParams;
  assert.equal(prevented, true);
  assert.equal(params.get('country'), 'CA');
  assert.equal(params.get('postal_code'), 'K1A 0B1');
  assert.equal(params.get('productId'), '42');
  assert.equal(params.get('variantId'), 'gid://shopify/ProductVariant/99');
  assert.equal(params.get('qty'), '5');
  data.requests[0].resolve({ ok: true, json: async () => ({ available: true }) });
  await pending;
  await settle();
  assert.equal(data.nodes.get('.incode-availability__status').dataset.state, 'available');
  data.invalidate();
  assert.equal(data.nodes.get('.incode-availability__status').textContent, '');
  assert.equal(data.requests.length, 1);
});

test('standalone cart checks use the shared fresh complete cart and fail closed for unsupported carts', async () => {
  const data = fixture({ surface: 'cart' });
  const pending = data.nodes.get('button').fire('click');
  await settle();
  assert.equal(data.requests[0].url, '/fr/cart.js');
  assert.equal(data.requests[0].options.cache, 'no-store');
  const params = new URL(data.requests[1].url, 'https://shop.test').searchParams;
  assert.equal(params.get('surface'), 'cart');
  assert.equal(params.has('productId'), false);
  assert.equal(params.has('variantId'), false);
  assert.equal(params.has('qty'), false);
  assert.equal(params.has('cartItems'), false);
  assert.equal(data.requests[1].options.method, 'POST');
  assert.equal(data.requests[1].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(data.requests[1].options.body).cartItems, [{ productId: '42', variantId: 'gid://shopify/ProductVariant/84', quantity: 7 }]);
  data.requests[1].resolve({ ok: true, json: async () => ({ available: false }) });
  await pending;
  assert.equal(data.nodes.get('.incode-availability__status').dataset.state, 'unavailable');
  for (const cart of [[], Array.from({ length: 251 }, () => ({ product_id: 1, variant_id: 2, quantity: 1 }))]) {
    const invalid = fixture({ surface: 'cart', cart });
    await invalid.nodes.get('button').fire('click');
    assert.equal(invalid.requests.length, 1);
    assert.equal(invalid.nodes.get('.incode-availability__status').dataset.state, 'error');
  }
});

test('postal, country, context and unload invalidation abort requests and ignore late success or failure', async () => {
  for (const change of ['postal', 'country', 'context', 'unload']) {
    for (const failure of [false, true]) {
      const data = fixture();
      const first = data.nodes.get('button').fire('click');
      if (change === 'postal') await data.nodes.get('input').fire('input');
      if (change === 'country') await data.nodes.get('select').fire('change');
      if (change === 'context') data.invalidate();
      if (change === 'unload') data.cleanup();
      assert.equal(data.requests[0].options.signal.aborted, true);
      assert.equal(data.nodes.get('.incode-availability__status').textContent, '');
      const second = data.nodes.get('button').fire('click');
      if (failure) data.requests[0].reject(new Error('Late failure'));
      else data.requests[0].resolve({ ok: true, json: async () => ({ available: true }) });
      await first;
      assert.equal(data.nodes.get('button').disabled, true);
      assert.equal(data.nodes.get('.incode-availability__status').dataset.state, 'loading');
      data.requests[1].resolve({ ok: true, json: async () => ({ available: false }) });
      await second;
      assert.equal(data.nodes.get('button').disabled, false);
      assert.equal(data.nodes.get('.incode-availability__status').dataset.state, 'unavailable');
    }
  }
});

test('HTTP errors, malformed payloads and network failures are not delivery unavailability', async () => {
  for (const response of [
    { ok: false, json: async () => ({ available: false, message: 'Please retry later.' }) },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => null },
    { ok: false, json: async () => { throw new Error('Invalid JSON'); } },
    null
  ]) {
    const data = fixture();
    const pending = data.nodes.get('button').fire('click');
    if (response) data.requests[0].resolve(response);
    else data.requests[0].reject(new Error('Network failure'));
    await pending;
    assert.equal(data.nodes.get('.incode-availability__status').dataset.state, 'error');
    assert.equal(data.nodes.get('button').disabled, false);
  }
});

test('standalone Liquid exports helper context and only prefills supported saved countries', () => {
  const liquid = source('blocks/availability-checker.liquid');
  assert.match(liquid, /data-initial-variant=/);
  assert.match(liquid, /data-surface="{{ template.name \| escape }}"/);
  assert.match(liquid, /delivery-theme-context\.js' \| asset_url }}" defer/);
  assert.match(liquid, /localization\.available_countries\.first\.iso_code/);
  assert.match(liquid, /if country\.iso_code == customer\.default_address\.country_code/);
  assert.doesNotMatch(liquid, /default: 'US'/);
  assert.doesNotMatch(liquid, /auto.check/i);
});
