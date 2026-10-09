import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const base = new URL('../extensions/pincode-checker/', import.meta.url);
const liquid = readFileSync(new URL('blocks/delivery-checker.liquid', base), 'utf8');
const checker = liquid.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/{{[^}]+}}/g, 'test');
const helper = readFileSync(new URL('assets/delivery-theme-context.js', base), 'utf8');
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

class Element {
  constructor() {
    this.dataset = {};
    this.attributes = new Map();
    this.handlers = new Map();
    this.children = [];
    this.isConnected = true;
    this.disabled = false;
    this.hidden = false;
    this.value = '';
    this.textContent = '';
  }
  addEventListener(name, callback, options = {}) {
    const listeners = this.handlers.get(name) || [];
    listeners.push({ callback, signal: options.signal });
    this.handlers.set(name, listeners);
  }
  emit(name, target = this) {
    const event = { type: name, target, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const listener of this.handlers.get(name) || []) {
      if (!listener.signal?.aborted) listener.callback(event);
      if (event.stopped) break;
    }
    return event;
  }
  dispatchEvent(event) { this.emit(event.type); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren() { this.children = []; }
  contains(node) { return node === this || Boolean(node?.parent && this.contains(node.parent)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest(selector) {
    if (selector === 'form') return this.parent?.isForm ? this.parent : this.parent?.closest(selector);
    return null;
  }
  matches(selector) { return this.isPurchase && selector.includes('button[type="submit"]'); }
}

function fixture() {
  const document = new Element();
  document.documentElement = new Element();
  document.createElement = () => new Element();
  document.createDocumentFragment = () => new Element();
  const forms = [];
  const controls = [];
  const roots = [];
  const observers = [];
  const requests = [];
  const intervals = new Map();
  let timer = 0;
  const makeForm = (variant = '84', quantity = '2', productId = '42', secondary = false) => {
    const form = new Element();
    form.isForm = true;
    form.dataset.productId = productId;
    form.variant = { value: variant };
    form.quantity = { value: quantity };
    form.elements = Object.assign([], { namedItem: (name) => name === 'id' ? form.variant : name === 'quantity' ? form.quantity : null });
    form.querySelectorAll = () => form.children.filter((node) => node.isPurchase);
    form.closest = (selector) => secondary && selector.includes('quick-add-modal') ? {} : null;
    forms.push(form);
    return form;
  };
  const makeButton = (form, external = false, nativeDisabled = false) => {
    const button = new Element();
    button.isPurchase = true;
    button.form = form;
    button.tagName = external ? 'INPUT' : 'BUTTON';
    button.type = 'submit';
    button.disabled = nativeDisabled;
    if (nativeDisabled) button.setAttribute('aria-disabled', 'true');
    if (external) button.setAttribute('form', 'sticky-form');
    else form.append(button);
    form.elements.push(button);
    controls.push(button);
    return button;
  };
  const primary = makeForm();
  const same = makeForm('84', '2', '42', true);
  const variant = makeForm('85', '2', '42', true);
  const quantity = makeForm('84', '3', '42', true);
  const unrelated = makeForm('99', '2', '99');
  const primaryButton = makeButton(primary);
  const sameButton = makeButton(same);
  const variantButton = makeButton(variant);
  const externalInput = makeButton(quantity, true);
  const soldOut = makeButton(same, false, true);
  const unrelatedButton = makeButton(unrelated);
  const makeRoot = () => {
    const root = new Element();
    root.id = 'pin-checker-test';
    root.dataset = { surface: 'product', productId: '42', initialVariant: '84', appearanceSource: 'block',
      showCountdown: 'false', showJourney: 'false', unlockPrompt: 'Check delivery' };
    root.nodes = new Map();
    for (const name of ['country', 'input', 'btn', 'result', 'details', 'countdown', 'countdown-label', 'countdown-value',
      'options', 'methods', 'method-controls', 'method-summary', 'cart-items']) root.nodes.set(`pin-${name}-test`, new Element());
    root.nodes.get('pin-country-test').value = 'US';
    root.nodes.get('pin-input-test').value = '10001';
    root.nodes.get('pin-cart-items-test').textContent = '[]';
    root.querySelector = (selector) => selector.startsWith('[id="') ? root.nodes.get(selector.slice(5, -2)) || null
      : selector === '[id$="-postal-history"]' ? root.children.find((node) => node.id?.endsWith('-postal-history')) || null : null;
    roots.push(root);
    return root;
  };
  const root = makeRoot();
  document.getElementById = (id) => id === root.id ? root : root.nodes.get(id) || null;
  document.querySelectorAll = (selector) => selector === '[data-inline-delivery-checker]' ? roots
    : selector.startsWith('form[') ? forms : selector.includes('button[type="submit"]') ? controls : [];
  const context = vm.createContext({ document, Element, Event, URLSearchParams, AbortController, Date,
    window: {},
    setTimeout: () => ++timer, clearTimeout() {},
    setInterval: (callback) => { intervals.set(++timer, callback); return timer; }, clearInterval: (id) => intervals.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    },
    fetch: (url, options) => new Promise((resolve) => requests.push({ url, options, resolve }))
  });
  vm.runInContext(helper, context);
  vm.runInContext(checker, context);
  const respond = async (data) => { requests.at(-1).resolve({ ok: true, json: async () => data }); await settle(); };
  const check = async (data) => { root.nodes.get('pin-btn-test').emit('click'); await respond(data); };
  const guard = (name, target) => {
    const event = document.emit(name, target);
    assert.equal(event.stopped, event.prevented);
    return event.prevented;
  };
  const mutate = () => { for (const observer of [...observers]) if (!observer.disconnected) observer.callback([]); };
  return { document, root, primary, same, variant, quantity, primaryButton, sameButton, variantButton, externalInput,
    soldOut, unrelated, unrelatedButton, makeRoot, makeForm, makeButton, respond, check, guard, mutate, requests, intervals };
}

test('main validation unlocks only matching forms, including external submit inputs, without altering inventory', async () => {
  const data = fixture();
  await data.respond({ require_valid_pin: true });
  await data.check({ available: true, require_valid_pin: true });
  for (const button of [data.primaryButton, data.sameButton, data.soldOut]) assert.equal(button.dataset.pincodeAtcDisabled, undefined);
  for (const button of [data.variantButton, data.externalInput]) {
    assert.equal(button.dataset.pincodeAtcDisabled, 'true');
    assert.equal(button.disabled, false);
    assert.equal(data.guard('click', button), true);
    assert.equal(data.guard('submit', button.form), true);
  }
  data.variant.children = [];
  assert.equal(data.guard('submit', data.variant), true, 'submit must not depend on marked descendants');
  const child = new Element();
  data.variantButton.append(child);
  assert.equal(data.guard('click', child), true);
  assert.equal(data.guard('submit', data.primary), false);
  assert.equal(data.guard('submit', data.same), false);
  assert.equal(data.guard('click', data.sameButton), false);
  assert.equal(data.guard('click', data.unrelatedButton), false);
  assert.equal(data.guard('submit', data.unrelated), false);
  assert.equal(data.soldOut.disabled, true);
  assert.equal(data.soldOut.getAttribute('aria-disabled'), 'true');
  const dynamic = data.makeForm('86', '2', '42', true);
  const dynamicButton = data.makeButton(dynamic, true);
  data.mutate();
  assert.equal(dynamicButton.dataset.pincodeAtcDisabled, 'true');
  assert.equal(data.guard('submit', dynamic), true);
  data.document.emit('shopify:section:unload', data.root);
  for (const button of [data.variantButton, data.externalInput, dynamicButton]) {
    assert.equal(button.dataset.pincodeAtcDisabled, undefined);
    assert.equal(button.getAttribute('aria-disabled'), null);
  }
  assert.equal(data.guard('submit', data.variant), false);
  assert.equal(data.soldOut.disabled, true);
  assert.equal(data.soldOut.getAttribute('aria-disabled'), 'true');
  assert.equal(data.intervals.size, 0);
});

test('silent form changes are blocked synchronously before polling, for both ATC settings', async () => {
  for (const policy of [{ require_valid_pin: true }, { disable_add_to_cart: true }]) {
    for (const primary of [false, true]) {
      for (const field of ['variant', 'quantity']) {
        const data = fixture();
        await data.respond(policy);
        await data.check({ ...policy, available: true });
        const form = primary ? data.primary : data.same;
        const button = primary ? data.primaryButton : data.sameButton;
        form[field].value = field === 'variant' ? '86' : '4';
        assert.equal(data.guard('submit', form), true, `${JSON.stringify(policy)}: silent ${field} submit`);
        assert.equal(data.guard('click', button), true, `${JSON.stringify(policy)}: silent ${field} click`);
        assert.equal(button.dataset.pincodeAtcDisabled, 'true');
        if (primary) assert.equal(data.guard('submit', data.same), true, 'a changed primary invalidates the old validation');
      }
    }
  }
});

test('default and exempt policies remain permissive, and invalidation releases selective locks', async () => {
  for (const policy of [{}, { require_valid_pin: false, disable_add_to_cart: false }, { enabled: false }]) {
    const data = fixture();
    await data.respond(policy);
    await data.check({ ...policy, available: true });
    assert.equal(data.guard('submit', data.variant), false);
    assert.equal(data.guard('click', data.externalInput), false);
    assert.equal(data.externalInput.dataset.pincodeAtcDisabled, undefined);
  }
  const data = fixture();
  await data.respond({ disable_add_to_cart: true });
  await data.check({ available: false, disable_add_to_cart: true });
  assert.equal(data.guard('submit', data.primary), true);
  await data.check({ available: true, disable_add_to_cart: true });
  assert.equal(data.guard('submit', data.quantity), true);
  data.root.nodes.get('pin-input-test').emit('input');
  assert.equal(data.guard('submit', data.quantity), false, 'shop-only policy retains its permissive unchecked default');
  await data.check({ available: true, disable_add_to_cart: true });
  await data.check({ enabled: false });
  assert.equal(data.externalInput.dataset.pincodeAtcDisabled, undefined);
  assert.equal(data.guard('submit', data.quantity), false);
});

test('duplicate-ID cloned checkers bind their own controls before the document fallback', async () => {
  const data = fixture();
  await data.respond({});
  const clone = data.makeRoot();
  clone.dataset.pincodeInitialized = 'true';
  data.mutate();
  await data.respond({});
  assert.equal(clone.nodes.get('pin-btn-test').handlers.get('click').length, 1);
  assert.equal(data.root.nodes.get('pin-btn-test').handlers.get('click').length, 1);
  clone.nodes.get('pin-input-test').value = '10002';
  clone.nodes.get('pin-btn-test').emit('click');
  assert.equal(new URL(data.requests.at(-1).url, 'https://shop.test').searchParams.get('postal_code'), '10002');
  await data.respond({ available: true, message: 'Clone result' });
  assert.equal(clone.nodes.get('pin-result-test').textContent, 'Clone result');
  assert.notEqual(data.root.nodes.get('pin-result-test').textContent, 'Clone result');
});

test('checker Liquid stays within the Shopify block size limit', () => {
  assert.ok(Buffer.byteLength(liquid) <= 102400);
});
