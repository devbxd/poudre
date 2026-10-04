// The whole site (pages, API, images) runs in one Netlify function; static assets are served first.
import { handle } from 'hono/netlify';
import { app } from '../../server/app.js';

export default handle(app);

export const config = {
  path: '/*',
  excludedPath: ['/dashboard/*', '/wp-content/themes/*', '/wp-content/plugins/*', '/wp-includes/*'],
  preferStatic: true,
};
