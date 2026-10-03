// Char-level comparison of <main> (until related products) between an original page and the local render.
import { readFile } from 'node:fs/promises';
const [orig, path] = process.argv.slice(2);
const N = (h) => h.replaceAll('https://poudrebeauty.com/', '/').replaceAll('https:\\/\\/poudrebeauty.com\\/', '\\/').replace(/quantity_[0-9a-f]+/g, 'Q').replace(/product-visitor-count">\d/, 'V')
  .replace(/pls-delivery-date">[^<]*</, 'D<').replace(/ (loading="lazy"|decoding="async"|fetchpriority="high")/g, '').replace(/ product_tag-[a-z0-9-]+/g, '');
const cutMain = (h) => { const i = h.indexOf('<main'); const j = h.indexOf('<section class="related products">', i); return h.slice(i, j > 0 ? j : h.indexOf('</main>', i)); };
const a = cutMain(N(await readFile(orig, 'utf8')));
const b = cutMain(N(await (await fetch(`http://localhost:8787${path}`)).text()));
let i = 0; while (i < a.length && a[i] === b[i]) i++;
if (i === a.length && a.length === b.length) console.log(`✓ ${path} identical (${a.length} chars)`);
else console.log(`✗ ${path} differs at ${i} (${a.length} vs ${b.length})\n  O: ${JSON.stringify(a.slice(i - 100, i + 120))}\n  N: ${JSON.stringify(b.slice(i - 100, i + 120))}`);
