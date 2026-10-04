// Generates every WordPress image size (media.sizes) from the originals in data/uploads and uploads them
// to the Netlify Blobs store "uploads", so no image is resized on the fly when a visitor first sees it.
// Usage: NETLIFY_SITE_ID=… NETLIFY_TOKEN=… DATABASE_URL=… node scripts/pregen-sizes.mjs   (re-runnable)
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { getStore } from '@netlify/blobs';
import { query } from '../server/db.js';

const store = getStore({ name: 'uploads', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
const extra = (process.env.EXTRA_SIZES || '150x150,500x500').split(',').map((s) => s.split('x').map(Number));

const existing = new Set();
for await (const page of store.list({ prefix: 'uploads/', paginate: true })) for (const b of page.blobs) existing.add(b.key);

const jobs = [];
for (const m of await query(`select url, sizes from media where url like '/wp-content/uploads/%'`)) {
  const path = m.url.replace('/wp-content/uploads/', '');
  const ext = path.split('.').pop().toLowerCase();
  if (!MIME[ext] || ext === 'gif') continue;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const base = path.slice(dir.length).replace(/(-scaled)?\.[^.]+$/, '');
  const files = new Map((m.sizes || []).map((s) => [`${dir}${s.file}`, [s.width, s.height]]));
  // square sizes used by the dashboard and POS
  for (const [w, h] of extra) files.set(`${dir}${base}-${w}x${h}.${path.split('.').pop()}`, [w, h]);
  for (const [file, [w, h]] of files) if (!existing.has(`uploads/${file}`)) jobs.push({ original: path, file, w, h });
}
console.log(`${existing.size} files already stored, ${jobs.length} sizes to generate`);

let done = 0, failed = 0;
async function worker() {
  for (let j; (j = jobs.shift());) {
    try {
      const src = `data/uploads/${j.original}`;
      if (!existsSync(src)) throw new Error('original missing');
      const ext = j.file.split('.').pop().toLowerCase();
      let img = sharp(await readFile(src)).rotate().resize(j.w, j.h, { fit: 'cover', position: 'centre' });
      if (/jpe?g/.test(ext)) img = img.jpeg({ quality: 82, mozjpeg: true });
      else if (ext === 'webp') img = img.webp({ quality: 82 });
      else if (ext === 'png') img = img.png({ compressionLevel: 9 });
      const body = await img.toBuffer();
      for (let attempt = 1; ; attempt++) {
        try { await store.set(`uploads/${j.file}`, body, { metadata: { contentType: MIME[ext] } }); break; }
        catch (e) { if (attempt >= 4) throw e; await new Promise((r) => setTimeout(r, 1000 * attempt)); }
      }
    } catch (e) { failed++; if (failed < 30) console.log(`FAILED ${j.file}: ${e.message}`); }
    if (++done % 1000 === 0) console.log(`${done} done`);
  }
}
await Promise.all(Array.from({ length: Number(process.env.WORKERS) || 24 }, worker));
console.log(`Done: ${done} processed, ${failed} failed`);
process.exit(0);
