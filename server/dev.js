// Local development server: API + uploads + built dashboard
import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app.js';

app.use('/uploads/*', serveStatic({ root: './data' }));
app.use('/admin/assets/*', serveStatic({ root: './dist' }));
app.get('/admin/*', async (c) => c.html(await readFile('dist/admin/index.html', 'utf8')));
app.get('/admin', (c) => c.redirect('/admin/'));

const port = Number(process.env.PORT) || 8787;
serve({ fetch: app.fetch, port }, () => console.log(`Ready on http://localhost:${port}/admin/`));
