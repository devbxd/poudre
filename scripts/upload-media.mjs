// Uploads the WordPress media originals (data/uploads) to the Netlify Blobs store "uploads".
// Usage: NETLIFY_SITE_ID=… NETLIFY_TOKEN=… node scripts/upload-media.mjs   (re-runnable: skips files already there)
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { getStore } from '@netlify/blobs';

const store = getStore({ name: 'uploads', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' };

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

const files = (await walk('data/uploads')).map((p) => relative('data/uploads', p).replaceAll('\\', '/'));
const existing = new Set();
for await (const page of store.list({ prefix: 'uploads/', paginate: true })) for (const b of page.blobs) existing.add(b.key);
const todo = files.filter((f) => !existing.has(`uploads/${f}`));
console.log(`${files.length} files, ${existing.size} already uploaded, ${todo.length} to go`);

let done = 0, failed = 0;
async function worker() {
  for (let f; (f = todo.shift());) {
    for (let attempt = 1; ; attempt++) {
      try {
        const body = await readFile(`data/uploads/${f}`);
        await store.set(`uploads/${f}`, body, { metadata: { contentType: MIME[f.split('.').pop().toLowerCase()] || 'application/octet-stream' } });
        break;
      } catch (e) {
        if (attempt >= 4) { failed++; console.log(`FAILED ${f}: ${e.message}`); break; }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    if (++done % 200 === 0) console.log(`${done} uploaded`);
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
console.log(`Done: ${done} processed, ${failed} failed`);
