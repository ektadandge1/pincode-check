import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { proxyRequest } from './helpers/theme-proxy-request.mjs';

const base = new URL('../extensions/pincode-checker/', import.meta.url);
const source = (path) => readFileSync(new URL(path, base), 'utf8');
const callers = [
  ['blocks/delivery-checker.liquid', 2],
  ['blocks/estimated-delivery-date.liquid', 1],
  ['assets/availability-checker.js', 1],
  ['assets/delivery-service-options.js', 2],
  ['assets/delivery-service-card.js', 2],
  ['assets/product-delivery-pickup.js', 1],
  ['assets/delivery-card-eta.js', 1],
];

test('all six blocks and embed expose an explicit escaped Shopify app proxy setting on every widget root', () => {
  const blocks = readdirSync(new URL('blocks/', base)).filter((name) => name.endsWith('.liquid'));
  assert.equal(blocks.length, 6);
  for (const name of blocks) {
    const liquid = source(`blocks/${name}`);
    const schema = JSON.parse(liquid.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
    const settings = schema.settings.filter((setting) => setting.id === 'proxy_path');
    assert.equal(settings.length, 1, name);
    assert.equal(settings[0].type, 'text', name);
    assert.equal(settings[0].default, '/apps/delivery-checker', name);
    assert.match(settings[0].info, /customized Shopify app proxy path/, name);
    const attributes = liquid.match(/data-proxy-path="{{ block\.settings\.proxy_path \| escape }}"/g) || [];
    assert.equal(attributes.length, name === 'delivery-service-options.liquid' ? 2 : 1, name);
  }
});

for (const [path, count] of callers) {
  test(`${path}: every delivery request passes its root, parameters and fetch options to the proxy helper`, async () => {
    const code = source(path);
    assert.doesNotMatch(code, /fetch\s*\(\s*['"`]\/apps\/delivery-checker/, path);
    const calls = [...code.matchAll(/await window\.incodeThemeContext\.request\(root,[\s\S]*?\);/g)];
    assert.equal(calls.length, count, path);
    for (const [index, [call]] of calls.entries()) {
      for (const surface of ['product', 'cart']) {
        const controller = new AbortController();
        const root = { dataset: { proxyPath: '/tools/custom-delivery', country: 'CA', savedPostal: 'K1A 0B1' } };
        const params = new URLSearchParams({ country: 'CA', postal_code: 'K1A 0B1', surface });
        const cartItems = [{ productId: '42', variantId: 'gid://shopify/ProductVariant/84', quantity: 3 }];
        if (surface === 'cart') params.set('cartItems', JSON.stringify(cartItems));
        const requests = [];
        const request = proxyRequest((url, options) => { requests.push({ url, options }); return Promise.resolve({ ok: true }); });
        await vm.runInNewContext(`(async () => { ${call} })()`, {
          window: { incodeThemeContext: { request } }, root, params, query: params,
          controller, signal: controller.signal, URLSearchParams,
          items: [{ key: 'product-1', productId: '42' }], offset: 0,
        });
        assert.equal(requests.length, 1, `${path} request ${index + 1}`);
        const { url, options } = requests[0];
        const parsed = new URL(url, 'https://shop.test');
        assert.equal(parsed.pathname, root.dataset.proxyPath);
        assert.equal(options.signal, controller.signal);
        assert.equal(options.headers.Accept, 'application/json');
        if (path.endsWith('delivery-card-eta.js')) {
          assert.equal(parsed.searchParams.get('batch'), '1');
          assert.equal(options.method, 'POST');
          assert.equal(options.headers['Content-Type'], 'application/json');
          assert.deepEqual(JSON.parse(options.body), { country: 'CA', postal_code: 'K1A 0B1', items: [{ key: 'product-1', productId: '42' }] });
        } else {
          assert.equal(parsed.searchParams.get('postal_code'), 'K1A 0B1');
          assert.equal(parsed.searchParams.get('surface'), surface);
          assert.equal(options.method, surface === 'cart' ? 'POST' : 'GET');
          assert.equal(parsed.searchParams.has('cartItems'), false);
          if (surface === 'cart') assert.deepEqual(JSON.parse(options.body).cartItems, cartItems);
          if (code.includes("cache: 'no-store'")) assert.equal(options.cache, 'no-store');
        }
      }
    }
  });
}
