import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../extensions/pincode-checker/assets/delivery-theme-context.js', import.meta.url), 'utf8');
const fixture = ({ forms = [], query = () => null, fetch = async () => ({ ok: true }) } = {}) => {
  const handlers = new Map();
  const polls = new Map();
  const window = { location: { search: '' } };
  const document = { documentElement: {}, dispatchEvent() {}, querySelector: query,
    querySelectorAll: (selector) => selector.startsWith('form') ? forms : [],
    addEventListener: (name, callback) => handlers.set(name, callback) };
  let pollId = 0;
  let observer;
  vm.runInNewContext(source, { window, document, URLSearchParams, AbortController, Event, fetch,
    setInterval: (callback) => { polls.set(++pollId, callback); return pollId; },
    clearInterval: (id) => polls.delete(id),
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() {} } });
  return { helper: window.incodeThemeContext, window, document, handlers, polls, mutate: () => observer() };
};
const form = (productId, variant = '84', quantity = '1') => {
  const fields = { id: { value: variant }, quantity: { value: quantity } };
  const node = { id: `product-${productId}`, dataset: { productId }, fields,
    elements: { namedItem: (name) => fields[name] }, closest: () => null, contains: () => false,
    querySelectorAll: () => [], querySelector: (selector) => selector.includes('quantity') ? fields.quantity
      : selector.includes('product-id') || selector.includes('product_id') ? null : fields.id };
  return node;
};
const root = (productId = '42') => ({ dataset: { productId, initialVariant: '84', surface: 'product' },
  isConnected: true, closest: () => null });

test('unlocking never restores stale theme-owned inventory state, including multiple owners', () => {
  const { helper } = fixture();
  for (const initial of [true, false]) {
    const attrs = new Map([['aria-disabled', 'false']]);
    const button = { disabled: initial, dataset: {}, getAttribute: (name) => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, value), removeAttribute: (name) => attrs.delete(name) };
    const one = {}, two = {};
    helper.lockButtons(one, [button], true);
    helper.lockButtons(two, [button], true);
    assert.equal(attrs.get('aria-disabled'), 'true');
    button.disabled = !initial;
    helper.lockButtons(one, [], false);
    assert.equal(button.dataset.pincodeAtcDisabled, 'true');
    helper.lockButtons(two, [], false);
    assert.equal(button.disabled, !initial);
    assert.equal(attrs.get('aria-disabled'), initial ? 'false' : 'true');
    assert.equal(button.dataset.pincodeAtcDisabled, undefined);
  }
});

test('proxy requests use configured same-origin routing and preserve batch POST bodies', async () => {
  const calls = [];
  const { helper } = fixture({ fetch: async (...args) => { calls.push(args); return { ok: true }; } });
  const widget = { dataset: { proxyPath: '/tools/custom-delivery/' } };
  const signal = new AbortController().signal;
  await helper.request(widget, new URLSearchParams('country=CA'), { signal, cache: 'no-store' });
  assert.equal(calls[0][0], '/tools/custom-delivery?country=CA');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[0][1].signal, signal);
  const body = '{"items":[{"key":"a","productId":"42"}]}';
  await helper.request(widget, new URLSearchParams('batch=1'), { method: 'POST', body });
  assert.equal(calls[1][1].body, body);
  assert.equal(calls[1][1].method, 'POST');
  for (const proxyPath of ['//evil.test/apps/check', 'https://evil.test/check', '/apps/../check', '/apps/check?shop=x', '/admin/check']) {
    await assert.rejects(helper.request({ dataset: { proxyPath } }, new URLSearchParams()), /Invalid delivery app proxy path/);
  }
  assert.equal(calls.length, 2);
});

test('proxy path defaults and embed fallback require no changes to standard installations', () => {
  assert.equal(fixture().helper.proxyUrl(), '/apps/delivery-checker');
  const { helper } = fixture({ query: () => ({ dataset: { proxyPath: '/a/custom' } }) });
  assert.equal(helper.proxyUrl({ dataset: {} }), '/a/custom');
  assert.equal(helper.proxyUrl({ dataset: { proxyPath: '/apps/block' } }), '/apps/block');
});

test('250-line cart uses a bounded POST body instead of an oversized query URL', async () => {
  const items = Array.from({ length: 250 }, (_, index) => ({ product_id: index + 1, variant_id: index + 1001, quantity: 1000 }));
  const calls = [];
  const { helper } = fixture({ fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ items }) };
  } });
  const params = await helper.cartParams(new URLSearchParams('surface=cart&country=US&productId=stale'));
  await helper.request({ dataset: { surface: 'cart' } }, params);
  const delivery = calls[1];
  assert.equal(delivery.options.method, 'POST');
  assert.equal(delivery.options.headers['Content-Type'], 'application/json');
  assert.equal(new URL(delivery.url, 'https://shop.test').searchParams.has('cartItems'), false);
  assert.equal(new URL(delivery.url, 'https://shop.test').searchParams.has('productId'), false);
  assert.equal(JSON.parse(delivery.options.body).cartItems.length, 250);
  items.push(items[0]);
  await assert.rejects(helper.cartParams(new URLSearchParams()));
});

test('blank live variants fail closed instead of using the initial variant', async () => {
  const product = form('42', '');
  let calls = 0;
  const { helper } = fixture({ forms: [product], fetch: async () => { calls++; return { ok: true }; } });
  const widget = root();
  assert.equal(helper.productContext(widget).variantId, '');
  await assert.rejects(helper.request(widget, new URLSearchParams('productId=42&variantId=84')), /valid product variant/);
  assert.equal(calls, 0);
});

