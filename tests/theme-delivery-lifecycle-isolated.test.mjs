import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const base = new URL('../extensions/pincode-checker/', import.meta.url);
const source = (path) => readFileSync(new URL(path, base), 'utf8');
const script = (name) => name === 'delivery-service-options'
  ? source('assets/delivery-service-card.js')
  : source(`blocks/${name}.liquid`).match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/{{[^}]+}}/g, '"product"');
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

test('theme inline scripts and assets parse as JavaScript', () => {
  for (const name of ['delivery-checker', 'delivery-service-options', 'estimated-delivery-date']) new vm.Script(script(name));
  for (const name of ['delivery-theme-context', 'delivery-card-eta']) new vm.Script(source(`assets/${name}.js`));
});

test('previous service card opens dedicated local-delivery and pickup forms', () => {
  const liquid = source('blocks/delivery-service-options.liquid');
  const card = source('assets/delivery-service-card.js');
  assert.match(card, /data-service-forms/);
  assert.match(card, /data-service-form="local"/);
  assert.match(card, /data-service-form="pickup"/);
  assert.match(card, /showForm\('local'\)/);
  assert.match(card, /showForm\('pickup'\)/);
  assert.match(card, /service_options', '1'/);
  assert.match(card, /options\.hidden = true/);
});

test('fresh cart context replaces stale product and quantity using localized AJAX URL', async () => {
  const requests = [];
  const window = { Shopify: { routes: { root: '/fr/' } } };
  vm.runInNewContext(source('assets/delivery-theme-context.js'), {
    window, URLSearchParams, AbortController, Event, document: { dispatchEvent() {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ items: [{ product_id: 42, variant_id: 84, quantity: 7 }] }) };
    }
  });
  const params = new URLSearchParams('productId=1&variantId=2&qty=1&productTags=stale&surface=cart');
  await window.incodeThemeContext.cartParams(params);
  assert.equal(requests[0].url, '/fr/cart.js');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(params.has('productId'), false);
  assert.equal(params.has('qty'), false);
  assert.equal(params.has('productTags'), false);
  assert.deepEqual(JSON.parse(params.get('cartItems')), [{ productId: '42', variantId: 'gid://shopify/ProductVariant/84', quantity: 7 }]);
});

test('fresh cart context accepts exactly 20 complete lines', async () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ product_id: index + 1, variant_id: index + 101, quantity: 1 }));
  const window = {};
  vm.runInNewContext(source('assets/delivery-theme-context.js'), {
    window,
    Event,
    document: { dispatchEvent() {} },
    fetch: async () => ({ ok: true, json: async () => ({ items }) }),
  });
  const params = await window.incodeThemeContext.cartParams(new URLSearchParams());
  assert.equal(JSON.parse(params.get('cartItems')).length, 20);
});

test('cart context fails closed for failed, empty, malformed and incomplete carts', async () => {
  for (const response of [
    { ok: false },
    { ok: true, json: async () => ({ items: [] }) },
    { ok: true, json: async () => ({ items: [{ product_id: 1, variant_id: 2, quantity: 0 }] }) },
    { ok: true, json: async () => ({ items: Array.from({ length: 21 }, () => ({ product_id: 1, variant_id: 2, quantity: 1 })) }) }
  ]) {
    const window = {};
    vm.runInNewContext(source('assets/delivery-theme-context.js'), { window, Event, document: { dispatchEvent() {} }, fetch: async () => response });
    await assert.rejects(window.incodeThemeContext.cartParams(new URLSearchParams()));
  }
});

const element = (value = '') => ({
  value, hidden: true, disabled: false, textContent: '', dataset: {}, handlers: {},
  addEventListener(name, handler) { this.handlers[name] = handler; },
  querySelector() { return element(); },
  focus() {}
});
test('extracted service script ignores late success and late failure after input invalidation', async () => {
  for (const rejectOld of [false, true]) {
    const nodes = new Map();
    for (const selector of ['select', 'input', 'button', '.incode-service-card__status', '.incode-service-card__result', '[data-service-local]', '[data-service-pickup]', '[data-service-eta]', '[data-service-cart-items]', '[data-service-flag]', '[data-result-destination]', '[data-result-availability]', '[data-service-location]', '[data-service-pickup-copy]']) nodes.set(selector, element());
    nodes.get('select').value = 'US';
    nodes.get('input').value = '10001';
    nodes.get('[data-service-cart-items]').textContent = '[]';
    const root = { dataset: { surface: 'product' }, isConnected: true, querySelector: (selector) => nodes.get(selector), closest: () => ({ querySelector: () => null }) };
    const requests = [];
    let invalidate;
    vm.runInNewContext(script('delivery-service-options'), {
      document: { getElementById: () => root }, location: { search: '' }, URLSearchParams, AbortController,
      window: { incodeThemeContext: { productContext: () => ({ variantId: '', quantity: 1 }), watch: (_root, callback) => { invalidate = callback; return {}; } } },
      fetch: (url, options) => new Promise((resolve, reject) => requests.push({ resolve, reject, options }))
    });
    const button = nodes.get('button');
    const first = button.handlers.click();
    nodes.get('input').handlers.input();
    assert.equal(requests[0].options.signal.aborted, true);
    const second = button.handlers.click();
    if (rejectOld) requests[0].reject(new Error('late network failure'));
    else requests[0].resolve({ ok: true, json: async () => ({ available: true }) });
    await first;
    assert.equal(button.disabled, true, 'old finally must not enable the new request button');
    assert.equal(nodes.get('.incode-service-card__result').hidden, true);
    requests[1].resolve({ ok: true, json: async () => ({ available: false, postal_code: '10001' }) });
    await second;
    assert.equal(button.disabled, false);
    assert.equal(nodes.get('[data-result-availability]').textContent, 'Delivery unavailable');
    invalidate();
    assert.equal(nodes.get('.incode-service-card__result').hidden, true);
    await settle();
  }
});

