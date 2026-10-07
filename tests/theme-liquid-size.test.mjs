import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';

const blocks = new URL('../extensions/pincode-checker/blocks/', import.meta.url);
const limit = 100 * 1024;

test('combined Liquid blocks stay below the extension content limit', () => {
  const bytes = readdirSync(blocks).filter((name) => name.endsWith('.liquid'))
    .reduce((total, name) => total + statSync(new URL(name, blocks)).size, 0);
  assert.ok(bytes <= limit, `Combined Liquid is ${bytes} bytes (maximum ${limit})`);
});

for (const name of readdirSync(blocks).filter((name) => name.endsWith('.liquid'))) {
  test(`${name} stays within Shopify's 100 KB Liquid limit`, () => {
    const bytes = statSync(new URL(name, blocks)).size;
    assert.ok(bytes <= limit, `${name} is ${bytes} bytes (maximum ${limit})`);
  });
}
