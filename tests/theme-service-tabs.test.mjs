import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setMaxListeners } from 'node:events';

const base = new URL('../extensions/pincode-checker/', import.meta.url);
const source = (path) => readFileSync(new URL(path, base), 'utf8');
const code = source('assets/delivery-service-options.js');
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const element = (value = '') => ({
  value, dataset: {}, handlers: {}, children: [], disabled: false, hidden: false, textContent: '', tagName: 'INPUT',
  addEventListener(name, handler, options = {}) {
    (this.handlers[name] ||= []).push(handler);
    options.signal?.addEventListener('abort', () => { this.handlers[name] = this.handlers[name].filter((entry) => entry !== handler); }, { once: true });
  },
  fire(name, event = {}) { return Promise.all((this.handlers[name] || []).map((handler) => handler(event))); },
  append(...nodes) { this.children.push(...nodes); },
  replaceChildren(...nodes) { this.children = nodes; },
  setAttribute(name, value) { this[name] = value; },
  checkValidity() { return this.valid !== false; },
  focus() { this.focused = true; }
});

const fixture = ({ surface = 'product', bootstrap = false, saved = false, holdWrites = false, pickupDisplay = 'all' } = {}) => {
  const names = ['status', 'delivery-status', 'suggestions', 'retry', 'check', 'country', 'address', 'pickup-details', 'locations', 'clear', 'pickup-filter', 'pickup-postal', 'filter'];
  const nodes = new Map(names.map((name) => [`[data-${name}]`, element()]));
  const country = nodes.get('[data-country]');
  country.value = 'CA';
  country.hidden = true;
  country.options = [{ value: 'CA', textContent: 'Canada' }, { value: 'IN', textContent: 'India' }];
  country.selectedOptions = [country.options[0]];
  nodes.get('[data-address]').value = saved ? '' : '123 Main St, Ottawa, K1A 0B1';
  for (const name of ['date', 'first_name', 'last_name', 'email', 'phone']) nodes.set(`[data-field="${name}"]`, element());
  for (const name of ['date', 'first_name', 'last_name', 'email', 'phone', 'address', 'pickup_postal']) nodes.set(`[data-error="${name}"]`, element());
  const radios = ['shipping', 'pickup', 'delivery'].map((service) => ({ ...element(service), checked: service === 'shipping' }));
  const panels = radios.map((radio) => ({ ...element(), dataset: { panel: radio.value }, hidden: radio.value !== 'shipping' }));
  const root = {
    ...element(), id: 'test-service-tabs', isConnected: true,
    dataset: { surface, productId: '42', pickupDisplay, ...(saved ? { savedPostal: 'K1A 0B1', savedCountry: 'CA', savedAddress: '123 Main St, Ottawa, Ontario, K1A 0B1, Canada' } : {}) },
    querySelector: (selector) => nodes.get(selector),
    querySelectorAll: (selector) => selector === '.ist-services input' ? radios : panels
  };
  if (bootstrap) {
    nodes.delete('[data-status]');
    nodes.set('[data-country-slot]', { replaceWith: (node) => nodes.set('[data-country]', node) });
    Object.defineProperty(root, 'innerHTML', { set(markup) {
      this.markup = markup;
      nodes.set('[data-status]', element());
      nodes.set('[data-delivery-status]', element());
      nodes.set('[data-suggestions]', element());
    } });
  }
  const roots = [root];
  const document = new EventTarget();
  document.querySelectorAll = () => roots;
  document.createElement = (tag) => ({ ...element(), tagName: tag.toUpperCase() });
  const requests = [];
  const navigations = [];
  const timers = new Map();
  let timerId = 0;
  let items = [{ productId: '42', variantId: 'gid://shopify/ProductVariant/84', quantity: 3 }];
  let invalidate;
  let cleanup;
  let watches = 0;
  const product = { variantId: 'gid://shopify/ProductVariant/99', quantity: 4 };
  const helper = {
    cartUrl: (path) => `/fr/${path}`,
    productContext: () => product,
    cartParams: async (query, signal) => {
      requests.push({ url: '/fr/cart.js', signal });
      query.set('cartItems', JSON.stringify(items));
      return query;
    },
    watch: (_root, change, dispose) => {
      watches++;
      invalidate = change;
      const controller = new AbortController();
      setMaxListeners(0, controller.signal);
      cleanup = () => { controller.abort(); dispose(); };
      return { signal: controller.signal };
    }
  };
  const window = { incodeThemeContext: helper, location: { assign: (url) => navigations.push(url) } };
  const context = vm.createContext({
    window, document, URLSearchParams, AbortController, Event,
    setTimeout: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    fetch: (url, options = {}) => {
      const request = { url, options };
      requests.push(request);
      if (url.endsWith('cart/update.js') && !holdWrites) return Promise.resolve({ ok: true });
      return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    }
  });
  vm.runInContext(code, context);
  const api = () => requests.filter((request) => request.url.startsWith('/apps/'));
  const writes = () => requests.filter((request) => request.url.endsWith('cart/update.js'));
  const respond = (request, data, ok = true) => request.resolve({ ok, json: async () => data });
  const choose = async (service) => {
    radios.forEach((radio) => { radio.checked = radio.value === service; });
    await radios.find((radio) => radio.value === service).fire('change');
    await settle();
  };
  const flushTimers = async () => {
    const callbacks = [...timers.values()];
    timers.clear();
    callbacks.forEach((callback) => callback());
    await settle();
  };
  return { nodes, root, roots, radios, panels, requests, context, document, navigations, product, choose, api, writes, respond, flushTimers,
    invalidate: () => invalidate(), cleanup: () => cleanup(), watches: () => watches, setItems: (next) => { items = next; } };
};

