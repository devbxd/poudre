// Imports the WooCommerce / WordPress / ATUM export (data/raw) into the Poudre database.
// Usage: npm run db:import   (drops and recreates every table — run before go-live for the final sync)
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../server/db.js';

const raw = async (name) => JSON.parse(await readFile(`data/raw/${name}.json`, 'utf8'));
const conn = await db();
const q = conn.query;

const SITE = 'https://poudrebeauty.com';
// Absolute WordPress URLs become root-relative: the new hosting serves the same paths
const url = (u) => (u ? String(u).replace(/^https?:\/\/(www\.)?poudrebeauty\.com/, '') : null);
const html = (s) => (s || '').replaceAll(`${SITE}/`, '/');
const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
const date = (v) => (v ? `${v.replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'}` : null);
const meta = (x, key) => x.meta_data?.find((m) => m.key === key)?.value;
import { decodeEntities as decode } from '../server/site/html.js';

const PG_ARRAYS = new Set(['upsell_ids', 'cross_sell_ids', 'product_ids', 'excluded_product_ids', 'category_ids', 'excluded_category_ids', 'coupon_codes', 'tags', 'categories']);

async function insert(table, rows, { batch = 200 } = {}) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const params = [];
    const values = chunk.map((r) => `(${cols.map((c) => {
      const v = r[c] ?? (c.endsWith('_at') && ['created_at', 'updated_at'].includes(c) ? new Date().toISOString() : null);
      // Postgres array columns get JS arrays; every other object/array goes to a jsonb column
      params.push(v !== null && typeof v === 'object' && !PG_ARRAYS.has(c) ? JSON.stringify(v) : v);
      return `$${params.length}`;
    }).join(',')})`);
    await q(`insert into ${table} (${cols.join(',')}) values ${values.join(',')} on conflict do nothing`, params);
  }
  console.log(`  ${table}: ${rows.length}`);
}

console.log('Recreating schema…');
const tables = ['carts', 'wishlists', 'audit_log', 'messages', 'menus', 'posts', 'pages', 'cash_sessions', 'stock_movements', 'purchase_orders', 'reviews', 'refunds', 'order_notes', 'order_items', 'orders', 'coupons', 'customers', 'variations', 'product_tags', 'product_brands', 'product_categories', 'products', 'suppliers', 'attributes', 'tags', 'brands', 'categories', 'media', 'staff', 'settings'];
// kept across a re-import (final sync before go-live): connections set up in the dashboard and staff logins
const kept = { settings: [], staff: [] };
try {
  kept.settings = await q("select key, value from settings where key in ('emails', 'icarry')");
  kept.staff = await q('select username, password_hash, pin_hash from staff');
} catch { /* first import: nothing to keep */ }
await conn.exec(`drop table if exists ${tables.join(',')} cascade`);
await conn.exec(await readFile('db/schema.sql', 'utf8'));

console.log('Importing…');

// ---------- Staff ----------
const wpUsers = await raw('wp_users');
const ownerPassword = process.env.OWNER_PASSWORD || randomBytes(6).toString('base64url');
const staff = wpUsers.filter((u) => u.roles.includes('administrator')).map((u) => ({
  id: u.id, name: u.name, username: u.username, email: u.email || null,
  password_hash: bcrypt.hashSync(u.username === 'jeanclaude' ? ownerPassword : randomBytes(16).toString('hex'), 10),
  role: 'owner', active: u.username === 'jeanclaude', created_at: date(u.registered_date),
}));
await insert('staff', staff);

// ---------- Media ----------
const media = await raw('wp_media');
await insert('media', media.map((m) => ({
  id: m.id, url: url(m.source_url), filename: m.media_details?.file?.split('/').pop() || m.slug,
  mime: m.mime_type, width: m.media_details?.width || null, height: m.media_details?.height || null,
  alt: m.alt_text || '', title: decode(m.title?.raw ?? m.title?.rendered ?? ''), caption: m.caption?.raw ?? '', created_at: date(m.date_gmt),
  // an array keeps WordPress' size order (jsonb objects do not keep key order), which drives srcset
  sizes: Object.entries(m.media_details?.sizes || {}).filter(([k]) => k !== 'full').map(([name, v]) => ({ name, file: v.file, width: v.width, height: v.height })),
})), { batch: 500 });

