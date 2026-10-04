// End-to-end purchase on the local site: add to cart, mini cart, cart page, checkout, order received.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8787';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('request', (r) => { if (r.url().includes('poudrebeauty.com')) errors.push(`OLD SITE REQUEST ${r.url()}`); });
page.on('response', async (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push(`${r.status()} ${r.url()}`); if (r.url().includes('/wp-json/')) console.log('API', r.request().method(), r.status(), r.url().replace(BASE, ''), (r.request().postData() || '').slice(0, 300), '=>', (await r.text().catch(() => '')).slice(0, 300)); });
await page.goto(`${BASE}/product/hoody-blanket/`, { waitUntil: 'networkidle' });
await page.click('button.single_add_to_cart_button');
await page.waitForTimeout(2500);
console.log('header count after add:', await page.textContent('.pls-header-cart-count').catch(() => '?'));
await page.screenshot({ path: 'data/shots/t1-added.png' });
await page.goto(`${BASE}/product/duri/`, { waitUntil: 'networkidle' });
await page.click('.pls-swatches .swatch-term >> nth=0');
await page.waitForTimeout(500);
await page.click('button.single_add_to_cart_button');
await page.waitForTimeout(2500);
await page.goto(`${BASE}/cart/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'data/shots/t2-cart.png', fullPage: true });
console.log('cart rows:', await page.locator('.wc-block-cart-items__row').count());
await page.goto(`${BASE}/checkout/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.fill('#email', 'test@example.com').catch((e) => errors.push('email ' + e.message));
for (const [sel, v] of [['#shipping-first_name', 'Test'], ['#shipping-last_name', 'Client'], ['#shipping-address_1', 'Main road'], ['#shipping-city', 'Chekka'], ['#shipping-phone', '03123456'], ['#shipping-postcode', '0000']]) {
  await page.fill(sel, v).catch((e) => errors.push(`${sel} ${e.message.split('\n')[0]}`));
}
await page.screenshot({ path: 'data/shots/t3-checkout.png', fullPage: true });
await page.click('.wc-block-components-checkout-place-order-button').catch((e) => errors.push('place ' + e.message.split('\n')[0]));
await page.waitForTimeout(5000);
console.log('after place order url:', page.url());
await page.screenshot({ path: 'data/shots/t4-received.png', fullPage: true });
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 20).join('\n') : 'no errors');
await browser.close();
