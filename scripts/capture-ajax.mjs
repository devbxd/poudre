// Records real responses of the WordPress AJAX endpoints so the new server can reproduce them exactly.
import { readFile, writeFile } from 'node:fs/promises';

const SITE = 'https://poudrebeauty.com';
const OUT = 'data/original/ajax';
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function req(method, path, form) {
  const res = await fetch(SITE + path, {
    method, redirect: 'manual',
    headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookieHeader(), 'X-Requested-With': 'XMLHttpRequest', ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}
const save = async (name, r) => { await writeFile(`${OUT}/${name}.txt`, `STATUS ${r.status}\nTYPE ${r.type}\n\n${r.body}`); console.log(name, r.status, r.body.length); };

const home = (await req('GET', '/')).body;
const opts = JSON.parse(home.match(/var pls_options = (\{.*?\});/)[1]);
const wooswNonce = home.match(/woosw_vars = \{[^}]*"nonce":"([^"]+)"/)?.[1];
const wooscNonce = home.match(/woosc_vars = \{[^}]*"nonce":"([^"]+)"/)?.[1];
const products = JSON.parse(await readFile('data/raw/products.json', 'utf8'));
const visible = (p) => p.status === 'publish' && p.stock_status === 'instock' && !((p.meta_data.find((m) => m.key === '_alg_wc_pvbur_invisible')?.value) || []).includes?.('guest');
const simple = products.find((p) => p.type === 'simple' && visible(p) && p.images.length && Number(p.price) > 0);
const variable = products.find((p) => p.type === 'variable' && visible(p) && p.images.length);
const variations = JSON.parse(await readFile('data/raw/variations.json', 'utf8')).filter((v) => v.parent_id === variable.id && v.stock_status === 'instock');
console.log('simple', simple.id, simple.name, '| variable', variable.id, variable.name, variations.length);

// category tabs: reuse the attributes of the first tabs widget on the homepage
const tabAttr = home.match(/data-attribute='([^']+)'/) || home.match(/data-attribute="([^"]+)"/);
await writeFile(`${OUT}/_tab_attr.txt`, tabAttr ? tabAttr[1] : 'none');
const tabLinks = [...home.matchAll(/<a[^>]+data-(?:cat|category|term|id)=["']([^"']+)["'][^>]*>/g)].slice(0, 5).map((m) => m[0]);
await writeFile(`${OUT}/_tab_links.txt`, tabLinks.join('\n'));

await save('fragments_empty', await req('POST', '/?wc-ajax=get_refreshed_fragments', { time: Date.now() }));
await save('search', await req('GET', `/wp-admin/admin-ajax.php?action=pls_ajax_search&query=dior&product_cat=&nonce=${opts.ajax_search_nonce}`));
await save('quick_view_simple', await req('POST', '/wp-admin/admin-ajax.php', { action: 'pls_product_quick_view', pid: simple.id, nonce: opts.quick_view_nonce }));
await save('quick_view_variable', await req('POST', '/wp-admin/admin-ajax.php', { action: 'pls_product_quick_view', pid: variable.id, nonce: opts.quick_view_nonce }));
await save('quick_shop', await req('POST', '/wp-admin/admin-ajax.php', { action: 'pls_quick_shop_add_to_cart', product_id: variable.id, nonce: opts.quick_shop_nonce }));
await save('add_to_cart_loop', await req('POST', '/?wc-ajax=add_to_cart', { product_id: simple.id, quantity: 1, product_sku: simple.sku || '' }));
const v = variations[0];
const varForm = { 'pls-product-id': variable.id, nonce: opts.add_to_cart_nonce, quantity: 1, product_id: variable.id, variation_id: v.id, action: 'pls_ajax_add_to_cart' };
for (const a of v.attributes) varForm[`attribute_${a.slug?.startsWith('pa_') ? a.slug : 'pa_' + a.name}`.toLowerCase().replace(/\s+/g, '-')] = a.option;
for (const a of v.attributes) varForm[`attribute_${a.name.toLowerCase().replace(/\s+/g, '-')}`] = a.option;
await save('add_to_cart_single_variable', await req('POST', '/?wc-ajax=pls_ajax_add_to_cart', varForm));
await save('fragments_full', await req('POST', '/?wc-ajax=get_refreshed_fragments', { time: Date.now() }));
const cartHtml = await req('GET', '/cart/');
await save('page_cart_full', cartHtml);
const key = cartHtml.body.match(/data-cart_item_key="([a-f0-9]+)"/)?.[1] || cartHtml.body.match(/cart\[([a-f0-9]{32})\]/)?.[1];
await save('apply_coupon', await req('POST', '/wp-admin/admin-ajax.php', { action: 'pls_apply_coupon', coupon_code: 'poudre10', nonce: opts.nonce }));
await save('wc_apply_coupon', await req('POST', '/?wc-ajax=apply_coupon', { coupon_code: 'poudre10', security: home.match(/"apply_coupon_nonce":"([^"]+)"/)?.[1] || '' }));
await save('page_cart_coupon', await req('GET', '/cart/'));
const checkout = await req('GET', '/checkout/');
await save('page_checkout_full', checkout);
const orderReviewNonce = checkout.body.match(/"update_order_review_nonce":"([^"]+)"/)?.[1];
await save('update_order_review', await req('POST', '/?wc-ajax=update_order_review', { security: orderReviewNonce, payment_method: 'cod', country: 'LB', state: '', postcode: '', city: 'Beirut', address: 'x', has_full_address: 'true', post_data: 'billing_country=LB' }));
if (key) await save('mini_cart_qty', await req('POST', '/wp-admin/admin-ajax.php', { action: 'pls_update_cart_widget_quantity', quantity: 2, cart_item_key: key, nonce: opts.nonce }));
if (key) await save('remove_from_cart', await req('POST', '/?wc-ajax=remove_from_cart', { cart_item_key: key }));
await save('woosw_add', await req('POST', '/?wc-ajax=woosw_add', { product_id: simple.id, nonce: wooswNonce }));
await save('woosw_load_count', await req('POST', '/?wc-ajax=woosw_load_count', { nonce: wooswNonce }));
await save('woosw_load', await req('POST', '/?wc-ajax=woosw_load', { nonce: wooswNonce }));
await save('page_wishlist_full', await req('GET', '/wishlist/'));
await save('woosc_load', await req('POST', '/?wc-ajax=woosc_load', { products: `${simple.id},${variable.id}`, nonce: wooscNonce }));
await save('page_my_account', await req('GET', '/my-account/'));
console.log('cookies:', [...jar.keys()].join(', '));
