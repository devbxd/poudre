// Downloads every WordPress media original into data/uploads (same path as wp-content/uploads)
// Usage: node scripts/download-media.mjs   (re-runnable, skips files already downloaded)
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

const media = JSON.parse(await readFile('data/raw/wp_media.json', 'utf8'));
const urls = [...new Set(media.map((m) => m.source_url))];
const CONCURRENCY = 6;
let done = 0, skipped = 0, failed = [];

async function download(url) {
  const rel = decodeURIComponent(new URL(url).pathname).replace(/^\/wp-content\/uploads\//, '');
  const out = `data/uploads/${rel}`;
  try { if ((await stat(out)).size > 0) { skipped++; return; } } catch {}
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, Buffer.from(await res.arrayBuffer()));
      done++;
      return;
    } catch (e) {
      if (attempt === 3) failed.push(`${url} ${e.message}`);
      else await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

for (let i = 0; i < urls.length; i += CONCURRENCY) {
  await Promise.all(urls.slice(i, i + CONCURRENCY).map(download));
  if (i % 300 === 0) console.log(`progress ${i}/${urls.length}`);
}
await writeFile('data/uploads/_failed.txt', failed.join('\n'));
console.log(`done: ${done} downloaded, ${skipped} skipped, ${failed.length} failed`);
