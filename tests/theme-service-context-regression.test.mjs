import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setMaxListeners } from 'node:events';
import vm from 'node:vm';
import { proxyRequest } from './helpers/theme-proxy-request.mjs';

const asset = (name) => readFileSync(new URL(`../extensions/pincode-checker/assets/${name}`, import.meta.url), 'utf8');
const code = asset('delivery-service-options.js');
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };

// Model DOM ownership, bubbling, focus, and abortable listeners rather than calling calendar handlers directly.
const fixture = ({ surface = 'product', helperReady = true, mount = true } = {}) => {
  let document;
  const node = (tag = 'div') => ({
    tagName: tag.toUpperCase(), dataset: {}, children: [], handlers: {}, attributes: {},
    value: '', hidden: false, disabled: false, textContent: '', tabIndex: 0, isConnected: true,
    addEventListener(type, handler, options = {}) {
      (this.handlers[type] ||= []).push(handler);
      options.signal?.addEventListener('abort', () => {
        this.handlers[type] = this.handlers[type].filter((entry) => entry !== handler);
      }, { once: true });
    },
    dispatchEvent(event) {
      const data = {
        ...event, type: event.type, target: this, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; }
      };
      for (let current = this; current; current = event.bubbles ? current.parentElement : null) {
        for (const handler of [...(current.handlers[data.type] || [])]) handler(data);
        if (data.stopped) break;
      }
      return !data.defaultPrevented;
    },
    fire(type, details = {}) { return this.dispatchEvent({ type, bubbles: true, ...details }); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    append(...children) { children.forEach((child) => { child.parentElement = this; this.children.push(child); }); },
    replaceChildren(...children) {
      this.children.forEach((child) => { child.parentElement = null; });
      this.children = [];
      this.append(...children);
    },
    contains(target) { return target === this || this.children.some((child) => child.contains(target)); },
    matches(selector) {
      if (selector === '[data-template="service-tabs"]') return this.dataset.template === 'service-tabs';
      if (selector === 'button') return this.tagName === 'BUTTON';
      if (selector === 'button:not(:disabled)') return this.tagName === 'BUTTON' && !this.disabled;
      return false;
    },
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    focus() {
      if (this.disabled || this.hidden) return;
      const previous = document.activeElement;
      document.activeElement = this;
      if (previous !== this) {
        previous?.fire('focusout', { relatedTarget: this });
        this.dispatchEvent({ type: 'focus' });
      }
    },
    checkValidity() { return true; }
  });
  document = node();
  document.documentElement = node('html');
  document.createElement = node;
  const roots = [];
  document.querySelectorAll = (selector) => selector === '[data-template="service-tabs"]' ? roots.filter((root) => root.isConnected) : [];
  const observers = [];
  const watches = new Map();
  const requests = [];
  let id = 0;
  const makeRoot = () => {
    const root = node();
    root.id = `service-${++id}`;
    root.dataset = { template: 'service-tabs', surface, productId: '42' };
    const names = ['status', 'delivery-status', 'shipping-postal', 'shipping-check', 'shipping-status', 'shipping-result', 'shipping-date', 'retry', 'check', 'country', 'pickup-filter', 'pickup-postal', 'address', 'suggestions', 'pickup-details', 'delivery-details', 'locations', 'clear', 'filter', 'date-picker', 'date-trigger', 'date-label', 'date-popover', 'date-month', 'date-grid', 'date-prev', 'date-next'];
    const nodes = new Map(names.map((name) => [`[data-${name}]`, node(name.includes('trigger') || name.includes('check') || name.includes('prev') || name.includes('next') ? 'button' : 'div')]));
    for (const name of ['date', 'first_name', 'last_name', 'email', 'phone']) {
      nodes.set(`[data-field="${name}"]`, node(name === 'date' ? 'select' : 'input'));
      nodes.set(`[data-delivery-field="${name}"]`, node('input'));
      nodes.set(`[data-error="${name}"]`, node('small'));
      nodes.set(`[data-error="delivery_${name}"]`, node('small'));
    }
    for (const name of ['address', 'pickup_postal']) nodes.set(`[data-error="${name}"]`, node('small'));
    const get = (name) => nodes.get(`[data-${name}]`);
    get('country').value = 'US';
    get('country').options = [{ value: 'US' }, { value: 'CA' }];
    get('date-popover').hidden = true;
    get('shipping-result').hidden = true;
    get('pickup-details').hidden = true;
    const radios = ['shipping', 'pickup', 'delivery'].map((value) => Object.assign(node('input'), { value, checked: value === 'shipping' }));
    const panels = radios.map((radio) => Object.assign(node(), { dataset: { panel: radio.value } }));
    root.append(...nodes.values(), ...radios, ...panels);
    get('date-picker').append(get('date-trigger'), get('date-popover'), nodes.get('[data-field="date"]'));
    get('date-popover').append(get('date-prev'), get('date-month'), get('date-next'), get('date-grid'));
    root.querySelector = (selector) => nodes.get(selector) || null;
    root.querySelectorAll = (selector) => selector === '.ist-services input' ? radios : selector === '[data-panel]' ? panels : [];
    root.get = get;
    root.nodes = nodes;
    root.radios = radios;
    roots.push(root);
    return root;
  };
  const product = { variantId: 'gid://shopify/ProductVariant/84', quantity: 1 };
  let items = [{ productId: '42', variantId: product.variantId, quantity: 1 }];
  const helper = {
    cartUrl: (path) => `/fr/${path}`,
    productContext: () => product,
    cartParams: async (query) => { query.set('cartItems', JSON.stringify(items)); return query; },
    watch(root, change, dispose) {
      const controller = new AbortController();
      setMaxListeners(0, controller.signal);
      const entries = watches.get(root) || [];
      entries.push({ change, cleanup() { controller.abort(); dispose(); } });
      watches.set(root, entries);
      return { signal: controller.signal };
    }
  };
  const window = helperReady ? { incodeThemeContext: helper } : {};
  const context = vm.createContext({
    window, document, URLSearchParams, AbortController, Event, setTimeout, clearTimeout,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target, options) { this.target = target; this.options = options; }
    },
    fetch(url, options = {}) {
      const request = { url, options };
      requests.push(request);
      if (url.endsWith('cart/update.js')) return Promise.resolve({ ok: true });
      if (url.includes('init=1')) return Promise.resolve({ ok: true, json: async () => ({}) });
      return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    }
  });
  helper.request = proxyRequest(context.fetch);
  const root = mount ? makeRoot() : null;
  vm.runInContext(code, context);
  const api = () => requests.filter((request) => request.resolve);
  const respond = (request, data) => request.resolve({ ok: true, json: async () => data });
  const invalidate = (target = root) => watches.get(target).at(-1).change();
  const insert = (target) => observers[0].callback([{ addedNodes: [target] }]);
  return { root, roots, makeRoot, document, window, helper, context, observers, watches, requests, product, api, respond, invalidate, insert,
    setItems(next) { items = next; } };
};