// ---------- Taxonomies ----------
const cats = await raw('categories');
// parents first so the foreign key is satisfied
const sortedCats = [];
const pending = [...cats];
while (pending.length) {
  for (let i = pending.length - 1; i >= 0; i--) {
    const c = pending[i];
    if (!c.parent || sortedCats.some((s) => s.id === c.parent)) { sortedCats.push(c); pending.splice(i, 1); }
  }
}
for (const c of sortedCats) {
  await insert('categories', [{
    id: c.id, parent_id: c.parent || null, name: decode(c.name), slug: c.slug, description: html(c.description),
    image: url(c.image?.src), menu_order: c.menu_order || 0, visible: c.slug !== 'uncategorized', pos_visible: true,
  }]);
}
console.log(`  categories: ${cats.length}`);

const brands = await raw('brands');
await insert('brands', brands.map((b) => ({ id: b.id, name: decode(b.name), slug: b.slug, description: html(b.description), image: url(b.image?.src), visible: true, menu_order: b.menu_order || 0 })));
const tags = await raw('tags');
await insert('tags', tags.map((t) => ({ id: t.id, name: decode(t.name), slug: t.slug })), { batch: 500 });
const attrs = await raw('attributes');
const attrTerms = JSON.parse(await readFile('data/raw/attribute_terms.json', 'utf8'));
const swatches = JSON.parse(await readFile('data/raw/swatches.json', 'utf8'));
// swatch colours only exist in the theme's term meta, harvested from the shop pages
const swatchColor = (tax, slug) => (swatches[`${tax}:${slug}`]?.inner.match(/background-color:([^"]*)"/) || [])[1] ?? null;
await insert('attributes', attrs.map((a) => ({
  id: a.id, name: a.name, slug: a.slug,
  terms: (attrTerms[a.id] || []).map((t) => ({ id: t.id, name: decode(t.name), slug: t.slug, menu_order: t.menu_order || 0, color: swatchColor(a.slug, t.slug) })),
})));

// ---------- Suppliers ----------
const suppliers = await raw('atum_suppliers');
await insert('suppliers', suppliers.map((s) => ({
  id: s.id, name: decode(s.name), code: s.code, email: s.ordering_email || s.general_email, phone: s.phone, website: s.ordering_url,
  address: { address_1: s.address, address_2: s.address_2, city: s.city, state: s.state, country: s.country, zip: s.zip_code },
  currency: s.currency || 'USD', lead_time_days: num(s.lead_time), notes: s.description || '', active: s.status === 'publish',
  created_at: date(s.date_created_gmt),
})));

// ---------- Cost prices from the last received purchase orders ----------
const pos = await raw('atum_purchase_orders');
const lastCost = new Map();
for (const po of [...pos].sort((a, b) => a.date_created.localeCompare(b.date_created))) {
  for (const li of po.line_items) {
    const key = li.variation_id || li.product_id;
    if (li.quantity > 0 && Number(li.subtotal) > 0) lastCost.set(key, Math.round((Number(li.subtotal) / li.quantity) * 100) / 100);
  }
}

// ---------- Products ----------
const products = await raw('products');
const productIds = new Set(products.map((p) => p.id));
const supplierIds = new Set(suppliers.map((s) => s.id));
const rows = products.map((p) => {
  const hidden = meta(p, '_alg_wc_pvbur_invisible');
  // "visible only to" roles: when set without 'guest', visitors cannot see the product
  const onlyFor = meta(p, '_alg_wc_pvbur_visible');
  return {
    id: p.id, type: p.type === 'variable' ? 'variable' : p.type === 'woosb' ? 'bundle' : 'simple',
    status: ['publish', 'draft', 'private'].includes(p.status) ? p.status : 'draft',
    name: decode(p.name), slug: p.slug, sku: p.sku || null, barcode: p.barcode || p.global_unique_id || p.sku || null,
    description: html(p.description), short_description: html(p.short_description),
    regular_price: num(p.regular_price), sale_price: num(p.sale_price),
    sale_from: date(p.date_on_sale_from_gmt), sale_to: date(p.date_on_sale_to_gmt),
    purchase_price: num(p.purchase_price) ?? lastCost.get(p.id) ?? null,
    manage_stock: !!p.manage_stock, stock_quantity: p.manage_stock ? (p.stock_quantity ?? 0) : null,
    stock_status: p.stock_status, backorders: p.backorders || 'no', low_stock_amount: num(p.low_stock_amount),
    weight: num(p.weight), dimensions: p.dimensions || {},
    featured: !!p.featured, catalog_visibility: p.catalog_visibility,
    online_visible: !(Array.isArray(hidden) && hidden.includes('guest')) && !(Array.isArray(onlyFor) && onlyFor.length && !onlyFor.includes('guest')), pos_visible: true,
    supplier_id: supplierIds.has(p.supplier_id) ? p.supplier_id : null, supplier_sku: p.supplier_sku || null,
    tax_status: p.tax_status, menu_order: p.menu_order || 0, reviews_allowed: !!p.reviews_allowed,
    images: p.images.map((i) => ({ id: i.id, url: url(i.src), alt: i.alt || '' })),
    attributes: p.attributes.map((a) => ({ id: a.id, name: a.name, options: a.options, visible: a.visible, variation: a.variation })),
    default_attributes: p.default_attributes || [],
    upsell_ids: p.upsell_ids.filter((i) => productIds.has(i)), cross_sell_ids: p.cross_sell_ids.filter((i) => productIds.has(i)),
    // wp_name keeps WordPress' exact stored name (entities included) so the website renders it identically
    bundle_items: [], seo: {}, meta: { wc_permalink: p.permalink, wp_name: p.name },
    total_sales: p.total_sales || 0, average_rating: num(p.average_rating) || 0, rating_count: p.rating_count || 0,
    created_at: date(p.date_created_gmt), updated_at: date(p.date_modified_gmt),
  };
});
await insert('products', rows);
await insert('product_categories', products.flatMap((p) => p.categories.map((c) => ({ product_id: p.id, category_id: c.id }))), { batch: 1000 });
await insert('product_brands', products.flatMap((p) => (p.brands || []).map((b) => ({ product_id: p.id, brand_id: b.id }))), { batch: 1000 });
await insert('product_tags', products.flatMap((p) => p.tags.map((t) => ({ product_id: p.id, tag_id: t.id }))), { batch: 1000 });

const variations = (await raw('variations')).filter((v) => productIds.has(v.parent_id));
// The API returns the parent image for variations without their own; the shop pages tell them apart
const ownImage = JSON.parse(await readFile('data/raw/variation_own_image.json', 'utf8'));
const mainImage = new Map(products.map((p) => [p.id, p.images[0]?.id]));
const hasOwnImage = (v) => ownImage[v.id] ?? (v.image?.id && v.image.id !== mainImage.get(v.parent_id));
await insert('variations', variations.map((v) => ({
  id: v.id, product_id: v.parent_id, status: v.status, sku: v.sku || null, barcode: v.barcode || v.global_unique_id || v.sku || null,
  attributes: v.attributes.map((a) => ({ id: a.id || 0, name: a.name, option: a.option })),
  regular_price: num(v.regular_price), sale_price: num(v.sale_price),
  sale_from: date(v.date_on_sale_from_gmt), sale_to: date(v.date_on_sale_to_gmt),
  purchase_price: num(v.purchase_price) ?? lastCost.get(v.id) ?? null,
  manage_stock: v.manage_stock === true, stock_quantity: v.manage_stock === true ? (v.stock_quantity ?? 0) : null,
  stock_status: v.stock_status, backorders: v.backorders || 'no', low_stock_amount: num(v.low_stock_amount),
  image: v.image && hasOwnImage(v) ? { id: v.image.id, url: url(v.image.src), alt: v.image.alt || '' } : null,
  weight: num(v.weight), description: html(v.description),
  supplier_id: supplierIds.has(v.supplier_id) ? v.supplier_id : null, supplier_sku: v.supplier_sku || null,
  menu_order: v.menu_order || 0, created_at: date(v.date_created_gmt), updated_at: date(v.date_modified_gmt),
})));

// ---------- Customers (accounts + guests found in orders) ----------
const customers = await raw('customers');
const orders = await raw('orders');
const custRows = customers.map((c) => ({
  id: c.id, first_name: c.first_name || c.billing.first_name || '', last_name: c.last_name || c.billing.last_name || '',
  email: c.email || null, phone: c.billing.phone || null, billing: c.billing, shipping: c.shipping,
  created_at: date(c.date_created_gmt), updated_at: date(c.date_modified_gmt),
}));
const byEmail = new Map(custRows.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c.id]));
const byPhone = new Map(custRows.filter((c) => c.phone).map((c) => [c.phone, c.id]));
let nextGuestId = Math.max(0, ...wpUsers.map((u) => u.id), ...custRows.map((c) => c.id)) + 1000;
const orderCustomer = new Map();
for (const o of [...orders].sort((a, b) => a.id - b.id)) {
  const email = o.billing.email?.toLowerCase();
  const phone = o.billing.phone?.trim();
  let id = (o.customer_id && custRows.some((c) => c.id === o.customer_id)) ? o.customer_id
    : (email && byEmail.get(email)) || (phone && byPhone.get(phone));
  if (!id && (email || phone)) {
    id = nextGuestId++;
    custRows.push({ id, first_name: o.billing.first_name || '', last_name: o.billing.last_name || '', email: email || null, phone: phone || null,
      billing: o.billing, shipping: o.shipping, created_at: date(o.date_created_gmt), updated_at: date(o.date_created_gmt) });
    if (email) byEmail.set(email, id);
    if (phone) byPhone.set(phone, id);
  }
  if (id) orderCustomer.set(o.id, id);
}
await insert('customers', custRows);

