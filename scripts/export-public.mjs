// Exports everything public from the WooCommerce Store API (no credentials needed)
// Usage: node scripts/export-public.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://poudrebeauty.com/wp-json/wc/store/v1';
const OUT = 'data/public';
await mkdir(OUT, { recursive: true });

async function fetchAll(endpoint) {
  const all = [];
  for (let page = 1; ; page++) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE}/${endpoint}${sep}per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`${endpoint} page ${page}: HTTP ${res.status}`);
    const items = await res.json();
    all.push(...items);
    const totalPages = Number(res.headers.get('x-wp-totalpages') || 1);
    process.stdout.write(`\r${endpoint}: ${all.length} (page ${page}/${totalPages})   `);
    if (page >= totalPages || items.length === 0) break;
  }
  console.log();
  return all;
}

for (const [name, endpoint] of [
  ['products', 'products'],
  ['categories', 'products/categories'],
  ['tags', 'products/tags'],
  ['attributes', 'products/attributes'],
]) {
  const data = await fetchAll(endpoint);
  await writeFile(`${OUT}/${name}.json`, JSON.stringify(data, null, 2));
}
