import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { auth } from './auth.js';
import { catalog } from './routes/catalog.js';
import { sales } from './routes/sales.js';
import { inventory } from './routes/inventory.js';
import { reports } from './routes/reports.js';
import { content } from './routes/content.js';
import { pos } from './routes/pos.js';
import { serveUpload } from './images.js';
import { onNetlify } from './site/files.js';
import { site, searchPage } from './site/routes.js';
import { shopApi, wcAjax } from './site/shop-api.js';
import { notFound } from './site/pages.js';
import { scope, refreshCopy, copyMissing, setCopySource, noteCatalogChange } from './snapshot.js';
import { db, takePendingWrites } from './db.js';

export const app = new Hono();

if (!onNetlify() && !process.env.SNAPSHOT_OFF) setCopySource((text, params) => db().then((d) => d.query(text, params)));

// Robots looping on shop links pile up options (?view=a&view=b&view=c…): each such page took the server a minute and
// slowed the shop for everyone. A page link never repeats an option, so these get a quick "not found".
// The 2026-11-23 attack sent category pages with 5 to 20 random brands in one filter (?filter_brand=chanel,nike,…):
// every address new, so nothing cached and a heavy search each time. A shopper ticks a few brands, not ten.
const MAX_FILTER_VALUES = 3;
app.use('*', async (c, next) => {
  const q = new URL(c.req.url).searchParams;
  const keys = [...q.keys()].filter((k) => !k.endsWith('[]'));
  const crowdedFilter = [...q.entries()].some(([k, v]) => k.startsWith('filter_') && v.split(',').filter(Boolean).length > MAX_FILTER_VALUES);
  if (c.req.method === 'GET' && !c.req.path.startsWith('/api/') && (new Set(keys).size < keys.length || c.req.url.length > 800 || crowdedFilter)) {
    return c.text('Not found', 404, { 'Cache-Control': 'public, max-age=86400' });
  }
  return next();
});

// Visitors' pages take turns, PAGE_SLOTS at a time, so a flood of them can never slow the dashboard and the POS
// (/api is not in the line) nor exhaust the database. Beyond MAX_WAITING in line, or after WAIT_MS, a short "busy"
// answer that the visitor's browser simply retries.
const PAGE_SLOTS = 4;
const MAX_WAITING = 40;
const WAIT_MS = 10000;
let pagesRunning = 0;
const pageLine = [];
const busy = (c) => c.text('The shop is very busy, please try again in a few seconds.', 503, { 'Retry-After': '5', 'Cache-Control': 'no-store' });
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/wp-content/') || c.req.method !== 'GET') return next();
  if (pagesRunning >= PAGE_SLOTS) {
    if (pageLine.length >= MAX_WAITING) return busy(c);
    const gotSlot = await new Promise((resolve) => {
      const entry = { resolve, timer: setTimeout(() => { pageLine.splice(pageLine.indexOf(entry), 1); resolve(false); }, WAIT_MS) };
      pageLine.push(entry);
    });
    if (!gotSlot) return busy(c);
  } else {
    pagesRunning++;
  }
  try {
    return await next();
  } finally {
    // hand the slot straight to the next page in line, or free it
    const nextInLine = pageLine.shift();
    if (nextInLine) { clearTimeout(nextInLine.timer); nextInLine.resolve(true); } else pagesRunning--;
  }
});

// Catalogue copy (server/snapshot.js): website pages and the POS catalogue read it instead of waking the database.
// After a request that changed the catalogue (price, product, stock after a sale…), the copy is refreshed in the
// background with only what changed.
const COPY_API = new Set(['/api/pos/catalog', '/api/pos/catalog-version']);