// ---------- Orders ----------
const staffIds = new Set(staff.map((s) => s.id));
const costOf = (li) => {
  const v = li.variation_id && variations.find((x) => x.id === li.variation_id);
  return num(v?.purchase_price) ?? lastCost.get(li.variation_id || li.product_id) ?? rows.find((r) => r.id === li.product_id)?.purchase_price ?? null;
};
const productById = new Map(rows.map((r) => [r.id, r]));
await insert('orders', orders.map((o) => {
  const posOrder = o.created_via === 'woocommerce-pos';
  const posUser = Number(meta(o, '_pos_user'));
  const subtotal = o.line_items.reduce((s, li) => s + Number(li.subtotal), 0);
  return {
    id: o.id, number: String(o.number), status: o.status, channel: posOrder ? 'pos' : 'online',
    customer_id: orderCustomer.get(o.id) || null, billing: o.billing, shipping: o.shipping, currency: o.currency,
    subtotal, discount_total: num(o.discount_total) || 0, shipping_total: num(o.shipping_total) || 0,
    fee_total: o.fee_lines.reduce((s, f) => s + Number(f.total), 0), tax_total: num(o.total_tax) || 0, total: num(o.total) || 0,
    refunded_total: o.refunds.reduce((s, r) => s + Math.abs(Number(r.total)), 0),
    payment_method: o.payment_method || (posOrder ? 'cash' : null), payment_title: o.payment_method_title,
    shipping_method: o.shipping_lines[0]?.method_title || null, coupon_codes: o.coupon_lines.map((c) => c.code),
    cash_tendered: num(meta(o, '_pos_cash_amount_tendered')), cash_change: num(meta(o, '_pos_cash_change')),
    staff_id: staffIds.has(posUser) ? posUser : null, customer_note: o.customer_note || '',
    invoice_number: meta(o, 'wpifw_invoice_no') ? String(meta(o, 'wpifw_invoice_no')) : null,
    meta: { wc_order_key: o.order_key, attribution: meta(o, '_wc_order_attribution_source_type') || null },
    paid_at: date(o.date_paid_gmt), completed_at: date(o.date_completed_gmt),
    created_at: date(o.date_created_gmt), updated_at: date(o.date_modified_gmt),
  };
}), { batch: 300 });
await insert('order_items', orders.flatMap((o) => o.line_items.map((li) => ({
  order_id: o.id, product_id: productById.has(li.product_id) ? li.product_id : null, variation_id: li.variation_id || null,
  name: decode(li.name), sku: li.sku || null, quantity: li.quantity, unit_price: num(li.price) || 0, purchase_price: costOf(li),
  subtotal: num(li.subtotal) || 0, total: num(li.total) || 0,
  meta: Object.fromEntries(li.meta_data.filter((m) => !m.key.startsWith('_')).map((m) => [m.display_key, m.display_value])),
}))), { batch: 500 });

