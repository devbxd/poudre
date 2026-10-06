// Clicks through the POS like a cashier (tablet and desktop sizes). Creates "ZZ TEST" products, removes everything after.
// Usage: BASE=http://localhost:8787 OWNER_PASSWORD=… node scripts/test-pos-ui.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8787';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${detail}`}`); };

// test data through the API
let cookie = '';
const api = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body && JSON.stringify(body) });
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  return res.json().catch(() => ({}));
};
await api('POST', '/api/auth/login', { username: 'jeanclaude', password: process.env.OWNER_PASSWORD });
const stamp = Date.now();
const barcode = `77${stamp}`.slice(0, 13);
const simple = await api('POST', '/api/admin/products', { name: `ZZ TEST Mascara ${stamp}`, type: 'simple', status: 'publish', regular_price: 12, manage_stock: true, stock_quantity: 20, barcode, pos_visible: true, online_visible: false });
const variable = await api('POST', '/api/admin/products', {
  name: `ZZ TEST Cologne ${stamp}`, type: 'variable', status: 'publish', regular_price: 40, pos_visible: true, online_visible: false,
  attributes: [{ name: 'Size', options: ['30ml', '90ml'], variation: true, visible: true }],
  variations: [{ attributes: [{ name: 'Size', option: '30ml' }], regular_price: 40, manage_stock: true, stock_quantity: 6, status: 'publish' },
    { attributes: [{ name: 'Size', option: '90ml' }], regular_price: 70, manage_stock: true, stock_quantity: 4, status: 'publish' }],
});
const session = await api('GET', '/api/pos/session');
if (session) await api('POST', '/api/pos/session/close', { closing_cash: 0, notes: 'closed before UI test' });
const created = [];

