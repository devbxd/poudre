import { readdir, readFile } from 'node:fs/promises';
import { productsByIds } from '../server/site/data.js';
import { productCard } from '../server/site/product-card.js';

const norm = (h) => h.replaceAll('https://poudrebeauty.com/', '/').replaceAll('https:\\/\\/poudrebeauty.com\\/', '\\/').replace(/ woosw-added/g, '')
  .replace(/ (loading="lazy"|decoding="async"|fetchpriority="high")/g, '').replace(/<img (loading="lazy"|decoding="async"|fetchpriority="high") /g, '<img ')
  .replace(/class="(product type-product[^"]*)"/, (m, c) => `class="${c.split(' ').filter((x) => x !== 'first' && x !== 'last' && !x.startsWith('product_tag-')).sort().join(' ')}"`)
  // wishlist state of the capture session
  .replace(/aria-label="Browse wishlist">Browse wishlist/g, 'aria-label="Add to wishlist">Add to wishlist');
const files = [...(await readdir('data/original/corpus')).map((f) => `data/original/corpus/${f}`), 'data/original/html/home.html'];
const cards = new Map();
for (const f of files) {
  const h = await readFile(f, 'utf8');
  for (const part of h.split('<div class="product type-product').slice(1)) {
    const card = '<div class="product type-product' + part.slice(0, part.indexOf('</div>\t \n</div>') + 15);
    const id = Number(card.match(/post-(\d+)/)[1]);
    if (!cards.has(id)) cards.set(id, { card, base: f.includes('/?s=') ? '/' : (f.match(/product-category_[a-z-]+/) ? null : '/shop/') , file: f });
  }
}
const products = await productsByIds([...cards.keys()]);
let same = 0;
const diffs = {};
for (const p of products) {
  const o = cards.get(p.id);
  const base = (o.card.match(/href="(?:https:\/\/poudrebeauty\.com)?([^"]*?)(?:\?|&#038;)add-to-cart=/) || [])[1]?.replace(/&#038;/g, '&') || '/shop/';
  const a = norm(o.card).trimEnd();
  const b = norm(productCard(p, { currentUrl: base })).trimEnd();
  if (a === b) { same++; continue; }
  let i = 0; while (a[i] === b[i]) i++;
  const key = a.slice(Math.max(0, i - 40), i).replace(/\d+/g, '#').slice(-40);
  (diffs[key] ||= []).push({ id: p.id, o: a.slice(Math.max(0, i - 80), i + 140), r: b.slice(Math.max(0, i - 80), i + 140) });
}
console.log(`cards: ${cards.size}, found in DB: ${products.length}, identical: ${same}`);
for (const [k, list] of Object.entries(diffs).sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
  console.log(`\n--- ${list.length}× near: ${JSON.stringify(k)}  e.g. #${list[0].id}`);
  console.log('  O:', JSON.stringify(list[0].o));
  console.log('  R:', JSON.stringify(list[0].r));
}
process.exit(0);
