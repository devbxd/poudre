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
import { scope, refreshCopy, copyMissing } from './snapshot.js';
import { db, takePendingWrites } from './db.js';

export const app = new Hono();

// Catalogue copy (server/snapshot.js): website pages and the POS catalogue read it instead of waking the database.
// After a request that changed the catalogue (price, product, stock after a sale…), the copy is refreshed in the
// background with only what changed.
const COPY_API = new Set(['/api/pos/catalog', '/api/pos/catalog-version']);
app.use('*', async (c, next) => {
  const store = { useCopy: !c.req.path.startsWith('/api/') || COPY_API.has(c.req.path), changes: { tables: new Set(), stockOnly: true, deleted: false } };
  await scope.run(store, () => next());
  const changes = store.changes.tables.size ? store.changes : takePendingWrites();
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
