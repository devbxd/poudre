// POS failure scenarios: duplicates, lost connection, lost response, reload mid-sale, double submit.
// Checks that a sale is never lost and never counted twice. Creates a "ZZ TEST" product and removes everything after.
// Usage: BASE=http://localhost:8787 OWNER_PASSWORD=… node scripts/test-pos-resilience.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8787';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${String(detail).slice(0, 250)}`}`); };
let cookie = '';
const api = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body && JSON.stringify(body) });
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
await api('POST', '/api/auth/login', { username: 'jeanclaude', password: process.env.OWNER_PASSWORD });
const stamp = Date.now();
const prod = (await api('POST', '/api/admin/products', { name: `ZZ TEST Gloss ${stamp}`, type: 'simple', status: 'publish', regular_price: 10, manage_stock: true, stock_quantity: 100, pos_visible: true, online_visible: false })).data;
const stock = async () => (await api('POST', '/api/pos/stock', { ids: [prod.id] })).data[0]?.stock_quantity;
const ordersFor = async () => {
  const all = (await api('GET', `/api/admin/orders?q=${encodeURIComponent(`ZZ TEST Gloss ${stamp}`)}&per_page=50`)).data.items || [];
  return all;
};
const created = new Set();

// 1. same sale sent twice
const ref = `test-${stamp}-a`;
const body = { client_ref: ref, items: [{ product_id: prod.id, quantity: 1 }], payment_method: 'cash' };
const a = await api('POST', '/api/pos/orders', body);
const b = await api('POST', '/api/pos/orders', body);
created.add(a.data.id);
check('Same sale sent twice → one order', a.status === 201 && b.status === 200 && a.data.id === b.data.id, `${a.status}/${b.status} ${a.data.id}/${b.data.id}`);
check('…and stock counted once (99)', (await stock()) === 99, await stock());

// 2. same sale sent twice at the same moment
const ref2 = `test-${stamp}-b`;
const [c1, c2] = await Promise.all([1, 2].map(() => api('POST', '/api/pos/orders', { ...body, client_ref: ref2 })));
created.add(c1.data.id); created.add(c2.data.id);
check('Same sale twice at the same moment → one order', c1.data.id && c1.data.id === c2.data.id, `${c1.status}:${c1.data.id} / ${c2.status}:${c2.data.id}`);
check('…and stock counted once (98)', (await stock()) === 98, await stock());

// 3. sale made offline, synced later, keeps its time
const t = new Date(Date.now() - 3600000).toISOString();
const off = await api('POST', '/api/pos/orders', { ...body, client_ref: `test-${stamp}-c`, offline_at: t });
created.add(off.data.id);
check('Offline sale keeps the time it was made', off.status === 201 && Math.abs(new Date(off.data.created_at) - new Date(t)) < 2000, `${off.data.created_at} vs ${t}`);

// UI scenarios
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => { window.print = () => {}; });
await page.goto(`${BASE}/dashboard/`);
await page.fill('input[autocomplete=username]', 'jeanclaude');
await page.fill('input[type=password]', process.env.OWNER_PASSWORD);
await page.click('button:has-text("Sign in")');
await page.waitForSelector('text=Open POS', { timeout: 15000 });
await page.goto(`${BASE}/dashboard/pos`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const closeRegisterPopup = async () => { const d = page.locator('[role=dialog]:has-text("Open the register")'); if (await d.isVisible().catch(() => false)) { await d.locator('input').fill('0'); await d.locator('button:has-text("Open register")').click(); await page.waitForTimeout(1200); } };
await closeRegisterPopup();
const addGloss = async (n = 1) => {
  const search = page.locator('header input').first();
  for (let i = 0; i < n; i++) {
    await search.fill(`ZZ TEST Gloss ${stamp}`);
    await page.waitForTimeout(400);
    await page.locator('section button:has-text("ZZ TEST Gloss")').first().click();
    await page.waitForTimeout(200);
  }
};
const charge = async () => {
  await page.locator('aside button:has-text("Charge")').click();
  await page.waitForSelector('[role=dialog]:has-text("Amount due")');
};
const cartText = async () => (await page.locator('aside').innerText()).replace(/\s+/g, ' ');

// 4. reload in the middle of a sale
await addGloss(2);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
check('Reload mid-sale → the sale is still there', /ZZ TEST Gloss/.test(await cartText()) && /Charge \$20\.00/.test(await cartText()), (await cartText()).slice(0, 150));

// 5. double click + Enter on "Complete sale"
const before5 = await stock();
await charge();
const btn = page.locator('[role=dialog] button:has-text("Complete sale")');
await Promise.all([btn.click({ timeout: 3000 }).catch(() => {}), btn.click({ force: true, timeout: 3000 }).catch(() => {}), page.keyboard.press("Enter").catch(() => {})]);
await page.waitForSelector('text=/completed/', { timeout: 20000 });
await page.waitForTimeout(2000);
check('Double click + Enter → sold once (−2)', (await stock()) === before5 - 2, `${before5} → ${await stock()}`);

// 6. no connection at checkout → saved on the device, sent automatically later
const before6 = await stock();
await addGloss(1);
await charge();
await ctx.setOffline(true);
await page.locator('[role=dialog] button:has-text("Complete sale")').click();
await page.waitForSelector('text=/saved on this device/', { timeout: 30000 }).catch(() => {});
const banner = (await page.locator('section').first().innerText()).replace(/\s+/g, ' ');
check('No connection → sale saved on the device, receipt available', /saved on this device/.test(banner), banner.slice(0, 200));
check('Header shows "Offline · 1 to send"', /Offline · 1 to send/.test(await page.locator('header').innerText()), await page.locator('header').innerText());
check('Cart cleared for the next customer', /Scan or tap products/.test(await cartText()), (await cartText()).slice(0, 100));
check('Nothing reached the server yet', (await stock()) === before6, await stock());
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(6000);
check('Connection back → offline sale sent automatically (−1)', (await stock()) === before6 - 1, `${before6} → ${await stock()}`);
check('Nothing left to send', !/to send/.test(await page.locator('header').innerText()), await page.locator('header').innerText());

// 7. server saves the sale but the answer is lost → retry must not duplicate
const before7 = await stock();
let dropped = 0;
await page.route('**/api/pos/orders', async (route) => {
  if (route.request().method() === 'POST' && dropped < 1) { dropped++; await route.fetch().catch(() => {}); return route.abort('connectionreset'); }
  return route.continue();
});
await addGloss(1);
await charge();
await page.locator('[role=dialog] button:has-text("Complete sale")').click();
await page.waitForSelector('text=/completed|saved on this device/', { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(3000);
await page.unroute('**/api/pos/orders');
check('Answer lost after the server saved it → sold once (−1)', (await stock()) === before7 - 1, `${before7} → ${await stock()}`);

check('No JavaScript errors', errors.length === 0, errors.join(' | '));
await browser.close();

// cleanup
for (const o of await ordersFor()) await api('DELETE', `/api/admin/orders/${o.id}`);
for (const id of created) if (id) await api('DELETE', `/api/admin/orders/${id}`);
await api('DELETE', `/api/admin/products/${prod.id}`);
const left = await ordersFor();
check('Test data removed', left.length === 0, left.length);
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
