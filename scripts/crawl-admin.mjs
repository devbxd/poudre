// Opens every dashboard page (and a sample of detail pages) and reports crashes, console errors, failed API calls and slow pages.
// Usage: BASE=http://localhost:8787 OWNER_PASSWORD=… node scripts/crawl-admin.mjs
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://localhost:8787') + '/dashboard';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
let current = '';
page.on('pageerror', (e) => problems.push(`${current} CRASH ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && problems.push(`${current} console ${m.text().slice(0, 200)}`));
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) problems.push(`${current} API ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });

await page.goto(BASE + '/');
await page.fill('input[autocomplete=username]', 'jeanclaude');
await page.fill('input[type=password]', process.env.OWNER_PASSWORD);
await page.click('button:has-text("Sign in")');
await page.waitForSelector('nav, aside', { timeout: 15000 });

const api = async (path) => page.evaluate(async (p) => (await fetch(`/api/admin${p}`)).json(), path);

async function visit(path) {
  current = path;
  const t = Date.now();
  await page.goto(BASE + path);
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch { problems.push(`${path} still loading after 20s`); }
  const ms = Date.now() - t;
  if (await page.locator('text=This page could not be displayed').count()) problems.push(`${path} ERROR SCREEN: ${await page.locator('main').innerText().catch(() => '')}`);
  const body = (await page.locator('body').innerText()).trim();
  if (body.length < 20) problems.push(`${path} BLANK PAGE`);
  if (/NaN|undefined|\[object Object\]|Invalid Date/.test(body)) problems.push(`${path} suspicious text: ${body.match(/.{0,40}(NaN|undefined|\[object Object\]|Invalid Date).{0,40}/)?.[0]}`);
  console.log(`${String(ms).padStart(6)} ms  ${path}`);
  if (ms > 4000) problems.push(`${path} slow: ${ms} ms`);
}

const pages = ['/', '/orders', '/orders/new', '/customers', '/coupons', '/reviews', '/products', '/categories', '/brands', '/stock',
  '/purchase-orders', '/suppliers', '/reports', '/website/homepage', '/website/menus', '/website/pages', '/website/blog', '/media', '/messages',
  '/settings', '/settings/store', '/settings/staff', '/settings/shipping', '/settings/payments', '/settings/taxes', '/products?category=19', '/pos'];
for (const p of pages) await visit(p);

const sample = async (path, key = 'items', n = 4) => { const d = await api(path); return (Array.isArray(d) ? d : d[key] || []).slice(0, n); };
for (const p of await sample('/products?per_page=6&sort=-created', 'items', 6)) await visit(`/products/${p.id}`);
for (const p of await sample('/products?type=variable&per_page=3', 'items', 3)) await visit(`/products/${p.id}`);
for (const o of await sample('/orders?per_page=4')) await visit(`/orders/${o.id}`);
for (const c of await sample('/customers?per_page=3&sort=-spent', 'items', 3)) await visit(`/customers/${c.id}`);
for (const po of await sample('/purchase-orders?per_page=3')) await visit(`/purchase-orders/${po.id}`);

console.log(problems.length ? `\n${problems.length} PROBLEMS:\n${[...new Set(problems)].join('\n')}` : '\nno problems found');
await browser.close();
