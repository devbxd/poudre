// Production entry on our own server (Google Cloud VM), behind Caddy (HTTPS) and Cloudflare.
// Caddy serves the static files (dashboard, theme, robots.txt…) and hands everything else to this process.
import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.PORT) || 3000;

// what Netlify's runtime provided: work that continues after the response (e-mails, catalogue copy refresh)
const context = { waitUntil: (p) => Promise.resolve(p).catch((e) => console.error('background', e?.message || e)) };

serve({
  hostname: '127.0.0.1',
  port,
  fetch: (req) => {
    // Caddy speaks plain HTTP to us: give the app the public https:// address (links, redirects, secure cookies)
    if (req.headers.get('x-forwarded-proto') === 'https' && req.url.startsWith('http:')) {
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      req = new Request(req.url.replace(/^http:/, 'https:'), { method: req.method, headers: req.headers, body: hasBody ? req.body : undefined, duplex: hasBody ? 'half' : undefined, redirect: 'manual' });
    }
    return app.fetch(req, { context });
  },
}, () => console.log(`poudre listening on 127.0.0.1:${port}`));
