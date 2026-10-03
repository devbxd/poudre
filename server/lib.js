import { HTTPException } from 'hono/http-exception';
import { query, one } from './db.js';

export const fail = (status, message) => {
  throw new HTTPException(status, { message });
};

export const slugify = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'item';

export async function uniqueSlug(table, base, exceptId = null) {
  const root = slugify(base);
  let slug = root;
  for (let i = 2; ; i++) {
    const row = await one(`select id from ${table} where slug = $1 and ($2::int is null or id <> $2)`, [slug, exceptId]);
    if (!row) return slug;
    slug = `${root}-${i}`;
  }
}

export const money = (v) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 100) / 100);

/** Effective selling price of a product/variation row, taking scheduled sales into account. */
export function effectivePrice(row, now = new Date()) {
  const regular = money(row.regular_price) ?? 0;
  const sale = money(row.sale_price);
  if (sale === null || sale >= regular) return { price: regular, regular, on_sale: false };
  if (row.sale_from && new Date(row.sale_from) > now) return { price: regular, regular, on_sale: false };
  if (row.sale_to && new Date(row.sale_to) < now) return { price: regular, regular, on_sale: false };
  return { price: sale, regular, on_sale: true };
}

/**
 * Builds a parameterised UPDATE / INSERT from a whitelist of columns.
 * json: columns stored as jsonb, everything else passed as-is.
 */
export function pick(body, columns, json = []) {
  const out = {};
  for (const c of columns) {
    if (body[c] === undefined) continue;
    out[c] = json.includes(c) && body[c] !== null ? JSON.stringify(body[c]) : body[c] === '' && !['description', 'short_description', 'notes', 'content', 'excerpt', 'alt', 'customer_note', 'first_name', 'last_name'].includes(c) ? null : body[c];
  }
  return out;
}

export async function insertRow(t, table, data) {
  const cols = Object.keys(data);
  const rows = await t.query(
    `insert into ${table} (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
    cols.map((c) => data[c]),
  );
  return rows[0];
}

export async function updateRow(t, table, id, data, { touch = true } = {}) {
  const cols = Object.keys(data);
  if (!cols.length) return (await t.query(`select * from ${table} where id = $1`, [id]))[0];
  const sets = cols.map((c, i) => `${c} = $${i + 2}`);
  if (touch) sets.push('updated_at = now()');
  const rows = await t.query(`update ${table} set ${sets.join(', ')} where id = $1 returning *`, [id, ...cols.map((c) => data[c])]);
  return rows[0];
}

export function paging(c, { max = 200, def = 50 } = {}) {
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const per = Math.min(max, Math.max(1, Number(c.req.query('per_page')) || def));
  return { page, per, offset: (page - 1) * per };
}

/** Small helper to build WHERE clauses with positional params. */
export class Where {
  constructor() { this.parts = []; this.params = []; }
  add(sql, ...values) {
    let s = sql;
    for (const v of values) { this.params.push(v); s = s.replace('?', `$${this.params.length}`); }
    this.parts.push(s);
    return this;
  }
  param(v) { this.params.push(v); return `$${this.params.length}`; }
  get sql() { return this.parts.length ? `where ${this.parts.join(' and ')}` : ''; }
}

/**
 * Changes stock of a product or variation inside a transaction and logs the movement.
 * Only items with manage_stock get a quantity; status is recalculated automatically.
 */
export async function moveStock(t, { product_id, variation_id, change, reason, ref_type = null, ref_id = null, note = '', staff_id = null, set = null }) {
  const table = variation_id ? 'variations' : 'products';
  const id = variation_id || product_id;
  if (!id) return null;
  const [row] = await t.query(`select id, manage_stock, stock_quantity, backorders from ${table} where id = $1 for update`, [id]);
  if (!row || !row.manage_stock) return null;
  const before = Number(row.stock_quantity || 0);
  const after = set !== null ? Number(set) : before + Number(change);
  const status = after > 0 ? 'instock' : row.backorders !== 'no' ? 'onbackorder' : 'outofstock';
  await t.query(`update ${table} set stock_quantity = $2, stock_status = $3, updated_at = now() where id = $1`, [id, after, status]);
  if (variation_id) {
    // parent of a variable product is in stock when any variation is
    await t.query(
      `update products set stock_status = case when exists (select 1 from variations v where v.product_id = products.id and v.stock_status = 'instock') then 'instock' else 'outofstock' end where id = (select product_id from variations where id = $1)`,
      [variation_id],
    );
  }
  await t.query(
    `insert into stock_movements (product_id, variation_id, change, quantity_after, reason, ref_type, ref_id, note, staff_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [variation_id ? (await t.query('select product_id from variations where id = $1', [variation_id]))[0]?.product_id : product_id, variation_id || null, after - before, after, reason, ref_type, ref_id, note, staff_id],
  );
  return after;
}

export async function audit(staff, action, entity, entity_id, details = {}) {
  try {
    await query('insert into audit_log (staff_id, action, entity, entity_id, details) values ($1,$2,$3,$4,$5)', [staff?.id || null, action, entity, String(entity_id ?? ''), JSON.stringify(details)]);
  } catch { /* never block a request because of the audit log */ }
}

export async function getSetting(key, fallback = null) {
  const row = await one('select value from settings where key = $1', [key]);
  return row ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : fallback;
}

export async function setSetting(key, value) {
  await query('insert into settings (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, JSON.stringify(value)]);
}

export const toCsv = (rows) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
};
