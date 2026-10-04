// Records the WooCommerce blocks cart/checkout flow on the live site: JS chunks loaded and Store API calls.
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const SITE = 'https://poudrebeauty.com';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const assets = new Set();
const calls = [];
page.on('response', async (res) => {
  const u = res.url();
  if (/\/wp-content\/|\/wp-includes\//.test(u) && /\.(js|css|svg|woff2?|png)(\?|$)/.test(u)) assets.add(u.split('?')[0]);
  if (u.includes('/wp-json/') || u.includes('wc-ajax') || u.includes('admin-ajax')) {
    let body = '';
    try { body = await res.text(); } catch {}
    calls.push({ method: res.request().method(), url: u, post: res.request().postData(), status: res.status(), headers: res.headers(), body });
  }
});
await page.goto(`${SITE}/product/hoody-blanket/`, { waitUntil: 'networkidle' });
await page.click('button.single_add_to_cart_button');
await page.waitForTimeout(4000);
await page.goto(`${SITE}/product/duri/`, { waitUntil: 'networkidle' });
await page.click('.pls-swatches .swatch-term >> nth=0');
await page.waitForTimeout(800);
await page.click('button.single_add_to_cart_button');
await page.waitForTimeout(4000);
await page.goto(`${SITE}/cart/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'data/original/shots/cart_full-desktop.png', fullPage: true });
await writeFile('data/original/storeapi/cart_page.html', await page.content());
// change quantity and shipping in the cart block
try { await page.click('.wc-block-components-quantity-selector__button--plus >> nth=1'); await page.waitForTimeout(3000); } catch (e) { console.log('qty', e.message); }
await page.goto(`${SITE}/checkout/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'data/original/shots/checkout_full-desktop.png', fullPage: true });
await writeFile('data/original/storeapi/checkout_page.html', await page.content());
await writeFile('data/original/storeapi/calls.json', JSON.stringify(calls, null, 1));
await writeFile('data/original/storeapi/assets.txt', [...assets].join('\n'));
console.log('calls', calls.length, 'assets', assets.size);
for (const c of calls) console.log(c.method, c.status, c.url.replace(SITE, '').slice(0, 120));
await browser.close();
