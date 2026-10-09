import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { proxyRequest } from './helpers/theme-proxy-request.mjs';

const base = new URL('../extensions/pincode-checker/', import.meta.url);
const source = (path) => readFileSync(new URL(path, base), 'utf8');
const code = source('assets/product-delivery-pickup.js');
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

const element = () => ({
  value: '', dataset: {}, handlers: {}, hidden: false, disabled: false, textContent: '', isConnected: true,
  addEventListener(name, handler, options = {}) {
    (this.handlers[name] ||= []).push(handler);
    options.signal?.addEventListener('abort', () => {
      this.handlers[name] = this.handlers[name].filter((entry) => entry !== handler);
    }, { once: true });
  },
  fire(name, event = {}) { return Promise.all((this.handlers[name] || []).map((handler) => handler(event))); },
  focus() { this.focused = true; },
});

const fixture = () => {
  const selectors = [
    'country', 'postal', 'check', 'status', 'result', 'eta', 'availability', 'local', 'pickup',
    'destination', 'eta-copy', 'eta-date', 'local-status', 'pickup-status', 'location', 'pickup-copy',
  ];
  const nodes = new Map(selectors.map((name) => [`[data-product-${name}]`, element()]));
  const root = {
    ...element(),
    id: 'product-service',
    dataset: { productService: '', productId: '42', initialVariant: '84', showLocal: 'true', showPickup: 'true' },
    querySelector: (selector) => nodes.get(selector),
  };
  const document = new EventTarget();
  document.querySelectorAll = () => [root];
  const requests = [];
  const helper = {
    productContext: () => ({ variantId: 'gid://shopify/ProductVariant/99', quantity: 3 }),
    watch: () => ({ signal: new AbortController().signal }),
  };
  const window = { incodeThemeContext: helper };
  const context = vm.createContext({ window, document, URLSearchParams, AbortController, Event, fetch: async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({
      available: true,
      postal_code: 'K1A 0B1',
      estimated_date: '2026-10-10',
      estimated_date_max_label: 'Saturday, Oct 10',
      processing_days: 1,
      transit_days: 2,
      local_delivery_available: true,
      pickup_available: false,
      fulfillment_location_name: 'Main Store',
      pickup_instructions: 'Bring confirmation.',
    }) };
  } });
  helper.request = proxyRequest(context.fetch);
  vm.runInContext(code, context);
  return { nodes, requests };
};

test('product block is product-only and does not contain cart behavior', () => {
  const liquid = source('blocks/product-delivery-pickup.liquid');
  const schema = JSON.parse(liquid.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  assert.deepEqual(schema.enabled_on.templates, ['product']);
  assert.match(liquid, /product-delivery-pickup\.css/);
  assert.match(liquid, /product-delivery-pickup\.js/);
  assert.doesNotMatch(liquid, /data-surface="cart"|cart\/update\.js|cart\.js/);
  assert.doesNotMatch(code, /cart\/update\.js|cart\.js|cartParams|queueAttributes|cartItems/);
});

test('product block checks the selected variant and quantity without fetching cart data', async () => {
  const data = fixture();
  const postal = data.nodes.get('[data-product-postal]');
  postal.value = 'K1A 0B1';
  await data.nodes.get('[data-product-check]').fire('click');
  await settle();

  assert.equal(data.requests.length, 1);
  const query = new URL(data.requests[0], 'https://shop.test').searchParams;
  assert.equal(query.get('surface'), 'product');
  assert.equal(query.get('productId'), '42');
  assert.equal(query.get('variantId'), 'gid://shopify/ProductVariant/99');
  assert.equal(query.get('qty'), '3');
  assert.equal(query.get('postal_code'), 'K1A 0B1');
  assert.equal(data.nodes.get('[data-product-result]').hidden, false);
  assert.equal(data.nodes.get('[data-product-local-status]').textContent, 'Available');
  assert.equal(data.nodes.get('[data-product-pickup-status]').textContent, 'Not available');
  assert.equal(data.nodes.get('[data-product-pickup-copy]').textContent, 'Bring confirmation.');
});