test('silent primary and secondary value changes invalidate once and polling is cleaned up', () => {
  const primary = form('42'), secondary = form('42', '85'), other = form('99');
  const f = fixture({ forms: [primary, secondary, other] });
  const widget = root();
  let changes = 0, cleanup = 0;
  f.helper.watch(widget, () => changes++, () => cleanup++);
  primary.fields.id.value = '86';
  for (const poll of f.polls.values()) poll();
  assert.equal(changes, 1);
  secondary.fields.quantity.value = '5';
  for (const poll of f.polls.values()) poll();
  assert.equal(changes, 2);
  other.fields.quantity.value = '9';
  for (const poll of f.polls.values()) poll();
  assert.equal(changes, 2);
  widget.isConnected = false;
  for (const poll of f.polls.values()) poll();
  f.mutate();
  assert.equal(cleanup, 1);
  assert.equal(f.polls.size, 0);
});

test('a product response is rejected when a theme silently changes selection during the request', async () => {
  const product = form('42');
  let resolve;
  const { helper } = fixture({ forms: [product], fetch: () => new Promise((done) => { resolve = done; }) });
  const pending = helper.request(root(), new URLSearchParams('productId=42&variantId=84'));
  product.fields.id.value = '85';
  resolve({ ok: true });
  await assert.rejects(pending, /Product selection changed/);
});

test('recommendation forms cannot borrow unverified enclosing section product JSON', () => {
  const recommendation = form(undefined, '999');
  recommendation.dataset = {};
  const section = { dataset: {}, textContent: '', querySelectorAll: () => [{ dataset: {}, textContent: '{"id":42}' }] };
  recommendation.closest = (selector) => selector.startsWith('product-recommendations') ? {} : section;
  const { helper } = fixture({ forms: [recommendation] });
  assert.equal(helper.productForms(root()).length, 0);
});

test('custom variant events and URL changes support form-free pickers without cross-product state', () => {
  const f = fixture();
  assert.equal(f.helper.productContext({ dataset: {}, closest: () => null }).variantId, '');
  const widget = root();
  f.helper.watch(widget, () => {}, () => {});
  f.handlers.get('variant:change')({ target: widget, detail: { variant: { id: '90', product_id: '42' } } });
  assert.equal(f.helper.productContext(widget).variantId, 'gid://shopify/ProductVariant/90');
  f.handlers.get('variant:change')({ target: {}, detail: { variant: { id: '99', product_id: '99' } } });
  assert.equal(f.helper.productContext(widget).variantId, 'gid://shopify/ProductVariant/90');
  f.window.location.search = '?variant=91';
  assert.equal(f.helper.productContext(widget).variantId, 'gid://shopify/ProductVariant/91');
  widget.dataset.initialVariant = '92';
  f.window.location.search = '';
  assert.equal(f.helper.productContext(widget).variantId, 'gid://shopify/ProductVariant/92');
});

test('an explicitly invalid custom selection cannot reuse a previously checked variant', async () => {
  let requests = 0;
  const f = fixture({ fetch: async () => { requests++; return { ok: true }; } });
  const widget = root();
  f.helper.watch(widget, () => {}, () => {});
  const emit = (variant) => f.handlers.get('variant:change')({ target: widget, detail: { productId: '42', variant } });
  emit({ id: '90' });
  assert.equal(f.helper.productContext(widget).variantId, 'gid://shopify/ProductVariant/90');
  emit(null);
  assert.equal(f.helper.productContext(widget).variantId, '');
  await assert.rejects(f.helper.request(widget, new URLSearchParams('productId=42&variantId=90')), /valid product variant/);
  assert.equal(requests, 0);
  emit({ id: '91' });
  assert.equal(f.helper.productContext(widget).variantId, 'gid://shopify/ProductVariant/91');
});

test('narrow-column layout and motion/live announcements are constrained without redesigning cards', () => {
  const base = new URL('../extensions/pincode-checker/', import.meta.url);
  const css = readFileSync(new URL('assets/product-delivery-pickup.css', base), 'utf8');
  assert.match(css, /container-type:inline-size/);
  assert.match(css, /@container \(max-width:390px\)/);
  const checkerCss = readFileSync(new URL('assets/delivery-checker.css', base), 'utf8');
  assert.match(checkerCss, /prefers-reduced-motion: reduce[\s\S]*__option-mark \{ animation: none !important/);
  for (const block of ['delivery-checker', 'estimated-delivery-date']) {
    const liquid = readFileSync(new URL(`blocks/${block}.liquid`, base), 'utf8');
    assert.match(liquid, /<section class="[^"]*__countdown"[^>]*aria-live="off"/);
  }
});

test('cloned postal history is replaced and identical block IDs receive unique list IDs', () => {
  const f = fixture();
  const node = () => ({ attrs: {}, children: [], value: '', addEventListener() {},
    setAttribute(name, value) { this.attrs[name] = value; },
    append(child) { this.children.push(child); child.remove = () => { this.children = this.children.filter((entry) => entry !== child); }; },
    replaceChildren(fragment) { this.children = fragment.children; } });
  f.document.createElement = node;
  f.document.createDocumentFragment = node;
  const original = { ...node(), id: 'same-block', querySelectorAll() { return this.children.filter((entry) => entry.attrs['data-incode-postal-history']); } };
  f.helper.postalHistory(original, node(), { ...node(), value: 'US' }, {});
  const oldId = original.children[0].id;
  const clone = { ...node(), id: 'same-block', querySelectorAll: original.querySelectorAll };
  const stale = node();
  stale.id = oldId;
  stale.setAttribute('data-incode-postal-history', 'true');
  clone.append(stale);
  const input = node();
  f.helper.postalHistory(clone, input, { ...node(), value: 'US' }, {});
  assert.equal(clone.children.length, 1);
  assert.notEqual(clone.children[0].id, oldId);
  assert.equal(input.attrs.list, clone.children[0].id);
});
