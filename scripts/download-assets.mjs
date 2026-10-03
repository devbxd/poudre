// Downloads every theme/plugin asset (css, js, fonts, images referenced from css) used by the captured pages
// into site/public, keeping the original paths (wp-content/..., wp-includes/...).
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

const SITE = 'https://poudrebeauty.com';
const OUT = 'site/public';
const queue = new Set();
const done = new Set();

const add = (u, base = SITE + '/') => {
  try {
    if (!u || u.startsWith('data:') || u.startsWith('#')) return;
    const url = new URL(u.replace(/&amp;/g, '&').replace(/&#038;/g, '&'), base);
    if (!/(^|\.)poudrebeauty\.com$/.test(url.hostname)) return;
    if (!/^\/(wp-content|wp-includes)\//.test(url.pathname)) return;
    if (url.pathname.startsWith('/wp-content/uploads/') && !/\/(elementor|pum|wc-logs)\//.test(url.pathname) && !/\.(css|js)$/.test(url.pathname)) {
      // product/media images are already in data/uploads
      return;
    }
    url.search = '';
    url.hash = '';
    if (!done.has(url.href)) queue.add(url.href);
  } catch { /* ignore bad urls */ }
};

for (const f of await readdir('data/original/html')) {
  const html = await readFile(`data/original/html/${f}`, 'utf8');
  for (const m of html.matchAll(/(?:href|src|data-src|srcset)=["']([^"']+)["']/g)) m[1].split(',').forEach((s) => add(s.trim().split(' ')[0]));
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) add(m[1]);
  // script configs often hold escaped urls: https:\/\/poudrebeauty.com\/wp-content\/...
  const unescaped = html.split('\\/').join('/');
  for (const m of unescaped.matchAll(/https?:\/\/poudrebeauty\.com(\/wp-(?:content|includes)\/[^"'\s]+?\.(?:css|js|woff2?|ttf|svg|png|gif|jpe?g|webp))/g)) add(SITE + m[1]);
}

let ok = 0, failed = [];
while (queue.size) {
  const batch = [...queue].slice(0, 8);
  batch.forEach((u) => { queue.delete(u); done.add(u); });
  await Promise.all(batch.map(async (u) => {
    const path = OUT + decodeURIComponent(new URL(u).pathname);
    let body;
    try {
      if ((await stat(path)).size > 0) body = await readFile(path);
    } catch { /* not downloaded yet */ }
    if (!body) {
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) { failed.push(`${res.status} ${u}`); return; }
      body = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      ok++;
    }
    if (u.endsWith('.css')) {
      // follow fonts / images / imports referenced by the stylesheet
      const css = body.toString('utf8');
      for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) add(m[1], u);
      for (const m of css.matchAll(/@import\s+['"]([^'"]+)['"]/g)) add(m[1], u);
    }
  }));
}
await writeFile('site/public/_assets-failed.txt', failed.join('\n'));
console.log(`downloaded ${ok}, total known ${done.size}, failed ${failed.length}`);