test('card batches use valid surrogate cart keys, all duplicate cards and a single details host', () => {
  const cards = source('assets/delivery-card-eta.js');
  assert.match(cards, /offset \+= 24/);
  assert.match(cards, /items\.slice\(offset, offset \+ 24\)/);
  assert.match(cards, /key: `line-\$\{index \+ 1\}`/);
  assert.match(cards, /cards\.forEach/);
  assert.match(cards, /label\(line\.querySelector\([^\n]+\) \|\| line/);
  assert.doesNotMatch(cards, /append\(label\) \|\|/);
  assert.match(cards, /current !== state\.version/);
  assert.match(cards, /MutationObserver/);
  assert.match(source('blocks/delivery-checker-embed.liquid'), /if inline_items != ''/);
});

test('extracted ETA script refetches current quantity and ignores stale responses without appending dates', async () => {
  const nodes = new Map();
  for (const selector of ['.incode-eta__status', '.incode-eta__content', '.incode-eta__status span:last-child', '[data-eta-range]', '[data-eta-order]', '[data-eta-dispatch]', '[data-eta-delivery]']) nodes.set(selector, element());
  nodes.get('.incode-eta__status span:last-child').textContent = 'Calculating';
  const quantity = element('2');
  const scope = { querySelector: (selector) => selector.includes('quantity') ? quantity : null };
  const root = { dataset: { productId: '42', country: 'US' }, isConnected: true, querySelector: (selector) => nodes.get(selector), closest: () => scope };
  const requests = [];
  let invalidate;
  let cleanup;
  let scheduled;
  vm.runInNewContext(script('estimated-delivery-date'), {
    document: { getElementById: () => root }, URLSearchParams, AbortController,
    window: { location: { search: '' }, incodeThemeContext: {
      cartUrl: (path) => `/${path}`,
      productContext: () => ({ variantId: '', quantity: Number(quantity.value) }),
      watch: (_root, callback, dispose) => { invalidate = callback; cleanup = dispose; }
    } },
    setTimeout: (callback) => { scheduled = callback; return 1; }, clearTimeout: () => {},
    fetch: (url, options) => {
      if (url === '/cart/update.js') return Promise.resolve({ ok: true });
      return new Promise((resolve) => requests.push({ url, options, resolve }));
    }
  });
  assert.equal(new URL(requests[0].url, 'https://shop.test').searchParams.get('qty'), '2');
  quantity.value = '6';
  invalidate();
  assert.equal(requests[0].options.signal.aborted, true);
  scheduled();
  assert.equal(new URL(requests[1].url, 'https://shop.test').searchParams.get('qty'), '6');
  requests[0].resolve({ ok: true, json: async () => ({ enabled: false }) });
  await settle();
  assert.equal(root.hidden, false);
  requests[1].resolve({ ok: true, json: async () => ({ enabled: true, delivery_date_range: 'Fresh', order_date_label: 'Today' }) });
  await settle();
  assert.equal(nodes.get('[data-eta-range]').textContent, 'Fresh');
  assert.equal(nodes.get('[data-eta-order]').textContent, 'Today');
  invalidate();
  scheduled();
  requests[2].resolve({ ok: true, json: async () => ({ enabled: true, order_date_label: 'Tomorrow' }) });
  await settle();
  assert.equal(nodes.get('[data-eta-order]').textContent, 'Tomorrow');
  cleanup();
  assert.equal(requests[2].options.signal.aborted, true);
});

test('executed card asset sends 50 products in 24/24/2 batches and labels duplicate cards once', async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ key: `product-${i}`, productId: i + 1 }));
  const host = () => ({ labels: [], querySelectorAll() { return this.labels; }, append(node) { this.labels.push(node); node.remove = () => { this.labels = this.labels.filter((label) => label !== node); }; } });
  const hosts = [host(), host()];
  const cards = hosts.map((host) => ({ dataset: {}, querySelector: () => host }));
  const links = cards.map((card) => ({ href: 'https://shop.test/products/product-0', closest: () => card }));
  const root = { dataset: { template: 'collection', country: 'US' }, isConnected: true, querySelector: () => ({ textContent: JSON.stringify(items) }) };
  const requests = [];
  const window = { incodeThemeContext: { cartUrl: (path) => `/fr/${path}`, expiryDelay: () => 15 * 60 * 1000 } };
  vm.runInNewContext(source('assets/delivery-card-eta.js'), {
    window, location: { href: 'https://shop.test/collections/all' }, URL, AbortController,
    setTimeout: (callback, delay) => { if (delay <= 100) callback(); return 1; }, clearTimeout: () => {},
    MutationObserver: class { observe() {} },
    document: {
      documentElement: {}, addEventListener() {}, createElement: () => element(),
      querySelectorAll: (selector) => selector === '[data-inline-delivery-eta]' ? [root] : selector.startsWith('a[') ? links : selector === '[data-inline-eta]' ? hosts.flatMap((host) => host.labels) : []
    },
    fetch: async (_url, options) => {
      if (_url === '/fr/products/ajax-new.js') return { ok: true, json: async () => ({ id: 51 }) };
      const body = JSON.parse(options.body);
      requests.push(body.items);
      return { ok: true, json: async () => ({ results: body.items.map(({ key }) => ({ key, estimate: { enabled: true, delivery_date_range: 'Oct 10' } })) }) };
    }
  });
  await settle();
  assert.deepEqual(requests.map((batch) => batch.length), [24, 24, 2]);
  for (const host of hosts) {
    assert.equal(host.labels.length, 1);
    assert.equal(host.labels[0].textContent, 'Delivery by Oct 10');
  }
  window.incodeCardEta();
  for (const host of hosts) assert.equal(host.labels.length, 1);
  assert.equal(requests.length, 3);
  const ajaxHost = host();
  hosts.push(ajaxHost);
  links.push({ href: 'https://shop.test/products/ajax-new', closest: () => ({ dataset: {}, querySelector: () => ajaxHost }) });
  window.incodeCardEta();
  await settle();
  assert.deepEqual(requests.slice(3).map((batch) => batch.length), [24, 24, 3]);
  assert.equal(ajaxHost.labels.length, 1);
  assert.equal(ajaxHost.labels[0].dataset.inlineEta, 'ajax-new');
});