// Last time someone used the dashboard or the POS (file data/last-staff-activity): the keep-warm job only keeps the
// database awake for 30 minutes after that, so it sleeps when nobody works (Neon free plan: 100 hours a month).
let lastMark = 0;
app.use('/api/*', async (c, next) => {
  await next();
  if (c.req.path === '/api/pos/catalog-version' || c.req.path === '/api/health' || Date.now() - lastMark < 60000) return;
  lastMark = Date.now();
  import('node:fs/promises').then((fs) => fs.mkdir('data', { recursive: true }).then(() => fs.writeFile('data/last-staff-activity', String(lastMark)))).catch(() => {});
});
// SNAPSHOT_OFF=1 (the database runs on this same machine since 2026-11-20): no copy, every page reads the database;
// only the catalogue version the POS checks every minute is kept, in memory.
const NO_COPY = !!process.env.SNAPSHOT_OFF;
app.use('*', async (c, next) => {
  const store = { useCopy: !NO_COPY && (!c.req.path.startsWith('/api/') || COPY_API.has(c.req.path)), changes: { tables: new Set(), stockOnly: true, deleted: false } };
  await scope.run(store, () => next());
  const changes = store.changes.tables.size ? store.changes : takePendingWrites();
  if (NO_COPY) { if (changes) noteCatalogChange(changes); return; }
  const needs = changes || (store.useCopy && copyMissing());
  if (!needs) return;
  const job = refreshCopy((text, params) => db().then((d) => d.query(text, params)), changes || undefined)
    .catch((e) => console.error('snapshot refresh', e.message));
  const waitUntil = c.env?.context?.waitUntil?.bind(c.env.context);
  if (waitUntil) waitUntil(job); else await job;
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});

const api = new Hono();
api.route('/auth', auth);
api.route('/admin', catalog);
api.route('/admin', sales);
api.route('/admin', inventory);
api.route('/admin/reports', reports);
api.route('/admin', content);
api.route('/pos', pos);
api.get('/health', (c) => c.json({ ok: true }));
app.route('/api', api);

// Theme assets (Netlify serves them as static files before reaching the function)
if (!onNetlify()) (await import('./dev-static.js')).devStatic(app);

// Product and media images (WordPress paths, resized on demand)
app.get('/wp-content/uploads/*', serveUpload);

// Shop pages seen by visitors with no cart, wishlist or login are the same for everyone: Cloudflare and Netlify keep
// them a few minutes so the server and database are not asked again for every visit or robot. Anyone with one of
// these cookies always gets a fresh page.
const VISITOR_COOKIES = /(?:^|;\s*)(poudre_session|poudre_customer|poudre_staff)=/;
const NEVER_SHARED = /^\/(cart|checkout|my-account|wishlist|order-received|lost-password|wp-admin|wp-login|dashboard)(\/|$)/;
app.use('*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' || c.req.path.startsWith('/api/') || c.req.path.startsWith('/wp-content/') || c.req.query('wc-ajax')) return;
  if (!(c.res.headers.get('content-type') || '').includes('text/html')) return;
  if (NEVER_SHARED.test(c.req.path) || c.res.status !== 200 || c.res.headers.get('set-cookie') || VISITOR_COOKIES.test(c.req.header('cookie') || '')) {
    c.res.headers.set('Cache-Control', 'private, no-cache');
    return;
  }
  c.res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=180');
  c.res.headers.set('Netlify-CDN-Cache-Control', 'public, max-age=0, s-maxage=180, stale-while-revalidate=60');
  c.res.headers.set('Netlify-Vary', 'query,cookie=poudre_session|poudre_customer|poudre_staff');
});

// Website: WooCommerce/theme AJAX endpoints first, then pages
app.route('/', shopApi);
app.all('/', async (c, next) => {
  if (c.req.query('wc-ajax')) return wcAjax(c);
  if (c.req.method === 'GET' && c.req.query('s') !== undefined) return searchPage(c);
  return next();
});
app.route('/', site);
app.notFound((c) => (c.req.path.startsWith('/api/') || c.req.path.startsWith('/wp-') ? c.json({ error: 'Not found' }, 404) : notFound(c)));