const browser = await chromium.launch();
for (const [label, viewport] of [['tablet', { width: 1024, height: 768 }], ['desktop', { width: 1440, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await page.goto(`${BASE}/dashboard/`);
  await page.fill('input[autocomplete=username]', 'jeanclaude');
  await page.fill('input[type=password]', process.env.OWNER_PASSWORD);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('text=Open POS', { timeout: 15000 });
  await page.goto(`${BASE}/dashboard/pos`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // register
  const openBtn = page.getByRole('button', { name: /Open register/ }).first();
  if (await openBtn.isVisible().catch(() => false)) {
    await openBtn.click();
    await page.waitForTimeout(500);
    const cashInput = page.locator('[role=dialog] input').first();
    if (await cashInput.isVisible().catch(() => false)) {
      await cashInput.fill('50');
      await page.locator('[role=dialog] button:has-text("Open register")').last().click();
      await page.waitForTimeout(1200);
    }
  }
  await page.screenshot({ path: `data/shots/pos-reg-${label}.png` });
  console.log('dialog after register:', (await page.locator('[role=dialog]').allInnerTexts()).join(' / ').replace(/s+/g, ' ').slice(0, 300));
  const sess = await api('GET', '/api/pos/session');
  check(`[${label}] Open register`, sess && Number(sess.opening_cash) >= 0, JSON.stringify(sess).slice(0, 100));

  const search = page.locator('header input').first();
  // search by name → add
  await search.fill(`ZZ TEST Mascara ${stamp}`);
  await page.waitForTimeout(500);
  await page.locator('section button:has-text("ZZ TEST Mascara")').first().click();
  await page.waitForTimeout(400);
  // barcode scan (type + Enter) → second unit
  await search.fill(barcode);
  await search.press('Enter');
  await page.waitForTimeout(600);
  const cartText = async () => (await page.locator('aside').innerText()).replace(/\s+/g, ' ');
  check(`[${label}] Add by name + barcode scan → quantity 2`, /ZZ TEST Mascara/.test(await cartText()) && (await page.locator('aside input').nth(1).inputValue().catch(() => '')) === '2', (await cartText()).slice(0, 200));

  // product with options
  await search.fill(`ZZ TEST Cologne ${stamp}`);
  await page.waitForTimeout(500);
  await page.locator('section button:has-text("ZZ TEST Cologne")').first().click();
  await page.waitForTimeout(400);
  await page.locator('[role=dialog] button:has-text("90ml")').first().click();
  await page.waitForTimeout(400);
  check(`[${label}] Choose a size (90ml)`, /Cologne.*90ml/.test(await cartText()), (await cartText()).slice(0, 200));

  // hold & resume
  await page.locator('aside button:has-text("Hold")').click();
  await page.waitForTimeout(500);
  const emptyAfterHold = /Scan or tap products/.test(await cartText());
  await page.locator('header button:has-text("On hold")').click();
  await page.waitForTimeout(400);
  await page.locator('[role=dialog] button:has-text("Resume")').first().click();
  await page.waitForTimeout(500);
  check(`[${label}] Hold sale, then resume it`, emptyAfterHold && /Cologne/.test(await cartText()), (await cartText()).slice(0, 200));

  // custom item
  await page.locator('aside button:has-text("Custom item")').click();
  await page.waitForTimeout(300);
  await page.locator('[role=dialog] input').nth(0).fill('ZZ TEST gift wrap');
  await page.locator('[role=dialog] input').nth(1).fill('3');
  await page.locator('[role=dialog] button:has-text("Add to sale")').click();
  await page.waitForTimeout(400);
  check(`[${label}] Custom item added`, /gift wrap/.test(await cartText()), (await cartText()).slice(0, 200));

  // total = 2×12 + 70 + 3 = 97 → pay cash 100, change 3
  const chargeText = await page.locator('aside button:has-text("Charge")').innerText();
  check(`[${label}] Total $97.00`, /97\.00/.test(chargeText), chargeText);
  await page.locator('aside button:has-text("Charge")').click();
  await page.waitForTimeout(500);
  const cashBtn = page.locator('[role=dialog] button', { hasText: /^Cash$/ }).first();
  if (await cashBtn.isVisible().catch(() => false)) await cashBtn.click();
  await page.locator('[role=dialog] input[type=number]').first().fill('100');
  await page.waitForTimeout(300);
  const changeTxt = await page.locator('[role=dialog]').innerText();
  check(`[${label}] Change to give $3.00`, /Change to give:\s*\$3\.00/.test(changeTxt.replace(/\s+/g, ' ')), changeTxt.replace(/\s+/g, ' ').slice(0, 200));
  const t0 = Date.now();
  await page.locator('[role=dialog] button:has-text("Complete sale")').click();
  await page.waitForSelector('text=/Sale #\d+ completed/', { timeout: 20000 }).catch(() => {});
  console.log(`   (sale took ${Date.now() - t0} ms)`);
  const doneTxt = (await page.locator('section').first().innerText()).replace(/\s+/g, ' ');
  const m = doneTxt.match(/Sale #(\d+) completed/);
  check(`[${label}] Sale completed`, !!m, doneTxt.slice(0, 200));
  if (m) {
    const orders = await api('GET', `/api/pos/orders?q=${m[1]}`);
    const o = orders.find((x) => x.number === m[1]);
    if (o) created.push(o.id);
    check(`[${label}] Sale saved: $97, cash`, o && Number(o.total) === 97 && /cash/i.test(o.payment_method), JSON.stringify(o).slice(0, 200));
  }
  check(`[${label}] Cart emptied after sale`, /Scan or tap products/.test(await cartText()), (await cartText()).slice(0, 100));
  const receipt = page.locator('section button:has-text("Receipt")').first();
  if (await receipt.isVisible().catch(() => false)) { await receipt.click(); await page.waitForTimeout(800); }
  check(`[${label}] Print receipt`, (await page.evaluate(() => window.__printed || 0)) >= 1 || (await page.locator('iframe').count()) > 0, 'print not triggered');

  // sales drawer
  await page.locator('header button[title="Sales"]').click();
  await page.waitForTimeout(1200);
  check(`[${label}] Sales list opens and shows the sale`, m && (await page.locator('[role=dialog]').innerText().catch(() => '')).includes(m[1]), 'drawer');
  if (m) {
    await page.locator(`[role=dialog] button:has-text("#${m[1]}")`).first().click();
    await page.waitForTimeout(1500);
    const plus = page.locator('[role=dialog] li', { hasText: 'ZZ TEST Mascara' }).locator('button').last();
    await plus.click();
    await page.locator('[role=dialog] button:has-text("Refund selected items")').click();
    await page.waitForTimeout(4000);
    const after = await api('GET', `/api/pos/orders?q=${m[1]}`);
    const ro = after.find((x) => x.number === m[1]);
    check(`[${label}] Refund 1 mascara from the POS ($12)`, ro && Number(ro.refunded_total) === 12, JSON.stringify(ro).slice(0, 200));
  }
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `data/shots/pos-${label}.png` });
  check(`[${label}] No JavaScript errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();

// stock check & cleanup
const st = await api('POST', '/api/pos/stock', { ids: [simple.id, variable.id] });
const mascara = st.find((x) => x.id === simple.id && !x.variation_id)?.stock_quantity;
check('Stock after 2 sales and 2 refunds: mascara 20 − 4 + 2 = 18', mascara === 18, mascara);
for (const id of created) await api('DELETE', `/api/admin/orders/${id}`);
await api('DELETE', `/api/admin/products/${simple.id}`);
await api('DELETE', `/api/admin/products/${variable.id}`);
await api('POST', '/api/pos/session/close', { closing_cash: 0, notes: 'ZZ TEST' });
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
