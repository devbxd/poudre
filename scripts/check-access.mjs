// Checks WooCommerce + WordPress API access using the values in .env
// Usage: node --env-file=.env scripts/check-access.mjs
const { WP_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET, WP_USER, WP_APP_PASSWORD } = process.env;
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

async function check(label, path, auth) {
  try {
    const res = await fetch(`${WP_URL}${path}`, { headers: { Authorization: auth } });
    const total = res.headers.get('x-wp-total');
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${label} -> HTTP ${res.status}${total ? ` (total: ${total})` : ''}`);
    if (!res.ok) console.log('     ', (await res.text()).slice(0, 200));
  } catch (e) {
    console.log(`FAIL ${label} -> ${e.message}`);
  }
}

if (WC_CONSUMER_KEY) {
  const wc = basic(WC_CONSUMER_KEY, WC_CONSUMER_SECRET);
  await check('WooCommerce products', '/wp-json/wc/v3/products?per_page=1', wc);
  await check('WooCommerce orders  ', '/wp-json/wc/v3/orders?per_page=1', wc);
  await check('WooCommerce customers', '/wp-json/wc/v3/customers?per_page=1', wc);
} else console.log('SKIP WooCommerce (no WC_CONSUMER_KEY)');

if (WP_USER) {
  const wp = basic(WP_USER, WP_APP_PASSWORD);
  await check('WordPress user      ', '/wp-json/wp/v2/users/me?context=edit', wp);
  await check('WordPress pages     ', '/wp-json/wp/v2/pages?per_page=1&context=edit', wp);
  await check('WordPress media     ', '/wp-json/wp/v2/media?per_page=1', wp);
} else console.log('SKIP WordPress (no WP_USER)');
