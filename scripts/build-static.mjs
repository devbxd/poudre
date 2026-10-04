// Netlify build: dashboard (vite → dist/dashboard) + theme assets copied to dist/ with their WordPress paths.
import { cp, rm } from 'node:fs/promises';
await rm('dist/_assets-failed.txt', { force: true });
await cp('site/public', 'dist', { recursive: true, filter: (src) => !src.endsWith('_assets-failed.txt') });
console.log('static assets copied to dist/');
