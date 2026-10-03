// Local development server: website + API + dashboard
import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.PORT) || 8787;
serve({ fetch: app.fetch, port }, () => console.log(`Ready on http://localhost:${port}/ (dashboard: /dashboard/)`));
