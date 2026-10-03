// Data access for the website: products prepared for templates, categories, menus, settings.
import { query } from '../db.js';
import { effectivePrice } from '../lib.js';
import { decodeEntities } from './html.js';
import { attributeTaxonomies, availableVariations, loopSwatches } from './variations.js';

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

// Small in-memory cache for data that changes rarely (categories, menus, settings)
const cache = new Map();
export async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}
export const clearSiteCache = () => cache.clear();

export async function mediaByIds(ids) {
  const list = [...new Set(ids.filter(Boolean).map(Number))];
  if (!list.length) return new Map();
  const rows = await query('select id, url, width, height, alt, title, caption, sizes from media where id = any($1::int[])', [list]);
  return new Map(rows.map((m) => [m.id, { ...m, sizes: json(m.sizes) || [] }]));
}

/** Turns an image reference stored on a product into a media object usable by imageTag(). */
function mediaFor(ref, media) {
  if (!ref) return null;
  if (ref.id && media.has(Number(ref.id))) return media.get(Number(ref.id));
  if (!ref.url) return null;
  return { id: ref.id || 0, url: ref.url, width: ref.width || 500, height: ref.height || 500, alt: ref.alt || '', sizes: [] };
}

/**
 * Loads products by id (keeps the given order) with everything the templates need.
 */
export async function productsByIds(ids) {
  const list = ids.map(Number);
  if (!list.length) return [];
  const rows = await query(`
    select p.id, p.type, p.status, p.name, p.slug, p.sku, p.regular_price::float8, p.sale_price::float8, p.sale_from, p.sale_to,
      p.manage_stock, p.stock_quantity, p.stock_status, p.backorders, p.featured, p.images, p.attributes, p.meta, p.short_description, p.average_rating::float8, p.rating_count,
      coalesce((select array_agg(c.slug order by c.name) from product_categories pc join categories c on c.id = pc.category_id where pc.product_id = p.id), '{}') category_slugs,
      coalesce((select array_agg(t.slug order by t.name) from product_tags pt join tags t on t.id = pt.tag_id where pt.product_id = p.id), '{}') tag_slugs
    from products p where p.id = any($1::int[])`, [list]);
  const variations = await query(`
    select id, product_id, sku, attributes, image, description, weight, manage_stock, stock_quantity, backorders,
      regular_price::float8, sale_price::float8, sale_from, sale_to, stock_status, status
    from variations where product_id = any($1::int[]) and status = 'publish' order by menu_order, id`, [list]);
  const media = await mediaByIds([
    ...rows.flatMap((r) => json(r.images).slice(0, 2).map((i) => i.id)),
    ...variations.map((v) => json(v.image)?.id),
  ]);
  const taxonomies = await attributeTaxonomies();
  const byProduct = new Map();
  for (const v of variations) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
    byProduct.get(v.product_id).push(v);
  }
  const out = new Map();
  for (const r of rows) {
    const images = json(r.images) || [];
    const meta = json(r.meta) || {};
    // keep WordPress' stored spelling (entities) as long as the name was not edited in the dashboard
    const name = meta.wp_name && decodeEntities(meta.wp_name) === r.name ? meta.wp_name : r.name;
    const p = { ...r, name, plain_name: r.name, image: mediaFor(images[0], media), hover_image: mediaFor(images[1], media) };
    if (r.type === 'variable') {
      const vars = (byProduct.get(r.id) || []).filter((v) => v.regular_price != null && v.stock_status !== 'outofstock');
      const prices = vars.map((v) => ({ ...effectivePrice(v) }));
      if (prices.length) {
        const act = prices.map((x) => x.price);
        const reg = prices.map((x) => x.regular);
        p.range = {
          min: Math.min(...act), max: Math.max(...act), regMin: Math.min(...reg), regMax: Math.max(...reg),
          on_sale: prices.some((x) => x.on_sale),
          percent: Math.max(0, ...prices.filter((x) => x.on_sale).map((x) => Math.round(((x.regular - x.price) / x.regular) * 100))),
        };
      }
      p.purchasable = prices.length > 0;
      const visible = (byProduct.get(r.id) || []).filter((v) => v.stock_status !== 'outofstock');
      p.variations = visible;
      p.available_variations = availableVariations({ ...p, regular_price: r.regular_price }, visible, media, taxonomies);
      p.swatches = loopSwatches(p, p.available_variations, taxonomies);
    } else {
      const { price, regular, on_sale } = effectivePrice(r);
      p.price = r.regular_price == null ? null : price;
      p.regular = regular;
      p.on_sale = r.regular_price != null && on_sale;
      p.purchasable = r.regular_price != null;
    }
    out.set(r.id, p);
  }
  return list.map((id) => out.get(id)).filter(Boolean);
}

export async function categories() {
  return cached('categories', 30000, async () => query(`
    select c.*, (select count(*)::int from product_categories pc join products p on p.id = pc.product_id
      where pc.category_id = c.id and p.status = 'publish') total_count
    from categories c order by c.menu_order, c.name`));
}

export async function menus() {
  return cached('menus', 30000, async () => {
    const rows = await query('select location, items from menus');
    return Object.fromEntries(rows.map((m) => [m.location, json(m.items) || []]));
  });
}

export async function setting(key, fallback = {}) {
  return cached(`setting:${key}`, 30000, async () => {
    const [row] = await query('select value from settings where key = $1', [key]);
    return row ? json(row.value) : fallback;
  });
}
