// Compares a page of the new site with the captured WordPress page (HTML level).
// Usage: node scripts/compare-page.mjs <original file> <local path> [max diffs]
import { readFile } from 'node:fs/promises';

const [orig, path, max = 12] = process.argv.slice(2);
const normalize = (h) => h
  .replaceAll('https://poudrebeauty.com/', '/').replaceAll('https:\\/\\/poudrebeauty.com\\/', '\\/').replaceAll('//poudrebeauty.com/', '/').replaceAll('https://poudrebeauty.com', '')
  .replace(/ (loading="lazy"|decoding="async"|fetchpriority="high")/g, '')
  .replace(/id='product-cat-\d+'/g, "id='product-cat-N'")
  .replace(/(nonce|_nonce|security)(["']?\s*[:=]\s*["'])[a-f0-9]{10}/g, '$1$2NONCE')
  .replace(/"nonce":"[a-f0-9]+"/g, '"nonce":"NONCE"').replace(/value="[a-f0-9]{10}"/g, 'value="NONCE"')
  .replace(/ product_tag-[a-z0-9-]+/g, '')
  .replace(/(id="(?:pls-[a-z-]+|section)-)\d+/g, '$1N').replace(/(#|data-href="|href="#)pls-tab-\d+/g, '$1pls-tab-N')
  .replace(/<!--[\s\S]*?-->/g, '');
const a = normalize(await readFile(orig, 'utf8'));
const res = await fetch(`http://localhost:8787${path}`);
const b = normalize(await res.text());
const la = a.split('\n'), lb = b.split('\n');
console.log(`original ${la.length} lines / ${a.length} chars — new ${lb.length} lines / ${b.length} chars — HTTP ${res.status}`);
// line-level diff with a simple LCS window
let i = 0, j = 0, shown = 0;
while (i < la.length && j < lb.length && shown < max) {
  if (la[i] === lb[j]) { i++; j++; continue; }
  let found = false;
  for (let k = 1; k < 60 && !found; k++) {
    if (j + k < lb.length && la[i] === lb[j + k]) { console.log(`+ new   ${j}: ${lb.slice(j, j + Math.min(k, 3)).map((l) => l.slice(0, 200)).join(' ⏎ ')}${k > 3 ? ` (+${k - 3} lines)` : ''}`); j += k; found = true; }
    else if (i + k < la.length && la[i + k] === lb[j]) { console.log(`- orig  ${i}: ${la.slice(i, i + Math.min(k, 3)).map((l) => l.slice(0, 200)).join(' ⏎ ')}${k > 3 ? ` (+${k - 3} lines)` : ''}`); i += k; found = true; }
  }
  if (!found) {
    let c = 0; while (la[i][c] === lb[j][c]) c++;
    console.log(`~ line ${i}/${j} @${c}\n   O: ${la[i].slice(Math.max(0, c - 60), c + 140)}\n   N: ${lb[j].slice(Math.max(0, c - 60), c + 140)}`);
    i++; j++;
  }
  shown++;
}
if (shown === 0) console.log('✓ identical after normalization');
