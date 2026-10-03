// Stacks the same region of the original and new screenshot (original on top) for a visual check.
// Usage: node scripts/crop-compare.mjs <shot name> <left> <top> <width> <height> <out>
import sharp from 'sharp';
const [name, l, t, w, h, out] = process.argv.slice(2);
const region = { left: +l, top: +t, width: +w, height: +h };
const a = await sharp(`data/original/shots/${name}.png`).extract(region).toBuffer();
const b = await sharp(`data/new/shots/${name}.png`).extract(region).toBuffer();
await sharp({ create: { width: +w, height: +h * 2 + 6, channels: 3, background: '#ff0000' } })
  .composite([{ input: a, top: 0, left: 0 }, { input: b, top: +h + 6, left: 0 }]).png().toFile(out);