test('ETA refetch and checker expiry are versioned and keep local theme settings', () => {
  const eta = script('estimated-delivery-date');
  const checker = script('delivery-checker');
  assert.match(eta, /setTimeout\(refresh, 100\)/);
  assert.match(eta, /current !== version/);
  assert.doesNotMatch(eta, /\?\.append\(data/);
  assert.match(checker, /expiryVersion === requestVersion\) runCheck\(\)/);
  assert.match(checker, /params\.set\('qty', String\(getQuantity\(\)\)\)/);
  assert.match(eta, /root\.dataset\.appearanceSource === 'block'/);
  assert.match(eta, /sections\.has\('countdown'\)/);
  assert.match(eta, /data\.seconds_until_cutoff \?\? data\.cutoff_seconds_remaining/);
  assert.match(eta, /window\.clearInterval\(countdownTimer\)/);
  assert.match(checker, /root\.dataset\.appearanceSource === 'block'/);
  assert.match(source('blocks/delivery-service-options.liquid'), /\.incode-service-card \[hidden\]/);
  assert.match(source('assets/delivery-checker.css'), /@container/);
});

test('shared ATC locks preserve native state and release only after the last widget unloads', () => {
  const window = {};
  vm.runInNewContext(source('assets/delivery-theme-context.js'), {
    window, Event, document: { dispatchEvent() {} }
  });
  const first = { disabled: true, dataset: {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {} };
  const second = { disabled: false, dataset: {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {} };
  const one = {}, two = {};
  window.incodeThemeContext.lockButtons(one, [first, second], true);
  window.incodeThemeContext.lockButtons(two, [first], true);
  window.incodeThemeContext.lockButtons(one, [], false);
  assert.equal(first.dataset.pincodeAtcDisabled, 'true');
  window.incodeThemeContext.lockButtons(two, [], false);
  assert.equal(first.disabled, true);
  assert.equal(second.disabled, false);
  assert.equal(first.dataset.pincodeAtcDisabled, undefined);
});

test('product checker persistence is cart-only and cart writes require a complete verified snapshot', () => {
  const checker = script('delivery-checker');
  assert.match(checker, /root\.dataset\.surface !== 'cart'\) return Promise\.resolve\(\)/);
  assert.match(checker, /data\.cart_complete === true/);
  assert.match(checker, /Number\(data\.cart_items_checked\) === snapshotItems\.length/);
  const checkerLiquid = source('blocks/delivery-checker.liquid');
  assert.match(checkerLiquid, /if customer and customer\.default_address/);
  assert.match(checkerLiquid, /customerAddressLocked\s*&&\s*savedPostal\s*&&\s*root\.dataset\.savedLocationActive/);
  assert.match(checkerLiquid, /customer_address_locked %\}disabled/);
  assert.match(source('blocks/delivery-service-options.liquid'), /if customer and customer\.default_address/);
});
