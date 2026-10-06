// Clicks through the main dashboard forms like the shop owner, checks the result through the API, removes the test data.
// Usage: BASE=http://localhost:8787 OWNER_PASSWORD=… node scripts/test-dashboard-ui.mjs
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
const stamp = Date.now() % 1000000;
const name = `ZZ TEST Serum ${stamp}`;
const cleanup = { products: [], coupons: [], customers: [], suppliers: [], orders: [], pos: [] };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const toast = async () => (await page.locator('body').innerText()).match(/(saved|created|updated|added|received|deleted)/i)?.[0];
const field = (label) => page.locator('label', { has: page.locator(`xpath=./span[normalize-space(text())="${label}"]`) }).locator('input, select, textarea').first();
const step = async (label, fn) => { try { await fn(); } catch (e) { check(label, false, e.message.split('\n')[0]); await page.screenshot({ path: `data/shots/ui-fail-${label.replace(/\W+/g, '_')}.png` }); } };

await page.goto(`${BASE}/dashboard/`);
await page.fill('input[autocomplete=username]', 'jeanclaude');
await page.fill('input[type=password]', process.env.OWNER_PASSWORD);
await page.click('button:has-text("Sign in")');
await page.waitForSelector('text=Open POS', { timeout: 15000 });
check('Log in to the dashboard', true);

let productId;
await step('Create a product from the form', async () => {
  await page.goto(`${BASE}/dashboard/products/new`, { waitUntil: 'networkidle' });
  await field('Name').fill(name);
  await field('Price').fill('30');
  await field('Quantity in stock').fill('8');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await page.waitForURL(/\/products\/\d+/, { timeout: 20000 });
  productId = Number(page.url().match(/products\/(\d+)/)[1]);
  cleanup.products.push(productId);
  const p = await api('GET', `/api/admin/products/${productId}`);
  check('Create a product from the form', p.name === name && Number(p.regular_price) === 30 && p.stock_quantity === 8, JSON.stringify(p).slice(0, 200));
});

await step('Edit the price and save', async () => {
  await field('Price').fill('35');
  await field('Sale price').fill('29');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await page.waitForTimeout(3000);
  const p = await api('GET', `/api/admin/products/${productId}`);
  check('Edit the price and save (35, sale 29)', Number(p.regular_price) === 35 && Number(p.sale_price) === 29, JSON.stringify({ r: p.regular_price, s: p.sale_price }));
});

await step('Change stock on the Stock page', async () => {
  await page.goto(`${BASE}/dashboard/stock`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Name or SKU — scan a barcode here').fill(name);
  await page.waitForTimeout(2500);
  const row = page.locator('tr', { hasText: name }).first();
  await row.locator('input[type=number]').first().fill('15');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(3000);
  const st = await api('POST', '/api/pos/stock', { ids: [productId] });
  check('Change stock on the Stock page (→ 15)', st[0]?.stock_quantity === 15, JSON.stringify(st));
});

let supplierId;
await step('Create a supplier', async () => {
  await page.goto(`${BASE}/dashboard/suppliers`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await page.locator('[role=dialog] input').first().fill(`ZZ TEST Supplier ${stamp}`);
  await page.locator('[role=dialog]').getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(2500);
  const list = await api('GET', '/api/admin/suppliers');
  const s = (list.items || list).find((x) => x.name === `ZZ TEST Supplier ${stamp}`);
  supplierId = s?.id; if (s) cleanup.suppliers.push(s.id);
  check('Create a supplier', !!s, JSON.stringify(list).slice(0, 150));
});

await step('Purchase order: create and receive', async () => {
  await page.goto(`${BASE}/dashboard/purchase-orders/new`, { waitUntil: 'networkidle' });
  if (supplierId) await field('Supplier').selectOption(String(supplierId)).catch(() => {});
  const picker = page.locator('main input[placeholder]').filter({ hasNot: page.locator('[type=date]') }).last();
  const pickers = page.locator('main input[placeholder*="roduct" i], main input[placeholder*="scan" i], main input[placeholder*="search" i]');
  const input = (await pickers.count()) ? pickers.last() : picker;
  await input.fill(name);
  await page.waitForTimeout(2500);
  await input.press('Enter');
  await page.waitForTimeout(800);
  const qty = page.locator('main tr', { hasText: name }).locator('input[type=number]');
  await qty.nth(0).fill('10');
  if (await qty.count() > 1) await qty.nth(1).fill('6');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await page.waitForURL(/purchase-orders\/\d+/, { timeout: 20000 });
  const poId = Number(page.url().match(/purchase-orders\/(\d+)/)[1]);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Receive goods|Receive everything/ }).first().click();
  await page.waitForTimeout(800);
  const all = page.getByRole('button', { name: 'Receive everything' });
  if (await all.isVisible().catch(() => false)) await all.click();
  await page.waitForTimeout(3500);
  const po = await api('GET', `/api/admin/purchase-orders/${poId}`);
  const st = await api('POST', '/api/pos/stock', { ids: [productId] });
  check('Purchase order: create and receive (+10 → 25)', po.status === 'received' && st[0]?.stock_quantity === 25, `${po.status} / ${st[0]?.stock_quantity}`);
  await api('DELETE', `/api/admin/purchase-orders/${poId}`);
});

