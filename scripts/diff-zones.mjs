// Lists the vertical zones that differ in a diff image (red pixels from pixelmatch).
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
const img = PNG.sync.read(await readFile(process.argv[2]));
const rows = [];
for (let y = 0; y < img.height; y++) {
  let n = 0, minX = Infinity, maxX = -1;
  for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4;
    if (img.data[i] > 200 && img.data[i + 1] < 80 && img.data[i + 2] < 80) { n++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  }
  rows.push(n ? [minX, maxX] : null);
}
let start = -1, box = null;
for (let y = 0; y <= rows.length; y++) {
  const r = rows[y];
  if (r && start < 0) { start = y; box = [...r]; }
  else if (r) { box[0] = Math.min(box[0], r[0]); box[1] = Math.max(box[1], r[1]); }
  else if (start >= 0) { console.log(`y ${start}-${y - 1} (h ${y - start})  x ${box[0]}-${box[1]}`); start = -1; }
}
