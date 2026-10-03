// Local development only: serves the dashboard build and theme assets (Netlify serves them as static files)
import { readFile } from 'node:fs/promises';
import { serveStatic } from '@hono/node-server/serve-static';

export function devStatic(a) {
  a.use('/dashboard/assets/*', serveStatic({ root: './dist' }));
  a.get('/dashboard/*', async (c) => c.html(await readFile('dist/dashboard/index.html', 'utf8')));
  a.get('/dashboard', (c) => c.redirect('/dashboard/'));
  for (const p of ['/wp-content/themes/*', '/wp-content/plugins/*', '/wp-content/uploads/elementor/*', '/wp-content/uploads/pum/*', '/wp-includes/*']) {
    a.use(p, serveStatic({ root: './site/public' }));
  }
}