const checkShipping = async (data) => {
  data.root.get('shipping-postal').value = '10001';
  data.root.get('shipping-check').fire('click');
  await settle();
  return data.api().at(-1);
};
const assertCleared = (root) => {
  assert.equal(root.get('shipping-result').hidden, true);
  assert.equal(root.get('shipping-status').textContent, '');
  assert.equal(root.get('shipping-status').dataset.state, '');
  assert.equal(root.get('shipping-date').textContent, '');
};

test('variant, quantity, and cart context invalidations clear shipping result, status, and date', async () => {
  for (const change of ['variant', 'quantity', 'cart']) {
    const data = fixture({ surface: change === 'cart' ? 'cart' : 'product' });
    const request = await checkShipping(data);
    data.respond(request, { enabled: true, delivery_date_range: 'Oct 12 to Oct 14' });
    await settle();
    assert.equal(data.root.get('shipping-result').hidden, false);
    assert.equal(data.root.get('shipping-date').textContent, 'Oct 12 to Oct 14');
    if (change === 'variant') data.product.variantId = 'gid://shopify/ProductVariant/85';
    if (change === 'quantity') data.product.quantity = 3;
    if (change === 'cart') data.setItems([{ productId: '43', variantId: 'gid://shopify/ProductVariant/86', quantity: 2 }]);
    data.invalidate();
    assertCleared(data.root);
    const fresh = await checkShipping(data);
    const query = new URL(fresh.url, 'https://shop.test').searchParams;
    if (change === 'variant') assert.equal(query.get('variantId'), data.product.variantId);
    if (change === 'quantity') assert.equal(query.get('qty'), '3');
    if (change === 'cart') {
      assert.equal(query.has('cartItems'), false);
      assert.equal(fresh.options.method, 'POST');
      assert.equal(fresh.options.headers['Content-Type'], 'application/json');
      assert.deepEqual(JSON.parse(fresh.options.body).cartItems, [{ productId: '43', variantId: 'gid://shopify/ProductVariant/86', quantity: 2 }]);
    }
    data.respond(fresh, { enabled: true, delivery_date_range: 'Fresh date' });
    await settle();
    assert.equal(data.root.get('shipping-date').textContent, 'Fresh date');
  }
});

