// POS: shared barcode opens the option picker, codes shown, grid/table view, several tills in separate windows.
// Usage: BASE=http://localhost:8787 OWNER_PASSWORD=… node scripts/test-pos-tills.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8787';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${String(detail).slice(0, 250)}`}`); };
let cookie = '';
const api = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body && JSON.stringify(body) });
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  return res.json().catch(() => ({}));
};
await api('POST', '/api/auth/login', { username: 'jeanclaude', password: process.env.OWNER_PASSWORD });
const stamp = Date.now();
const parentCode = `55${stamp}`.slice(0, 13);
const shared = `66${stamp}`.slice(0, 13);
const shoe = await api('POST', '/api/admin/products', {
  name: `ZZ TEST Shoe ${stamp}`, type: 'variable', status: 'publish', regular_price: 30, sku: parentCode, pos_visible: true, online_visible: false,
  attributes: [{ name: 'Color', options: ['Black', 'White'], variation: true, visible: true }],
  variations: [
    { attributes: [{ name: 'Color', option: 'Black' }], regular_price: 30, manage_stock: true, stock_quantity: 5, status: 'publish', sku: shared, barcode: shared },
    { attributes: [{ name: 'Color', option: 'White' }], regular_price: 30, manage_stock: true, stock_quantity: 5, status: 'publish', sku: shared, barcode: shared },
  ],
});
const lip = await api('POST', '/api/admin/products', { name: `ZZ TEST Balm ${stamp}`, type: 'simple', status: 'publish', regular_price: 8, manage_stock: true, stock_quantity: 50, pos_visible: true, online_visible: false, sku: `77${stamp}`.slice(0, 13) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/dashboard/`);
await page.fill('input[autocomplete=username]', 'jeanclaude');
await page.fill('input[type=password]', process.env.OWNER_PASSWORD);
await page.click('button:has-text("Sign in")');
await page.waitForSelector('text=Open POS', { timeout: 15000 });
await page.goto(`${BASE}/dashboard/pos`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const reg = page.locator('[role=dialog]:has-text("Open the register")');
if (await reg.isVisible().catch(() => false)) { await reg.locator('input').fill('0'); await reg.locator('button:has-text("Open register")').click(); await page.waitForTimeout(1200); }
const search = page.locator('header input').first();
const scan = async (code) => { await search.fill(code); await search.press('Enter'); await page.waitForTimeout(600); };

await scan(shared);
const picker1 = page.locator('[role=dialog]', { hasText: `ZZ TEST Shoe ${stamp}` });
check('Scan the barcode shared by the colours → choose window opens', await picker1.isVisible(), 'no picker');
check('…showing both colours', (await picker1.innerText()).includes('Black') && (await picker1.innerText()).includes('White'), await picker1.innerText().catch(() => ''));
await picker1.locator('button:has-text("White")').click();
await page.waitForTimeout(400);
const cart = async () => (await page.locator('aside').innerText()).replace(/\s+/g, ' ');
check('…and the chosen colour goes to the sale', /Shoe.*White/.test(await cart()), (await cart()).slice(0, 150));
await scan(parentCode);
check("Scan the product's own barcode → choose window opens", await page.locator('[role=dialog]', { hasText: `ZZ TEST Shoe ${stamp}` }).isVisible(), 'no picker');
await page.keyboard.press('Escape');

await search.fill(`ZZ TEST Balm ${stamp}`);
await page.waitForTimeout(500);
check('SKU / barcode shown on the product card', (await page.locator('section button:has-text("ZZ TEST Balm")').first().innerText()).includes(lip.sku), lip.sku);
await page.locator('button[title="Table view"]').click();
await page.waitForTimeout(400);
const row = page.locator('tr', { hasText: `ZZ TEST Balm ${stamp}` });
check('Table view: name, SKU / barcode, stock, price', (await row.innerText()).includes(lip.sku) && (await row.innerText()).includes('$8.00'), await row.innerText().catch(() => ''));
await row.click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'data/shots/pos-table.png' });
await page.locator('button[title="Grid view"]').click();
check('Window 1 sale: shoe + balm', /Shoe/.test(await cart()) && /Balm/.test(await cart()), (await cart()).slice(0, 150));
await page.screenshot({ path: 'data/shots/pos-grid.png' });

// second till in a new window
const [win2] = await Promise.all([ctx.waitForEvent('page'), page.locator('button[title="Open another till in a new window"]').click()]);
await win2.waitForLoadState('networkidle');
await win2.waitForTimeout(1500);
const cart2 = async () => (await win2.locator('aside').innerText()).replace(/\s+/g, ' ');
check('New window opens an empty till', /Scan or tap products/.test(await cart2()), (await cart2()).slice(0, 150));
await win2.locator('header input').first().fill(`ZZ TEST Balm ${stamp}`);
await win2.waitForTimeout(500);
await win2.locator('section button:has-text("ZZ TEST Balm")').first().click();
await win2.waitForTimeout(300);
await win2.locator('aside button:has-text("Charge")').click();
await win2.locator('[role=dialog] button:has-text("Complete sale")').click();
await win2.waitForSelector('text=/completed/', { timeout: 30000 }).catch(() => {});
const done2 = (await win2.locator('section').first().innerText()).match(/Sale #(\d+)/);
check('Window 2 sells to its own customer', !!done2, 'no sale');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
check('Window 1 still has its own sale after that', /Shoe/.test(await cart()) && /Balm/.test(await cart()), (await cart()).slice(0, 150));
check('No JavaScript errors', errors.length === 0, errors.join(' | '));
const store = await api('GET', '/api/admin/settings/store');
check('Exchange rate 1 $ = 90,000 LBP', store.secondary_currency?.rate === 90000, JSON.stringify(store.secondary_currency));
await browser.close();

if (done2) { const o = (await api('GET', `/api/pos/orders?q=${done2[1]}`)).find((x) => x.number === done2[1]); if (o) await api('DELETE', `/api/admin/orders/${o.id}`); }
await api('DELETE', `/api/admin/products/${shoe.id}`);
await api('DELETE', `/api/admin/products/${lip.id}`);
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