// ---------- Coupons / reviews ----------
await insert('coupons', (await raw('coupons')).map((c) => ({
  id: c.id, code: c.code.toLowerCase(), type: c.discount_type, amount: num(c.amount) || 0, description: c.description || '',
  expires_at: date(c.date_expires_gmt), min_amount: num(c.minimum_amount), max_amount: num(c.maximum_amount),
  usage_limit: c.usage_limit, usage_limit_per_user: c.usage_limit_per_user, usage_count: c.usage_count || 0,
  individual_use: c.individual_use, free_shipping: c.free_shipping, exclude_sale_items: c.exclude_sale_items,
  product_ids: c.product_ids, excluded_product_ids: c.excluded_product_ids,
  category_ids: c.product_categories, excluded_category_ids: c.excluded_product_categories,
  active: c.status === 'publish', created_at: date(c.date_created_gmt),
})));
await insert('reviews', (await raw('reviews')).filter((r) => productIds.has(r.product_id)).map((r) => ({
  id: r.id, product_id: r.product_id, author: decode(r.reviewer), email: r.reviewer_email, rating: r.rating || null,
  // reviews left "on hold" in WordPress were never moderated and are all bot spam (links, adult content)
  content: r.review, status: r.status === 'approved' ? 'approved' : 'spam',
  verified: !!r.verified, created_at: date(r.date_created_gmt),
})));