test('late shipping success and failure cannot repopulate invalidated UI or unblock a fresh request', async () => {
  for (const outcome of ['success', 'failure']) {
    const data = fixture();
    const stale = await checkShipping(data);
    data.invalidate();
    assert.equal(stale.options.signal.aborted, true);
    assertCleared(data.root);
    const fresh = await checkShipping(data);
    if (outcome === 'success') data.respond(stale, { enabled: true, delivery_date_range: 'Stale' });
    else stale.reject(new Error('Stale failure'));
    await settle();
    assert.equal(data.root.get('shipping-result').hidden, true);
    assert.equal(data.root.get('shipping-date').textContent, '');
    assert.equal(data.root.get('shipping-status').textContent, 'Checking shipping...');
    assert.equal(data.root.get('shipping-check').disabled, true);
    data.respond(fresh, { enabled: true, delivery_date_range: 'Fresh' });
    await settle();
    assert.equal(data.root.get('shipping-date').textContent, 'Fresh');
    assert.equal(data.root.get('shipping-check').disabled, false);
  }
});

test('postal, country, service switching, and disposal all reset shipping state', async () => {
  for (const change of ['postal', 'country', 'service', 'dispose']) {
    const data = fixture();
    data.respond(await checkShipping(data), { enabled: true, delivery_date_range: 'Old date' });
    await settle();
    if (change === 'postal') data.root.get('shipping-postal').fire('input');
    if (change === 'country') { data.root.get('country').value = 'CA'; data.root.get('country').fire('change'); }
    if (change === 'service') { data.root.radios[2].checked = true; data.root.radios[2].fire('change'); }
    if (change === 'dispose') { data.root.isConnected = false; data.watches.get(data.root)[0].cleanup(); }
    assertCleared(data.root);
    assert.equal(data.root.get('shipping-postal').getAttribute('aria-invalid'), null);
  }
  const data = fixture();
  data.respond(await checkShipping(data), { enabled: false, message: 'Unavailable' });
  await settle();
  assert.equal(data.root.get('shipping-status').dataset.state, 'error');
  data.invalidate();
  assertCleared(data.root);
});

const pickupCalendar = async () => {
  const data = fixture();
  data.root.radios[1].checked = true;
  data.root.radios[1].fire('change');
  await settle();
  data.respond(data.api()[0], { pickup_locations: [{ id: 'store', name: 'Store', available_dates: ['2026-10-09', '2026-10-10', '2026-10-16', '2026-11-02'] }] });
  await settle();
  data.root.get('locations').children[0].children[0].fire('change');
  return data;
};