await step('Create a coupon', async () => {
  await page.goto(`${BASE}/dashboard/coupons`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create coupon' }).click();
  await field('Code').fill(`ZZTEST${stamp}`);
  await page.locator('[role=dialog] label', { hasText: 'Discount' }).locator('input').first().fill('15');
  await page.locator('[role=dialog]').getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(2500);
  const list = await api('GET', '/api/admin/coupons');
  const c = (list.items || list).find((x) => x.code?.toLowerCase() === `zztest${stamp}`);
  if (c) cleanup.coupons.push(c.id);
  check('Create a coupon (15)', c && Number(c.amount) === 15, JSON.stringify(list).slice(0, 200));
});

let customerId;
await step('Add a customer', async () => {
  await page.goto(`${BASE}/dashboard/customers`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add customer' }).click();
  await field('First name').fill('ZZ');
  await field('Last name').fill(`TEST ${stamp}`);
  await field('Phone').fill(`70${stamp}`);
  await page.locator('[role=dialog]').getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(2500);
  const list = await api('GET', `/api/admin/customers?q=${stamp}`);
  const c = list.items?.find((x) => x.last_name === `TEST ${stamp}`);
  customerId = c?.id; if (c) cleanup.customers.push(c.id);
  check('Add a customer', !!c, JSON.stringify(list).slice(0, 200));
});

await step('Change an order status', async () => {
  const o = await api('POST', '/api/admin/orders', { items: [{ product_id: productId, quantity: 1 }], customer_id: customerId, status: 'processing', payment_method: 'cod', billing: { first_name: 'ZZ', last_name: 'TEST' } });
  cleanup.orders.push(o.id);
  await page.goto(`${BASE}/dashboard/orders/${o.id}`, { waitUntil: 'networkidle' });
  await page.locator('select:has(option[value="completed"])').first().selectOption('completed');
  await page.waitForTimeout(3000);
  const after = await api('GET', `/api/admin/orders/${o.id}`);
  check('Change an order status (processing → completed)', after.status === 'completed', after.status);
  await page.getByPlaceholder('Add a private note…').fill('ZZ TEST note');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForTimeout(2500);
  const withNote = await api('GET', `/api/admin/orders/${o.id}`);
  check('Add a note to an order', withNote.notes?.some((n) => n.note === 'ZZ TEST note'), JSON.stringify(withNote.notes).slice(0, 150));
});

await step('Save shop settings', async () => {
  await page.goto(`${BASE}/dashboard/settings/store`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(2000);
  check('Save shop settings', /saved/i.test(await toast() || ''), await toast());
});

for (const path of ['/', '/orders', '/products', '/categories', '/brands', '/stock', '/purchase-orders', '/suppliers', '/customers', '/coupons', '/reviews', '/reports', '/website/homepage', '/website/menus', '/website/pages', '/website/blog', '/media', '/messages', '/settings/store', '/settings/shipping', '/settings/payments', '/settings/emails', '/settings/pos', '/settings/registers', '/settings/team', '/settings/activity', '/settings/account']) {
  await page.goto(`${BASE}/dashboard${path}`, { waitUntil: 'networkidle' }).catch(() => {});
  const text = await page.locator('main').innerText().catch(() => '');
  check(`Page ${path} opens`, text.length > 20 && !/could not be displayed/.test(text), text.slice(0, 120));
}
check('No JavaScript errors anywhere', errors.length === 0, errors.join(' | '));
await browser.close();

for (const id of cleanup.orders) await api('DELETE', `/api/admin/orders/${id}`);
for (const id of cleanup.products) await api('DELETE', `/api/admin/products/${id}`);
for (const id of cleanup.coupons) await api('DELETE', `/api/admin/coupons/${id}`);
for (const id of cleanup.customers) await api('DELETE', `/api/admin/customers/${id}`);
for (const id of cleanup.suppliers) await api('DELETE', `/api/admin/suppliers/${id}`);
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