// ---------- Purchase orders / inventory logs ----------
await insert('purchase_orders', pos.map((po) => ({
  id: po.id, number: `PO-${po.id}`, supplier_id: supplierIds.has(po.supplier) ? po.supplier : null,
  status: po.status === 'atum_received' ? 'received' : po.status === 'atum_ordered' ? 'ordered' : 'draft',
  expected_at: date(po.date_expected), received_at: po.status === 'atum_received' ? date(po.date_created) : null,
  total: num(po.total) || 0, notes: po.description || '',
  items: po.line_items.map((li) => ({
    product_id: li.product_id || null, variation_id: li.variation_id || null, name: decode(li.name), sku: li.sku || null,
    qty: li.quantity, received_qty: li.quantity, cost: li.quantity ? Math.round((Number(li.subtotal) / li.quantity) * 100) / 100 : 0,
  })),
  meta: { atum_status: po.status }, created_at: date(po.date_created), updated_at: date(po.date_modified),
})), { batch: 100 });

const logs = await raw('atum_inventory_logs');
await insert('stock_movements', logs.flatMap((l) => l.line_items.map((li) => ({
  product_id: li.product_id || null, variation_id: li.variation_id || null, change: -Math.abs(li.quantity),
  reason: 'adjustment', ref_type: 'atum_log', ref_id: l.id, note: `ATUM log #${l.id} ${l.type || ''}`.trim(), created_at: date(l.date_created),
}))));

// ---------- Content ----------
const pages = await raw('wp_pages');
await insert('pages', pages.filter((p) => p.status === 'publish').map((p) => ({
  id: p.id, slug: p.slug, title: decode(p.title.raw ?? p.title.rendered), content: html(p.content.rendered),
  template: p.template || 'default', status: 'publish', menu_order: p.menu_order || 0, updated_at: date(p.modified_gmt),
})));
const posts = await raw('wp_posts');
const mediaById = new Map(media.map((m) => [m.id, url(m.source_url)]));
await insert('posts', posts.map((p) => ({
  id: p.id, slug: p.slug, title: decode(p.title.raw ?? p.title.rendered), excerpt: html(p.excerpt.rendered), content: html(p.content.rendered),
  image: mediaById.get(p.featured_media) || null, categories: [], status: p.status === 'publish' ? 'publish' : 'draft',
  published_at: date(p.date_gmt), updated_at: date(p.modified_gmt),
})));

const menus = await raw('wp_menus');
const items = await raw('wp_menu_items');
const relUrl = (u) => (u || '').replace(/^https?:\/\/(www\.)?poudrebeauty\.com/, '') || '/';
const tree = (menuId, parent = 0) => items.filter((i) => i.menus === menuId && i.parent === parent).sort((a, b) => a.menu_order - b.menu_order)
  .map((i) => ({ id: i.id, title: decode(i.title.rendered), raw_title: i.title.rendered, url: relUrl(i.url), type: i.object, object_id: i.object_id, children: tree(menuId, i.id) }));
