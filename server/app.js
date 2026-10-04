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

export const app = new Hono();

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

// Website: WooCommerce/theme AJAX endpoints first, then pages
app.route('/', shopApi);
app.all('/', async (c, next) => {
  if (c.req.query('wc-ajax')) return wcAjax(c);
  if (c.req.method === 'GET' && c.req.query('s') !== undefined) return searchPage(c);
  return next();
});
app.route('/', site);
app.notFound((c) => (c.req.path.startsWith('/api/') || c.req.path.startsWith('/wp-') ? c.json({ error: 'Not found' }, 404) : notFound(c)));
