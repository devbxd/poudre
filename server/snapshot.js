// Read-only copy of the catalogue (products, prices, stock, categories, menus, pages…) for the website pages and the
// POS catalogue. Pages read this copy in an in-memory Postgres (PGlite) instead of the real database, so the database
// (Neon, billed by the hour it is awake) is only woken by the POS, the dashboard, carts and orders.
//
// - The copy lives in Netlify Blobs (store "snapshot", key "catalog": gzipped JSON of the tables below).
// - Every write to one of these tables marks the request "dirty"; after the response the copy is refreshed with only
//   what changed (rows whose updated_at moved, plus the small tables), so a sale or a price change costs a few KB.
// - Each server instance checks the copy's version at most every 15 s and reloads it when it changed.
// - Anything else (carts, orders, customers, staff, coupons…) and every query inside a transaction use the database.
import { AsyncLocalStorage } from 'node:async_hooks';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { rootFile, onNetlify } from './site/files.js';

export const SNAPSHOT_TABLES = ['settings', 'media', 'categories', 'brands', 'tags', 'attributes', 'products', 'product_categories',
  'product_brands', 'product_tags', 'variations', 'reviews', 'pages', 'posts', 'menus'];
const TABLES = new Set(SNAPSHOT_TABLES);
// reloaded whole at every refresh (a few KB): never out of date even when two refreshes run at the same time
const SMALL = ['settings', 'categories', 'brands', 'attributes', 'menus', 'posts'];
// what a refresh reloads whole only when a write touched them
const ON_CHANGE = ['tags', 'reviews', 'media', 'pages', 'product_categories', 'product_brands', 'product_tags'];
const FULL_EVERY = 24 * 3600e3; // safety net: a complete copy once a day

/** Per-request state: may this request read the copy, and which tables did it change */
export const scope = new AsyncLocalStorage();

// ---------- storage (Netlify Blobs, or files in data/snapshot locally) ----------
async function store() {
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: 'snapshot', consistency: 'strong' });
}
async function readCopy() {
  if (onNetlify()) {
    const r = await (await store()).getWithMetadata('catalog', { type: 'arrayBuffer' });
    return r ? { data: JSON.parse(gunzipSync(Buffer.from(r.data))), meta: r.metadata || {} } : null;
  }
  try { return { data: JSON.parse(gunzipSync(await readFile('data/snapshot/catalog.gz'))), meta: JSON.parse(await readFile('data/snapshot/meta.json', 'utf8')) }; } catch { return null; }
}
async function readMeta() {
  if (onNetlify()) return (await (await store()).getMetadata('catalog'))?.metadata || null;
  try { return JSON.parse(await readFile('data/snapshot/meta.json', 'utf8')); } catch { return null; }
}
async function writeCopy(data, meta) {
  const body = gzipSync(JSON.stringify(data));
  if (onNetlify()) await (await store()).set('catalog', body, { metadata: meta });
  else { await mkdir('data/snapshot', { recursive: true }); await writeFile('data/snapshot/catalog.gz', body); await writeFile('data/snapshot/meta.json', JSON.stringify(meta)); }
  return body.length;
}

// ---------- building the copy from the database ----------
const isStockOnly = (sql) => /^\s*update\s+(products|variations)\s+set\s+(stock_quantity|stock_status|total_sales|manage_stock = true, stock_quantity)/i.test(sql);

/** Tables a write statement changes (insert into / update / delete from), and whether it only moved stock */
export function writtenTables(sql) {
  const m = sql.match(/^\s*(?:with[\s\S]*?\)\s*)?(?:insert\s+into|update|delete\s+from)\s+([a-z_]+)/i);
  return m && TABLES.has(m[1].toLowerCase()) ? { table: m[1].toLowerCase(), stockOnly: isStockOnly(sql) } : null;
}

/**
 * Brings the copy up to date. changes: { tables:Set, stockOnly:boolean }. Rows of products/variations changed since the
 * last refresh are read again (with their categories/brands/tags); deleted ones are dropped.
 */
