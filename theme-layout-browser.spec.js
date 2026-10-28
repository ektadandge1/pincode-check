import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const base = new URL("./extensions/pincode-checker/assets/", import.meta.url);
const css = [
  "delivery-checker.css",
  "availability-checker.css",
  "product-delivery-pickup.css",
  "delivery-service-options.css",
].map((file) => readFileSync(new URL(file, base), "utf8")).join("\n");

const widgets = {
  checker: `<div class="pin-checker"><h3 class="pin-checker__heading">Check delivery to your address</h3><p class="pin-checker__sub">Enter your ZIP or postal code to see if we deliver to you.</p><div class="pin-checker__row"><div class="pin-checker__country-wrap"><select class="pin-checker__select"><option>United States</option></select></div><input class="pin-checker__input" placeholder="ZIP or postal code"><button class="pin-checker__button">Check availability</button></div></div>`,
  availability: `<div class="incode-availability"><div class="incode-availability__heading"><div><h3>Check delivery to your address</h3><p>Enter your ZIP or postal code to see if we deliver to you.</p></div></div><div class="incode-availability__form"><select><option>United States</option></select><input placeholder="ZIP or postal code"><button>Check availability</button></div></div>`,
  product: `<div class="incode-product-service"><div class="incode-product-service__intro"><div><h3>Check delivery options</h3><p>Enter your postal code for delivery and pickup availability.</p></div></div><div class="incode-product-service__form"><select><option>United States</option></select><input placeholder="Postal code"><button>Check</button></div></div>`,
  service: `<div id="service" class="incode-service-card"><div class="incode-service-card__intro"><div><h3>Local delivery and pickup</h3><p>Check available fulfillment services.</p></div></div><div class="incode-service-card__form"><select><option>United States</option></select><input placeholder="Postal code"><button>Check availability</button></div></div>`,
  tabs: `<div data-template="service-tabs"><div class="ist-services"><label><span>Shipping</span></label><label><span>Local delivery</span></label><label><span>Store pickup</span></label></div><p class="ist-helper">Choose how you want to receive your order.</p><div class="ist-shipping-check"><label><input placeholder="Postal code"></label><button>Check</button></div></div>`,
  eta: `<div class="incode-eta"><p>ESTIMATED DELIVERY</p><h3>Receive your order Friday, Oct 30 to Monday, Nov 02</h3><div class="eta-steps"><div>Order confirmed</div><div>Ready to ship</div><div>At your doorstep</div></div></div>`,
};

const etaCss = `.incode-eta{box-sizing:border-box;display:block;width:100%;max-width:100%;min-width:0;flex:1 1 100%;align-self:stretch;justify-self:stretch;overflow-wrap:break-word;word-break:normal;padding:18px;border:1px solid #ddd}.eta-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}`;

for (const [name, markup] of Object.entries(widgets)) {
  test(`${name} remains usable in hostile theme containers`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(`<style>${css}${etaCss}html,body{margin:0;font:16px Arial}.cases{display:grid;gap:10px}.host{box-sizing:border-box;border:1px dashed #aaa}.block{width:760px}.flex{display:flex;width:620px}.grid{display:grid;grid-template-columns:minmax(0,1fr);width:620px}.narrow{display:flex;width:280px}.fit{width:620px}.fit>div{width:fit-content;max-width:100%}.host>*{min-width:0}</style><div class="cases"><section class="host block">${markup}</section><section class="host flex">${markup}</section><section class="host grid">${markup}</section><section class="host narrow">${markup}</section><section class="host fit"><div>${markup}</div></section></div>`);

    const results = await page.locator(".host").evaluateAll((hosts) => hosts.map((host) => {
      const root = host.querySelector(":scope > div > .pin-checker, :scope > div > .incode-availability, :scope > div > .incode-product-service, :scope > div > .incode-service-card, :scope > div > [data-template], :scope > div > .incode-eta") || host.firstElementChild;
      const rect = root.getBoundingClientRect();
      const controls = [...root.querySelectorAll("input,select,button")].map((node) => node.getBoundingClientRect().width);
      const copy = [...root.querySelectorAll("h3,p,button")].filter((node) => node.textContent.trim()).map((node) => node.getBoundingClientRect().width);
      return { width: rect.width, hostWidth: host.getBoundingClientRect().width, overflow: root.scrollWidth - root.clientWidth, minControl: controls.length ? Math.min(...controls) : 100, minCopy: copy.length ? Math.min(...copy) : 100 };
    }));

    for (const result of results) {
      expect(result.width).toBeGreaterThan(120);
      expect(result.width).toBeLessThanOrEqual(result.hostWidth + 1);
      expect(result.overflow).toBeLessThanOrEqual(2);
      expect(result.minControl).toBeGreaterThan(50);
      expect(result.minCopy).toBeGreaterThan(50);
    }
  });
}