const locations = [{ id: 'loc-1', name: 'Main Store', address1: '10 Main Street', address2: 'Unit 2', city: 'Ottawa', province: 'Ontario', postal_code: 'K1A 0B1', country: 'Canada', phone: '+1 555 1234', pickup_instructions: 'Bring confirmation.', available_dates: ['2026-10-09'] }];
const blank = (request) => Object.values(JSON.parse(request.options.body).attributes).every((value) => value === '');
const selectPickup = async (data) => {
  await data.choose('pickup');
  data.respond(data.api()[0], { pickup_locations: locations });
  await settle();
  await data.nodes.get('[data-locations]').children[0].children[0].fire('change');
};
const fillPickup = async (data) => {
  for (const [name, value] of Object.entries({ date: '2026-10-09', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.test', phone: '+1 555 1234' })) {
    const field = data.nodes.get(`[data-field="${name}"]`);
    field.value = value;
    await field.fire('input');
  }
};

test('Liquid renders service tabs before JavaScript and Theme Editor blocks can reinitialize', () => {
  const liquid = source('blocks/delivery-service-options.liquid');
  assert.match(liquid, /data-service-fallback/);
  assert.match(liquid, /<b>Shipping<\/b>/);
  assert.match(liquid, /data-fallback-pickup>Store Pickup/);
  assert.match(liquid, /data-fallback-local>Delivery/);
  assert.match(liquid, /<select data-country hidden>/);
  assert.match(code, /window\.incodeServiceTabs = \{ initialize \}/);
  assert.match(code, /shopify:block:select/);
});

test('generated markup has no checkout/navigation controls or technical instructions and keeps country internal', () => {
  for (const surface of ['product', 'cart']) {
    const data = fixture({ surface, bootstrap: true });
    assert.match(data.root.markup, /Choose how you would like to receive your order\./);
    assert.match(data.root.markup, /data-country-slot hidden/);
    assert.doesNotMatch(data.root.markup, /data-checkout|Continue to cart|>Checkout<|Service selections are checked|Other checkout buttons|Add your chosen product/);
    assert.equal(data.nodes.get('[data-country]').hidden, true);
  }
});

test('cart service tabs are kept directly above the native checkout actions', () => {
  assert.match(code, /placeAboveCheckout\(root\)/);
  assert.match(code, /button\[name="checkout"\]/);
  assert.match(code, /closest\?\.\('\.cart__ctas, \[data-cart-actions\]'\)/);
  assert.match(code, /insertBefore\(mount, anchor\)/);
  assert.doesNotMatch(code, /new MutationObserver\(initialize\)/);
  assert.match(source('assets/delivery-service-options.css'), /data-checkout-placement="true"\]\s*\{[^}]*margin: 0 auto 14px/);
});

test('pickup date lists only server-approved dates so blocked dates never display', () => {
  assert.match(code, /data-field="date"/);
  assert.doesNotMatch(code, /data-field="date" type="date"/);
  assert.match(code, /only contains server-approved dates, so blocked dates never display/);
  assert.match(code, /Choose pickup date/);
  assert.match(code, /availableDates/);
});

test('shipping is the default and cart initialization clears only block-owned service attributes', async () => {
  const data = fixture({ surface: 'cart' });
  await settle();
  assert.equal(data.api().length, 0);
  assert.equal(data.panels[0].hidden, false);
  assert.ok(data.writes().length > 0);
  for (const request of data.writes()) {
    const attributes = JSON.parse(request.options.body).attributes;
    assert.ok(Object.keys(attributes).every((key) => /^_incode_(service_|pickup_)/.test(key)));
    assert.ok(Object.values(attributes).every((value) => value === ''));
  }
});

test('cart delivery automatically verifies a fresh snapshot and persists delivery attributes', async () => {
  const data = fixture({ surface: 'cart' });
  await settle();
  await data.choose('delivery');
  const pending = data.nodes.get('[data-check]').fire('click');
  await settle();
  const query = new URL(data.api()[0].url, 'https://shop.test').searchParams;
  assert.equal(query.get('country'), 'CA');
  assert.equal(query.get('postal_code'), 'K1A 0B1');
  assert.ok(query.has('cartItems'));
  data.respond(data.api()[0], { local_delivery_available: true, postal_code: 'K1A 0B1' });
  await pending;
  await settle();
  const attributes = JSON.parse(data.writes().at(-1).options.body).attributes;
  assert.equal(attributes._incode_service_type, 'delivery');
  assert.equal(attributes._incode_service_country, 'CA');
  assert.equal(attributes._incode_service_postal_code, 'K1A 0B1');
  for (const key of Object.keys(attributes).filter((key) => key.startsWith('_incode_pickup_'))) assert.equal(attributes[key], '');
  assert.equal(data.requests.filter((request) => request.url === '/fr/cart.js').length, 2);
  assert.equal(data.nodes.get('[data-delivery-status]').textContent, 'Local delivery is available.');
  assert.deepEqual(data.navigations, []);
});

test('unavailable and failed delivery checks leave all owned attributes cleared', async () => {
  for (const outcome of ['unavailable', 'error']) {
    const data = fixture({ surface: 'cart' });
    await settle();
    await data.choose('delivery');
    const pending = data.nodes.get('[data-check]').fire('click');
    await settle();
    if (outcome === 'error') data.api()[0].reject(new Error('Network failure'));
    else data.respond(data.api()[0], { local_delivery_available: false });
    await pending;
    await settle();
    assert.ok(blank(data.writes().at(-1)));
    assert.equal(data.nodes.get('[data-delivery-status]').dataset.state, 'error');
  }
});

test('product delivery checks remain informational and never write or navigate', async () => {
  const data = fixture();
  await data.choose('delivery');
  const pending = data.nodes.get('[data-check]').fire('click');
  await settle();
  const query = new URL(data.api()[0].url, 'https://shop.test').searchParams;
  assert.equal(query.get('variantId'), 'gid://shopify/ProductVariant/99');
  assert.equal(query.get('qty'), '4');
  data.respond(data.api()[0], { local_delivery_available: true });
  await pending;
  assert.equal(data.writes().length, 0);
  assert.deepEqual(data.navigations, []);
  assert.equal(data.nodes.get('[data-delivery-status]').textContent, 'Local delivery is available.');
});

test('complete pickup details debounce, revalidate on the server, verify the cart, and autosave', async () => {
  const data = fixture({ surface: 'cart' });
  await settle();
  await selectPickup(data);
  await fillPickup(data);
  assert.equal(data.api().length, 1);
  await data.flushTimers();
  const validation = new URL(data.api()[1].url, 'https://shop.test').searchParams;
  assert.equal(validation.get('service_options'), '1');
  assert.equal(validation.get('pickup_location_id'), 'loc-1');
  assert.equal(validation.get('pickup_date'), '2026-10-09');
  assert.ok(validation.has('cartItems'));
  data.respond(data.api()[1], { pickup_locations: locations, pickup_selection_valid: true });
  await settle();
  const attributes = JSON.parse(data.writes().at(-1).options.body).attributes;
  assert.equal(attributes._incode_service_type, 'pickup');
  assert.equal(attributes._incode_pickup_location_id, 'loc-1');
  assert.equal(attributes._incode_pickup_email, 'jane@example.test');
  assert.equal(attributes._incode_service_country, '');
  assert.equal(attributes._incode_service_postal_code, '');
  assert.equal(data.nodes.get('[data-status]').textContent, 'Pickup details saved.');
  assert.deepEqual(data.navigations, []);
});

test('incomplete pickup stays cleared and only shows field validation after blur', async () => {
  const data = fixture({ surface: 'cart' });
  await settle();
  await selectPickup(data);
  const email = data.nodes.get('[data-field="email"]');
  email.value = 'invalid';
  email.valid = false;
  await email.fire('input');
  await data.flushTimers();
  assert.equal(data.api().length, 1);
  assert.equal(data.nodes.get('[data-error="email"]').hidden, true);
  assert.ok(blank(data.writes().at(-1)));
  await email.fire('blur');
  assert.equal(data.nodes.get('[data-error="email"]').hidden, false);
  assert.equal(email['aria-invalid'], 'true');
  assert.equal(data.nodes.get('[data-status]').textContent, '');
});

test('editing a saved pickup and switching to shipping immediately clear stale attributes', async () => {
  const data = fixture({ surface: 'cart' });
  await settle();
  await selectPickup(data);
  await fillPickup(data);
  await data.flushTimers();
  data.respond(data.api()[1], { pickup_locations: locations, pickup_selection_valid: true });
  await settle();
  assert.equal(JSON.parse(data.writes().at(-1).options.body).attributes._incode_service_type, 'pickup');
  const phone = data.nodes.get('[data-field="phone"]');
  phone.value = '';
  await phone.fire('input');
  await settle();
  assert.ok(blank(data.writes().at(-1)));
  await data.choose('shipping');
  assert.ok(blank(data.writes().at(-1)));
  assert.equal(data.api().length, 2);
});

test('pickup snapshot changes prevent persistence and retain cleared attributes', async () => {
  const data = fixture({ surface: 'cart' });
  await settle();
  await selectPickup(data);
  await fillPickup(data);
  await data.flushTimers();
  data.setItems([{ productId: '42', variantId: 'gid://shopify/ProductVariant/84', quantity: 9 }]);
  data.respond(data.api()[1], { pickup_locations: locations, pickup_selection_valid: true });
  await settle();
  assert.ok(blank(data.writes().at(-1)));
  assert.match(data.nodes.get('[data-status]').textContent, /cart changed/i);
});

test('a stale in-flight delivery save is followed by the latest clear', async () => {
  const data = fixture({ surface: 'cart', holdWrites: true });
  await settle();
  data.writes()[0].resolve({ ok: true });
  await settle();
  await data.choose('delivery');
  data.writes().at(-1).resolve({ ok: true });
  await settle();
  const pending = data.nodes.get('[data-check]').fire('click');
  await settle();
  data.writes().at(-1).resolve({ ok: true });
  await settle();
  data.respond(data.api()[0], { local_delivery_available: true });
  await settle();
  const save = data.writes().at(-1);
  assert.equal(JSON.parse(save.options.body).attributes._incode_service_type, 'delivery');
  data.nodes.get('[data-address]').value = '';
  await data.nodes.get('[data-address]').fire('input');
  save.resolve({ ok: true });
  await pending;
  await settle();
  const clear = data.writes().at(-1);
  assert.notEqual(clear, save);
  assert.ok(blank(clear));
  clear.resolve({ ok: true });
  await settle();
  assert.deepEqual(data.navigations, []);
});

test('pickup empty state, retry, collector fields, and premium tabs remain compact and responsive', () => {
  const css = source('assets/delivery-service-options.css');
  assert.match(css, /width: min\(100%, 410px\)/);
  assert.match(css, /border-radius: 16px;[^}]*background: #fff;[^}]*box-shadow:/);
  assert.match(css, /\.ist-services span \{[^}]*height: 100px;[^}]*border-radius: 10px/);
  assert.match(css, /\.ist-locations > div \{ height: 180px;/);
  assert.match(css, /\.ist-retry \{[^}]*border: 0;[^}]*background: transparent/);
  assert.match(css, /input:not\(\[type="radio"\]\),[^\n]+height: 42px/);
  assert.match(css, /@container \(max-width: 340px\)/);
  assert.match(css, /@container \(max-width: 310px\)/);
  assert.match(css, /background: #fff1f1/);
  assert.match(css, /background: #edf8f1/);
  assert.match(code, /className = 'ist-empty'/);
});

test('Liquid removes checkout configuration and groups retained legacy controls', () => {
  const liquid = source('blocks/delivery-service-options.liquid');
  const schema = JSON.parse(liquid.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  const removedSetting = ['show', 'checkout', 'button'].join('_');
  assert.equal(schema.settings.some((setting) => setting.id === removedSetting), false);
  assert.equal(schema.settings.some((setting) => setting.type === 'header' && setting.content === 'Previous card settings'), true);
  for (const id of ['layout', 'show_local_delivery', 'show_store_pickup', 'pickup_display', 'show_estimated_delivery', 'heading', 'supporting_text', 'button_label']) assert.ok(schema.settings.some((setting) => setting.id === id), id);
  assert.equal(liquid.includes(removedSetting), false);
  assert.doesNotMatch(liquid, /data-show-checkout/);
  assert.doesNotMatch(code, /data-checkout|Continue to cart|location\.assign|Service selections are checked|Other checkout buttons|Add your chosen product/);
  assert.match(code, /setTimeout\([^\n]+300\)/);
});
