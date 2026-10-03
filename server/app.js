import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { auth } from './auth.js';
import { catalog } from './routes/catalog.js';
import { sales } from './routes/sales.js';
import { inventory } from './routes/inventory.js';
import { reports } from './routes/reports.js';
import { content } from './routes/content.js';
import { pos } from './routes/pos.js';
import { readStoredFile } from './storage.js';

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

// Images uploaded from the dashboard
app.get('/uploads/new/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace('/uploads/new/', ''));
  const file = await readStoredFile(key);
  if (!file) return c.notFound();
  return c.body(file.body, 200, { 'Content-Type': file.contentType || 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' });
});
