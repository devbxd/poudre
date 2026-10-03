// Full read-only export of the WooCommerce / WordPress / ATUM / WCPOS data
// Usage: node --env-file=.env scripts/export-private.mjs [name ...]
import { writeFile, mkdir } from 'node:fs/promises';

const { WP_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET, WP_USER, WP_APP_PASSWORD } = process.env;
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const WC = basic(WC_CONSUMER_KEY, WC_CONSUMER_SECRET);
const WP = basic(WP_USER, WP_APP_PASSWORD);
const OUT = 'data/raw';
const CONCURRENCY = 4;

async function get(path, auth, attempt = 1) {
  const res = await fetch(`${WP_URL}/wp-json/${path}`, { headers: { Authorization: auth } });
  if (res.status >= 500 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return get(path, auth, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 150)}`);
  return { data: await res.json(), totalPages: Number(res.headers.get('x-wp-totalpages') || 1) };
}

async function getAll(path, auth) {
  const sep = path.includes('?') ? '&' : '?';
  const url = (page) => `${path}${sep}per_page=100&page=${page}`;
  const first = await get(url(1), auth);
  if (!Array.isArray(first.data)) return first.data;
  const pages = [first.data];
  const rest = Array.from({ length: first.totalPages - 1 }, (_, i) => i + 2);
  for (let i = 0; i < rest.length; i += CONCURRENCY) {
    const chunk = await Promise.all(rest.slice(i, i + CONCURRENCY).map((p) => get(url(p), auth).then((r) => r.data)));
    pages.push(...chunk);
    process.stdout.write(`\r  ${path}: page ${Math.min(i + CONCURRENCY + 1, first.totalPages)}/${first.totalPages}   `);
  }
  if (first.totalPages > 1) process.stdout.write('\n');
  return pages.flat();
}

const EXPORTS = [
  // WooCommerce
  ['products', 'wc/v3/products?status=any', WC],
  ['variations', 'wc/v3/variations', WC],
  ['categories', 'wc/v3/products/categories', WC],
  ['tags', 'wc/v3/products/tags', WC],
  ['brands', 'wc/v3/products/brands', WC],
  ['attributes', 'wc/v3/products/attributes', WC],
  ['shipping_classes', 'wc/v3/products/shipping_classes', WC],
  ['reviews', 'wc/v3/products/reviews?status=all', WC],
  ['orders', 'wc/v3/orders?status=any', WC],
  ['refunds', 'wc/v3/refunds', WC],
  ['customers', 'wc/v3/customers?role=all', WC],
  ['coupons', 'wc/v3/coupons', WC],
  ['order_statuses', 'wc/v3/orders/statuses', WC],
  ['shipping_zones', 'wc/v3/shipping/zones', WC],
  ['shipping_methods', 'wc/v3/shipping_methods', WC],
  ['payment_gateways', 'wc/v3/payment_gateways', WC],
  ['taxes', 'wc/v3/taxes', WC],
  ['tax_classes', 'wc/v3/taxes/classes', WC],
  ['webhooks', 'wc/v3/webhooks', WC],
  ['system_status', 'wc/v3/system_status', WC],
  ['pickup_locations', 'wc/v3/pickup-locations', WC],
  // ATUM inventory
  ['atum_suppliers', 'wc/v3/atum/suppliers', WC],
  ['atum_purchase_orders', 'wc/v3/atum/purchase-orders', WC],
  ['atum_inventory_logs', 'wc/v3/atum/inventory-logs', WC],
  ['atum_locations', 'wc/v3/products/atum-locations', WC],
  ['atum_inbound_stock', 'wc/v3/atum/inbound-stock', WC],
  ['atum_product_variations', 'wc/v3/atum/product-variations', WC],
  ['atum_settings', 'wc/v3/atum/settings', WC],
  ['atum_stock_value', 'wc/v3/atum/dashboard/current-stock-value', WC],
  // WCPOS
  ['pos_settings', 'wcpos/v1/settings', WP],
  ['pos_stores', 'wcpos/v1/stores', WP],
  ['pos_payment_gateways', 'wcpos/v1/payment-gateways', WP],
  ['pos_templates', 'wcpos/v1/templates', WP],
  // WordPress content
  ['wp_pages', 'wp/v2/pages?context=edit&status=any', WP],
  ['wp_posts', 'wp/v2/posts?context=edit&status=any', WP],
  ['wp_media', 'wp/v2/media?context=edit', WP],
  ['wp_users', 'wp/v2/users?context=edit', WP],
  ['wp_menus', 'wp/v2/menus?context=edit', WP],
  ['wp_menu_items', 'wp/v2/menu-items?context=edit', WP],
  ['wp_types', 'wp/v2/types?context=edit', WP],
  ['wp_settings', 'wp/v2/settings', WP],
  ['wp_templates', 'wp/v2/templates?context=edit', WP],
  ['wp_template_parts', 'wp/v2/template-parts?context=edit', WP],
  ['wp_blocks', 'wp/v2/blocks?context=edit', WP],
  ['wp_plugins', 'wp/v2/plugins', WP],
  ['wp_comments', 'wp/v2/comments?context=edit&status=all', WP],
];

await mkdir(OUT, { recursive: true });
const only = process.argv.slice(2);
const summary = [];
for (const [name, path, auth] of EXPORTS) {
  if (only.length && !only.includes(name)) continue;
  const t = Date.now();
  try {
    const data = await getAll(path, auth);
    await writeFile(`${OUT}/${name}.json`, JSON.stringify(data, null, 2));
    const count = Array.isArray(data) ? data.length : 'obj';
    summary.push([name, count]);
    console.log(`OK   ${name}: ${count} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  } catch (e) {
    summary.push([name, 'FAIL']);
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
await writeFile(`${OUT}/_summary.json`, JSON.stringify({ exported_at: new Date().toISOString(), summary }, null, 2));