export async function refreshCopy(dbQuery, changes = { tables: new Set(), stockOnly: false }, { full = false } = {}) {
  const started = new Date(Date.now() - 5000); // margin for clocks and transactions committing during the refresh
  const current = full ? null : await readCopy();
  if (!current || Date.now() - (current.meta.full_at || 0) > FULL_EVERY) {
    const data = {};
    for (const t of SNAPSHOT_TABLES) data[t] = await dbQuery(`select * from ${t}`);
    const now = Date.now();
    const meta = { version: now, catalog_version: now, full_at: now, built_at: started.toISOString() };
    return { bytes: await writeCopy(data, meta), full: true, meta };
  }
  const { data, meta } = current;
  if (!changes.stockOnly || !changes.tables.size) for (const t of SMALL) data[t] = await dbQuery(`select * from ${t}`); // a sale only moves stock
  for (const t of ON_CHANGE) if (changes.tables.has(t)) data[t] = await dbQuery(`select * from ${t}`);
  // products and options changed since the last refresh (stock, prices, names, categories…)
  const since = meta.built_at;
  const vars = await dbQuery('select * from variations where updated_at >= $1', [since]);
  // a product whose options changed is read again too (its stock status follows them)
  const prods = await dbQuery('select * from products where updated_at >= $1 or id = any($2::int[])', [since, [...new Set(vars.map((v) => v.product_id))]]);
  const ids = [...new Set([...prods.map((p) => p.id), ...vars.map((v) => v.product_id)])];
  const merge = (list, rows) => { const m = new Map(list.map((r) => [r.id, r])); for (const r of rows) m.set(r.id, r); return [...m.values()]; };
  data.products = merge(data.products, prods);
  data.variations = merge(data.variations, vars);
  if (prods.length) {
    const pid = prods.map((p) => p.id);
    for (const t of ['product_categories', 'product_brands', 'product_tags']) {
      if (changes.tables.has(t)) continue; // the whole table was just reloaded
      const rows = await dbQuery(`select * from ${t} where product_id = any($1::int[])`, [pid]);
      data[t] = data[t].filter((r) => !pid.includes(r.product_id)).concat(rows);
    }
  }
  // something was deleted: drop what no longer exists (ids only, a few KB)
  if (changes.deleted) {
    const live = new Set((await dbQuery('select id from products')).map((r) => r.id));
    const liveV = new Set((await dbQuery('select id from variations')).map((r) => r.id));
    data.products = data.products.filter((r) => live.has(r.id));
    data.variations = data.variations.filter((r) => liveV.has(r.id));
    for (const t of ['product_categories', 'product_brands', 'product_tags']) data[t] = data[t].filter((r) => live.has(r.product_id));
  }
  const now = Date.now();
  const next = { ...meta, version: now, built_at: started.toISOString(), catalog_version: changes.stockOnly ? meta.catalog_version : now };
  return { bytes: await writeCopy(data, next), full: false, meta: next, changed: ids.length };
}

// ---------- reading the copy ----------
let local = null; // { db, version }
let loading = null;
let checkedAt = 0;

let missing = false;
let buildAsked = 0;
/** True when there is no copy yet: the request then builds it (at most once a minute per server instance) */
export function copyMissing() {
  if (!missing || Date.now() - buildAsked < 60000) return false;
  missing = false;
  buildAsked = Date.now();
  return true;
}

async function loadCopy() {
  const copy = await readCopy();
  if (!copy) { missing = true; return null; }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(await readFile(rootFile('db/schema.sql'), 'utf8'));
  await db.exec('set session_replication_role = replica'); // rows go in any order: no foreign key checks
  for (const t of SNAPSHOT_TABLES) {
    if (copy.data[t]?.length) await db.query(`insert into ${t} select * from json_populate_recordset(null::${t}, $1::json)`, [JSON.stringify(copy.data[t])]);
  }
  return { db, version: copy.meta.version, meta: copy.meta };
}

/** The in-memory copy, loaded on first use and reloaded when a newer version exists. null when there is none. */
export async function copyDb() {
  if (!local) {
    if (missing || Date.now() - buildAsked < 20000) return null; // no copy yet: the database answers meanwhile
    loading ??= loadCopy().catch((e) => { console.error('snapshot load', e.message); return null; }).finally(() => { loading = null; });
    local = await loading;
    checkedAt = Date.now();
    return local;
  }
  if (Date.now() - checkedAt > 15000) {
    checkedAt = Date.now();
    const meta = await readMeta().catch(() => null);
    if (meta && meta.version > local.version && !loading) {
      // keep answering from the current copy while the new one loads
      loading = loadCopy().then((n) => { if (n) local = n; return n; }).catch((e) => { console.error('snapshot reload', e.message); return null; }).finally(() => { loading = null; });
    }
  }
  return local;
}

/** Version of the catalogue (prices, names, products…) — changes only when something else than stock moved */
export async function catalogVersion() {
  const meta = await readMeta().catch(() => null);
  return meta ? { catalog: meta.catalog_version, any: meta.version } : null;
}

const READ_ONLY = /^\s*(select|with)\b/i;
/** True when a query only reads tables kept in the copy */
export function readsOnlyCopy(sql) {
  if (!READ_ONLY.test(sql) || /\bfor\s+update\b|\bnextval\s*\(|\binsert\b|\bupdate\s+[a-z_]+\s+set\b|\bdelete\s+from\b/i.test(sql)) return false;
  const ctes = new Set([...sql.matchAll(/(?:\bwith\s+(?:recursive\s+)?|,\s*)([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
  for (const m of sql.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)(\s*\()?/gi)) {
    if (m[2]) continue; // a function: unnest(…), jsonb_array_elements(…)
    const name = m[1].toLowerCase();
    if (!TABLES.has(name) && !ctes.has(name)) return false;
  }
  return true;
}