await insert('menus', menus.map((m) => ({
  id: m.id, location: m.locations[0] || m.slug, name: m.name, items: tree(m.id),
})));

// ---------- Settings ----------
const wpSettings = await raw('wp_settings');
const status = await raw('system_status');
const zones = await raw('shipping_zones');
const gateways = await raw('payment_gateways');
const settingsRows = [
  ['store', {
    name: wpSettings.title || 'Poudre Beauty', tagline: wpSettings.description || '', email: wpSettings.email || 'info@poudrebeauty.com',
    phone: '', whatsapp: '', address: '', currency: status.settings?.currency || 'USD', currency_symbol: '$',
    currency_position: status.settings?.currency_position || 'left', decimals: 2, timezone: wpSettings.timezone || 'Asia/Beirut',
    secondary_currency: { code: 'LBP', rate: 89500, show_in_pos: true },
  }],
  ['shipping', (() => {
    // WooCommerce "Local" zone (Lebanon) methods + store pickup, in checkout order
    const zm = JSON.parse(readFileSync('data/raw/shipping_methods.json', 'utf8'));
    const local = zm.find((z) => z.locations.some((l) => l.code === 'LB')) || zm[0];
    const methods = local.methods.filter((m) => m.enabled).sort((a, b) => a.order - b.order).map((m) => ({
      id: `${m.method_id}:${m.instance_id}`, type: m.method_id, title: m.settings.title || m.title,
      cost: Number(m.settings.cost || 0), min_amount: m.settings.requires === 'min_amount' ? Number(m.settings.min_amount) : null,
      enabled: true,
    }));
    methods.push({ id: 'pickup_location:0', type: 'pickup_location', title: 'Pickup (Poudre&#8217; Beauty)', label: "Pickup (Poudre' Beauty)", cost: 0, enabled: true,
      pickup: { name: "Poudre' Beauty", address: 'Chekka, Main Road, Fransabank Center, Chekka, 0000', details: '' } });
    return { country: 'LB', methods };
  })()],
  // website: WooCommerce gateways as configured; POS: WCPOS cash & card (always on in the till)
  ['payments', gateways.map((g) => ({ id: g.id, title: g.title, description: g.description, enabled: g.id.startsWith('pos_') ? true : g.enabled, online: !g.id.startsWith('pos_'), pos: g.id.startsWith('pos_') }))],
  ['pos', { receipt_header: 'Poudre Beauty', receipt_footer: 'Thank you for shopping with us!', invoice_prefix: '', require_session: false, allow_negative_stock: true, default_customer: null }],
  ['homepage', { sections: [] }],
];
await insert('settings', settingsRows.map(([key, value]) => ({ key, value })));
for (const r of kept.settings) await q('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [r.key, typeof r.value === 'string' ? r.value : JSON.stringify(r.value)]);
// passwords changed in the dashboard win over the imported ones (unless OWNER_PASSWORD is given explicitly)
for (const r of kept.staff) {
  if (process.env.OWNER_PASSWORD && r.username === 'jeanclaude') continue;
  await q('update staff set password_hash = $2, pin_hash = $3 where username = $1', [r.username, r.password_hash, r.pin_hash]);
}

// ---------- Sequences ----------
for (const t of ['staff', 'media', 'categories', 'brands', 'tags', 'attributes', 'suppliers', 'products', 'variations', 'customers', 'coupons', 'orders', 'order_items', 'order_notes', 'refunds', 'reviews', 'purchase_orders', 'pages', 'posts', 'menus', 'messages', 'cash_sessions']) {
  await q(`select setval(pg_get_serial_sequence('${t}','id'), greatest((select coalesce(max(id),0) from ${t}), 1))`);
}
// variations and products share the WooCommerce id space; keep new ids unique across both
await q(`select setval(pg_get_serial_sequence('products','id'), (select greatest(max(id), (select max(id) from variations)) + 1 from products))`);
await q(`select setval(pg_get_serial_sequence('variations','id'), (select last_value from products_id_seq) + 100000)`);

console.log('\nDone.');
if (!process.env.OWNER_PASSWORD) console.log(`Owner login → username: jeanclaude  password: ${ownerPassword}  (set OWNER_PASSWORD in .env to choose it)`);
process.exit(0);
