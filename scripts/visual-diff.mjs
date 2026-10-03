// Pixel comparison between the WordPress screenshots (data/original/shots) and the new site (data/new/shots).
// Usage: node scripts/visual-diff.mjs [name ...]   → writes data/diff/<name>-<device>.png and prints % of different pixels
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const only = process.argv.slice(2);
for (const f of (await readdir('data/new/shots')).filter((f) => f.endsWith('.png'))) {
  const name = f.replace(/-(desktop|mobile)\.png$/, '');
  if (only.length && !only.includes(name)) continue;
  let a, b;
  try { a = PNG.sync.read(await readFile(`data/original/shots/${f}`)); } catch { continue; }
  b = PNG.sync.read(await readFile(`data/new/shots/${f}`));
  const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height);
  const pad = (img) => { const out = new PNG({ width, height }); out.data.fill(255); PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0); return out; };
  const A = pad(a), B = pad(b), D = new PNG({ width, height });
  const n = pixelmatch(A.data, B.data, D.data, width, height, { threshold: 0.1 });
  await writeFile(`data/diff/${f}`, PNG.sync.write(D));
  console.log(`${f.padEnd(34)} ${(n / (width * height) * 100).toFixed(2).padStart(6)}% different  (orig ${a.width}x${a.height}, new ${b.width}x${b.height})`);
}
