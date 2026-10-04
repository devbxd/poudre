// Captures the blog pages of the WordPress site (single posts, blog pagination, category/tag/author archives)
// into site/templates/blog/*.json — { path, kind, title, bodyClass, headerClass, main } — served as-is by the new site.
// Usage: node scripts/capture-blog.mjs
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const BASE = 'https://poudrebeauty.com';
const OUT = 'site/templates/blog';
await mkdir(OUT, { recursive: true });

// same clean-up as scripts/extract-templates.mjs
const normalise = (html) => html
  .replace(/<div style="display: none;" data-nosnippet>[\s\S]*?<\/div>/g, (m) => (/kokotogel|koko4d|hoqbet|boba288/.test(m) ? '' : m))
  .replaceAll('https://poudrebeauty.com/', '/')
  .replaceAll('https:\\/\\/poudrebeauty.com\\/', '\\/')
  .replaceAll('//poudrebeauty.com/', '/')
  .replaceAll('"https://poudrebeauty.com"', '"/"')
  .replaceAll('https%3A%2F%2Fpoudrebeauty.com', '')
  .replaceAll('https://poudrebeauty.com', '');

function elementEnd(html, start) {
  const tag = html.slice(start + 1).match(/^[a-zA-Z0-9]+/)[0];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html));) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error('no end');
}

const blog = await readFile('site/templates/blog.main.html', 'utf8');
const post = await readFile('site/templates/post.main.html', 'utf8');
const queue = new Set();
const isBlogPath = (p) => /^\/(category|tag|author)\/[^/]+\/(page\/\d+\/)?$/.test(p) || /^\/blog\/page\/\d+\/$/.test(p);
const collect = (html) => {
  for (const m of html.matchAll(/href="(\/[^"#?\s]*)\s*"/g)) if (isBlogPath(m[1])) queue.add(m[1]);
};
collect(blog); collect(post);

// single posts: every post slug from the export
const posts = JSON.parse(await readFile('data/raw/wp_posts.json', 'utf8').catch(() => '[]'));
for (const p of posts) queue.add(`/${p.slug}/`);
if (!posts.length) for (const m of blog.matchAll(/href="(\/[a-z0-9-]+\/)\s*"/g)) if (!/^\/(category|tag|author|blog|shop|product)/.test(m[1])) queue.add(m[1]);

const done = new Set();
let n = 0;
while (queue.size) {
  const path = [...queue][0];
  queue.delete(path);
  if (done.has(path)) continue;
  done.add(path);
  const res = await fetch(BASE + path, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'manual' });
  if (res.status !== 200) { console.log(res.status, path); continue; }
  const html = normalise(await res.text());
  const ms = html.indexOf('<main');
  const main = html.slice(ms, elementEnd(html, ms));
  collect(main);
  const bodyClass = (html.match(/<body class="([^"]*)"/) || [])[1];
  const kind = /\bsingle-post\b/.test(bodyClass) ? 'post' : 'archive';
  const file = path.replace(/^\/|\/$/g, '').replace(/\//g, '__') || 'index';
  await writeFile(`${OUT}/${file}.json`, JSON.stringify({
    path, kind, capturedAt: new Date().toISOString(), bodyClass, headerClass: (html.match(/<header id="header" class="([^"]*)"/) || [])[1],
    title: ((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(), main,
  }));
  n++;
  console.log(kind.padEnd(8), path);
}
console.log(`${n} pages saved`);