test('calendar uses rows and selected gridcells, focuses enabled dates, and restores focus on selection and Escape', async () => {
  const data = await pickupCalendar();
  const { root, document } = data;
  const trigger = root.get('date-trigger');
  const grid = root.get('date-grid');
  const select = root.nodes.get('[data-field="date"]');
  assert.equal(select.hidden, true);
  assert.equal(select.tabIndex, -1);
  assert.equal(select.getAttribute('aria-hidden'), 'true');
  assert.equal(trigger.getAttribute('aria-controls'), root.get('date-popover').id);
  assert.equal(trigger.getAttribute('aria-describedby'), `${root.id}-date-error`);
  assert.equal(grid.getAttribute('aria-labelledby'), root.get('date-month').id);
  assert.ok(grid.children.every((row) => row.getAttribute('role') === 'row' && row.children.length === 7));
  assert.ok(grid.children.flatMap((row) => row.children).every((cell) => cell.getAttribute('role') === 'gridcell'));
  trigger.focus();
  trigger.fire('click');
  assert.equal(document.activeElement.dataset.date, '2026-10-09');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(grid.querySelectorAll('button').filter((button) => button.tabIndex === 0).length, 1);
  document.activeElement.fire('keydown', { key: 'ArrowRight' });
  assert.equal(document.activeElement.dataset.date, '2026-10-10');
  document.activeElement.fire('click');
  assert.equal(select.value, '2026-10-10');
  assert.equal(document.activeElement, trigger);
  assert.equal(root.get('date-popover').hidden, true);
  const selected = grid.querySelectorAll('button').find((button) => button.dataset.selected === 'true');
  assert.equal(selected.parentElement.getAttribute('aria-selected'), 'true');
  assert.equal(selected.getAttribute('role'), null, 'date remains a native button inside its gridcell');
  assert.ok(grid.querySelectorAll('button').filter((button) => button.disabled).every((button) => button.tabIndex === -1 && button.parentElement.getAttribute('aria-disabled') === 'true'));
  trigger.fire('click');
  assert.equal(document.activeElement.dataset.date, '2026-10-10');
  assert.equal(document.activeElement.fire('keydown', { key: 'Escape' }), false);
  assert.equal(document.activeElement, trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('calendar keyboard navigation skips blocked dates, crosses months, and closes when focus leaves', async () => {
  const data = await pickupCalendar();
  const { root, document } = data;
  root.get('date-trigger').fire('click');
  const key = (value) => document.activeElement.fire('keydown', { key: value });
  key('ArrowDown');
  assert.equal(document.activeElement.dataset.date, '2026-10-16');
  key('ArrowRight');
  assert.equal(document.activeElement.dataset.date, '2026-11-02');
  key('PageUp');
  assert.equal(document.activeElement.dataset.date, '2026-10-09');
  key('End');
  assert.equal(document.activeElement.dataset.date, '2026-10-10');
  key('Home');
  assert.equal(document.activeElement.dataset.date, '2026-10-09');
  key('PageDown');
  assert.equal(document.activeElement.dataset.date, '2026-11-02');
  key('ArrowLeft');
  assert.equal(document.activeElement.dataset.date, '2026-10-16');
  root.get('shipping-postal').focus();
  assert.equal(root.get('date-popover').hidden, true);
  assert.equal(document.activeElement, root.get('shipping-postal'), 'nonmodal calendar must not trap or steal outgoing focus');
});

test('month navigation never leaves focus on a disabled hidden navigation button', async () => {
  const data = await pickupCalendar();
  const { root, document } = data;
  root.get('date-trigger').fire('click');
  root.get('date-next').focus();
  root.get('date-next').fire('click');
  assert.equal(root.get('date-next').disabled, true);
  assert.equal(document.activeElement.dataset.date, '2026-11-02');
  root.get('date-prev').focus();
  root.get('date-prev').fire('click');
  assert.equal(root.get('date-prev').disabled, true);
  assert.equal(document.activeElement.dataset.date, '2026-10-09');
});

test('AJAX insertion initializes direct and wrapped roots once, including cloned readiness markers', async () => {
  const data = fixture({ mount: false });
  assert.equal(data.observers.length, 1);
  const root = data.makeRoot();
  root.dataset.serviceReady = 'true';
  data.insert(root);
  data.insert(root);
  await settle();
  assert.equal(data.watches.get(root).length, 1);
  const wrapped = data.makeRoot();
  data.insert({ querySelector: () => wrapped });
  await settle();
  assert.equal(data.watches.get(wrapped).length, 1);
  vm.runInContext(code, data.context);
  data.document.dispatchEvent(new Event('shopify:section:load'));
  data.document.dispatchEvent(new Event('incode:theme-context-ready'));
  data.insert(root);
  await settle();
  assert.equal(data.observers.length, 1);
  for (const target of [root, wrapped]) {
    assert.equal(data.watches.get(target).length, 1);
    assert.equal(target.get('shipping-check').handlers.click.length, 1);
  }
  assert.equal(data.requests.filter((request) => request.url.includes('init=1')).length, 2);
});

test('insertion waits for helper readiness, ignores detached roots, and reinitializes disposed nodes without duplicate handlers', async () => {
  const data = fixture({ helperReady: false });
  vm.runInContext(code, data.context);
  data.insert(data.root);
  await settle();
  assert.equal(data.watches.size, 0);
  data.window.incodeThemeContext = data.helper;
  data.document.dispatchEvent(new Event('incode:theme-context-ready'));
  await settle();
  assert.equal(data.watches.get(data.root).length, 1);
  data.root.isConnected = false;
  data.watches.get(data.root)[0].cleanup();
  data.insert(data.root);
  await settle();
  assert.equal(data.watches.get(data.root).length, 1);
  data.root.isConnected = true;
  data.insert(data.root);
  await settle();
  assert.equal(data.watches.get(data.root).length, 2);
  assert.equal(data.root.get('shipping-check').handlers.click.length, 1);
});

test('calendar CSS keeps seven equal columns and hides the enhanced native select without changing the card design', () => {
  const css = asset('delivery-service-options.css');
  assert.match(css, /\.ist-date-row \{ display: grid; grid-column: 1 \/ -1; grid-template-columns: repeat\(7, minmax\(0, 1fr\)\); gap: 4px;/);
  assert.match(css, /\.ist-date-row > \[role="gridcell"\] \{ display: grid; min-width: 0;/);
  assert.match(css, /\.ist-date-picker\[data-enhanced="true"\] \.ist-date-native \{ display: none !important;/);
  assert.match(css, /\.ist-date-popover \{[^}]*padding: 12px;[^}]*border-radius: 13px;/);
  assert.match(css, /\.ist-date-day\[data-selected="true"\] \{ border-color: #1d5f8a; background: #1d5f8a;/);
});
