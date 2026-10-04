// Endpoints called by the theme / WooCommerce JavaScript: /?wc-ajax=…, /wp-admin/admin-ajax.php and the Store API.
import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { query, tx } from '../db.js';
import { esc, wcPrice, decodeEntities } from './html.js';
import { productsByIds } from './data.js';
import { imageTag } from './images.js';
import { productUrl, texturize } from './product-card.js';
import { loadCart, saveCart, addToCart, computeCart, fragments, storeCart, sessionId } from './cart.js';
import { wishlistIds } from './visitor.js';
import { categoryTabHtml } from './home.js';
import { quickViewHtml, quickShopHtml, compareData } from './product-page.js';
import { getCookie } from 'hono/cookie';
import { availabilityHtml } from './variations.js';
import { createOrder } from '../orders.js';
import { sendOrderEmail, emailSettings, sendMail, layout } from '../mail.js';

export const shopApi = new Hono();
const siteUrl = (c) => process.env.SITE_URL || new URL(c.req.url).origin;
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

async function body(c) {
  const type = c.req.header('content-type') || '';
  if (type.includes('application/json')) return c.req.json().catch(() => ({}));
  if (c.req.method === 'GET') return c.req.query();
  return c.req.parseBody({ all: true }).catch(() => ({}));
}

async function fragmentsResponse(c, cart) {
  return c.json(await fragments(await computeCart(cart)));
}

// ---------------------------------------------------------------- wishlist (WPC Smart Wishlist)

async function saveWishlist(c, items) {
  const id = sessionId(c);
  await query(`insert into wishlists (id, items, updated_at) values ($1, $2, now()) on conflict (id) do update set items = excluded.items, updated_at = now()`, [id, JSON.stringify(items)]);
}

async function wishlistItems(items, { table = false, currentUrl = '/wishlist/' } = {}) {
  const ids = Object.keys(items).map(Number).sort((a, b) => items[b].time - items[a].time);
  const products = await productsByIds(ids);
  return products.map((p) => {
    const name = esc(decodeEntities(p.name));
    const url = productUrl(p);
    const img = p.image ? imageTag(p.image, 'woocommerce_thumbnail', { mode: 'attachment' }).replace(' decoding="async"', '').replace(/ alt="[^"]*"/, ` alt="${name}"`) : '';
    const date = new Date(items[p.id].time * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const price = p.type === 'variable'
      ? (p.range ? `${wcPrice(p.range.min)}${p.range.min !== p.range.max ? ` &ndash; ${wcPrice(p.range.max)}` : ''}` : '')
      : (p.on_sale ? `<del aria-hidden="true">${wcPrice(p.regular)}</del> <ins>${wcPrice(p.price)}</ins>` : p.price != null ? wcPrice(p.price) : '');
    const stock = p.stock_status === 'outofstock' ? '<p class="stock out-of-stock">Out of Stock</p>\n' : availabilityHtml(p);
    const canBuy = p.type !== 'variable' && p.purchasable && p.stock_status !== 'outofstock';
    const href = canBuy ? `${currentUrl}${currentUrl.includes('?') ? '&#038;' : '?'}add-to-cart=${p.id}` : url;
    const btn = canBuy
      ? `<a href="${href}" aria-describedby="woocommerce_loop_add_to_cart_link_describedby_${p.id}" data-quantity="1" class="button product_type_simple add_to_cart_button ajax_add_to_cart" data-product_id="${p.id}" data-product_sku="${esc(p.sku || '')}" aria-label="Add to cart: &ldquo;${name}&rdquo;" rel="nofollow" data-success_message="&ldquo;${name}&rdquo; has been added to your cart" role="button">Add to cart</a>`
      : `<a href="${url}" aria-describedby="woocommerce_loop_add_to_cart_link_describedby_${p.id}" data-quantity="1" class="button product_type_${p.type === 'variable' ? 'variable' : 'simple'}" data-product_id="${p.id}" data-product_sku="${esc(p.sku || '')}" aria-label="${p.type === 'variable' ? 'Select options for' : 'Read more about'} &ldquo;${name}&rdquo;" rel="" data-success_message="">${p.type === 'variable' ? 'Select options' : 'Read more'}</a>`;
    const cells = [
      `<div class="woosw-item--image"><a  href="${url}" >${img}</a></div>`,
      `<div class="woosw-item--info"><div class="woosw-item--name"><a  href="${url}" >${name}</a></div><div class="woosw-item--price">${price}</div><div class="woosw-item--time">${date}</div></div>`,
      `<div class="woosw-item--actions"><div class="woosw-item--stock">${stock}</div><div class="woosw-item--atc"><p class="product woocommerce add_to_cart_inline " style="">${btn}</p></div></div>`,
    ];
    if (table) {
      return `<tr class="woosw-item woosw-item-${p.id}" data-id="${p.id}" data-name="${name}" data-note="">${cells.map((x) => x.replace(/^<div class="(woosw-item--(?:image|info|actions))">/, '<td class="$1">').replace(/<\/div>$/, '</td>')).join('')}</tr>`;
    }
    return `<div class="woosw-item woosw-item-${p.id}" data-id="${p.id}" data-name="${name}" data-note=""><div class="woosw-item-inner">${cells.join('')}</div><!-- /woosw-item-inner --></div>`;
  }).join('');
}

function wishlistFragments(count) {
  return {
    '.woosw-menu-item': `<li class="menu-item woosw-menu-item menu-item-type-woosw"><a href="/wishlist/"><span class="woosw-menu-item-inner" data-count="${count}">Wishlist</span></a></li>`,
    '.pls-header-wishlist .pls-header-wishlist-count': `<span class="pls-header-wishlist-count" data-count="${count}">${count}</span>`,
    '.item-wishlist .pls-header-wishlist-count': `<span class="pls-header-wishlist-count">${count}</span>`,
  };
}

async function wishlistPopup(items) {
  const count = Object.keys(items).length;
  const list = count ? `<div class="woosw-items" data-key="WOOSW">${await wishlistItems(items, { currentUrl: '/?wc-ajax=woosw_load' })}</div>` : '<div class="woosw-popup-content-mid-message">There are no products on the wishlist!</div>';
  return `                    <div class="woosw-popup-inner" data-key="WOOSW">\n                        <div class="woosw-popup-content">\n                            <div class="woosw-popup-content-top">\n                                <span class="woosw-name">Wishlist</span>\n                                <span class="woosw-count-wrapper"><span class="woosw-count">${count}</span></span>                                <span class="woosw-popup-close"></span>\n                            </div>\n                                                        <div class="woosw-popup-content-mid">\n                                ${list}                            </div>\n                            <div class="woosw-popup-content-bot">\n                                <div class="woosw-popup-content-bot-inner">\n                                    <a class="woosw-page"\n                                       href="/wishlist/">\n                                        Open wishlist page                                    </a>\n                                    <a class="woosw-continue"\n                                       href=""\n                                       data-url="">\n                                        Continue shopping                                    </a>\n                                </div>\n                                <div class="woosw-notice"></div>\n                            </div>\n                        </div>\n                    </div>\n                    `;
}

export async function wishlistPageContent(c) {
  const items = await wishlistIds(c);
  if (!Object.keys(items).length) return '<div class="woosw-list" data-key="WOOSW"><div class="woosw-switcher"><div class="woosw-name-wrapper"><div class="woosw-name woosw-detail-name-wrap" data-key="WOOSW">Wishlist</div></div></div><div class="woosw-popup-content-mid-message">There are no products on the wishlist!</div></div>';
  return `<div class="woosw-list" data-key="WOOSW"><div class="woosw-switcher"><div class="woosw-name-wrapper"><div class="woosw-name woosw-detail-name-wrap" data-key="WOOSW">Wishlist</div></div></div><table class="woosw-items" data-key="WOOSW">${await wishlistItems(items, { table: true })}</table></div>`;
}

const WISHLIST = {
  async woosw_add(c, b) {
    const items = await wishlistIds(c);
    const id = Number(b.product_id);
    const [p] = await productsByIds([id]);
    if (!p) return c.json({ status: 0, notice: 'Invalid product.' });
    items[id] = { time: Math.floor(Date.now() / 1000), price: String(p.price ?? p.range?.min ?? ''), parent: 0, note: '' };
    await saveWishlist(c, items);
    const count = Object.keys(items).length;
    return c.json({ notice: '{name} has been added to Wishlist.', status: 1, count, items: '', data: { key: 'WOOSW', ids: items, fragments: wishlistFragments(count) }, content: await wishlistPopup(items) });
  },
  async woosw_remove(c, b) {
    const items = await wishlistIds(c);
    delete items[Number(b.product_id)];
    await saveWishlist(c, items);
    const count = Object.keys(items).length;
    return c.json({ notice: '{name} has been removed from Wishlist.', status: 1, count, data: { key: 'WOOSW', ids: items, fragments: wishlistFragments(count) }, content: await wishlistPopup(items) });
  },
  async woosw_empty(c) {
    await saveWishlist(c, {});
    return c.json({ status: 1, count: 0, data: { key: 'WOOSW', ids: {}, fragments: wishlistFragments(0) }, content: await wishlistPopup({}) });
  },
  async woosw_load(c) {
    const items = await wishlistIds(c);
    const count = Object.keys(items).length;
    return c.json({ status: 1, count, content: await wishlistPopup(items), data: { key: 'WOOSW', ids: items, fragments: wishlistFragments(count) } });
  },
  async woosw_load_count(c) {
    return c.json({ status: 1, count: Object.keys(await wishlistIds(c)).length });
  },
  async woosw_get_data(c) {
    const items = await wishlistIds(c);
    return c.json({ key: 'WOOSW', ids: items, fragments: wishlistFragments(Object.keys(items).length) });
  },
};

// ---------------------------------------------------------------- /?wc-ajax=…

const WC_AJAX = {
  async get_refreshed_fragments(c) {
    return fragmentsResponse(c, await loadCart(c));
  },
  async add_to_cart(c, b) {
    const cart = await loadCart(c);
    const [p] = await productsByIds([Number(b.product_id)]);
    if (p?.type === 'variable') return c.json({ error: true, product_url: siteUrl(c) + productUrl(p) });
    const err = await addToCart(cart, { productId: b.product_id, quantity: b.quantity });
    if (err) return c.json({ error: true, product_url: p ? siteUrl(c) + productUrl(p) : '' });
    await saveCart(c, cart);
    return fragmentsResponse(c, cart);
  },
  async pls_ajax_add_to_cart(c, b) {
    const cart = await loadCart(c);
    const productId = b['pls-product-id'] || b.product_id || b['add-to-cart'];
    const variation = Object.fromEntries(Object.entries(b).filter(([k]) => k.startsWith('attribute_')).map(([k, v]) => [k, String(v)]));
    const err = await addToCart(cart, { productId, variationId: b.variation_id && Number(b.variation_id) ? b.variation_id : null, quantity: b.quantity, variation });
    if (err) return c.json({ error: true, message: err, notices: `<ul class="woocommerce-error" role="alert"><li>${err}</li></ul>` });
    await saveCart(c, cart);
    return fragmentsResponse(c, cart);
  },
  async remove_from_cart(c, b) {
    const cart = await loadCart(c);
    cart.items = cart.items.filter((i) => i.key !== b.cart_item_key);
    await saveCart(c, cart);
    return fragmentsResponse(c, cart);
  },
  async apply_coupon(c, b) {
    const cart = await loadCart(c);
    const code = String(b.coupon_code || '').trim().toLowerCase();
    const before = await computeCart({ ...cart, coupons: [...new Set([...(cart.coupons || []), code])] });
    if (before.errors.length) return c.html(`<ul class="woocommerce-error" role="alert"><li>${esc(before.errors[0])}</li></ul>`);
    cart.coupons = [...new Set([...(cart.coupons || []), code])];
    await saveCart(c, cart);
    return c.html('<div class="woocommerce-message" role="alert">Coupon code applied successfully.</div>');
  },
  ...WISHLIST,
  async woosc_load(c, b) {
    // the compare list lives in the visitor's cookie ("woosc_products_<hash>"), as with the plugin
    const raw = Object.entries(getCookie(c) || {}).find(([k]) => k.startsWith('woosc_products'))?.[1] || '';
    const ids = decodeURIComponent(raw).split(',').map(Number).filter(Boolean).slice(0, 100);
    if (!ids.length) return c.json(b.get_data === 'count' ? { count: 0 } : { bar: '', table: '<div class="woosc-no-result">Click outside to hide the comparison bar</div>', filter: '' });
    const d = await compareData(ids);
    if (b.get_data === 'count') return c.json({ count: d.count });
    return c.json({ bar: d.bar, table: d.table, filter: '', sidebar: d.bar, count: d.count });
  },
  async woosc_search(c) { return c.html(''); },
};

export async function wcAjax(c) {
  const action = c.req.query('wc-ajax');
  const fn = WC_AJAX[action];
  if (!fn) return c.json({ error: true, message: `Unknown action ${action}` }, 400);
  return fn(c, await body(c));
}

// ---------------------------------------------------------------- /wp-admin/admin-ajax.php

const flatAttr = (b, name) => {
  // jQuery sends attr[foo]=bar → {"attr[foo]": "bar"}
  const out = {};
  for (const [k, v] of Object.entries(b)) { const m = k.match(new RegExp(`^${name}\\[([^\\]]+)\\]$`)); if (m) out[m[1]] = v; }
  return out;
};

const ADMIN_AJAX = {
  async pls_product_quick_view(c, b) {
    return c.html(await quickViewHtml(b.pid || b.product_id || b.id));
  },
  async pls_quick_shop_add_to_cart(c, b) {
    return c.html(await quickShopHtml(b.product_id || b.pid));
  },
  async pls_category_tab_product(c, b) {
    return c.json({ html: await categoryTabHtml(flatAttr(b, 'attr')) });
  },
  async pls_update_cart_widget_quantity(c, b) {
    const cart = await loadCart(c);
    const it = cart.items.find((i) => i.key === b.cart_item_key);
    const qty = Math.max(0, Math.floor(Number(b.quantity) || 0));
    if (it) { if (qty === 0) cart.items = cart.items.filter((i) => i !== it); else it.quantity = qty; }
    await saveCart(c, cart);
    return fragmentsResponse(c, cart);
  },
  async pls_apply_coupon(c, b) {
    const cart = await loadCart(c);
    const code = String(b.coupon_code || '').trim().toLowerCase();
    const test = await computeCart({ ...cart, coupons: [...new Set([...(cart.coupons || []), code])] });
    if (!code || test.errors.length) return c.json({ result: 'failure', message: test.errors[0] || 'Please enter a coupon code.' });
    cart.coupons = [...new Set([...(cart.coupons || []), code])];
    await saveCart(c, cart);
    return c.json({ result: 'success', message: 'Coupon code applied successfully.', ...(await fragments(await computeCart(cart))) });
  },
  async pls_remove_coupon(c, b) {
    const cart = await loadCart(c);
    cart.coupons = (cart.coupons || []).filter((x) => x !== String(b.coupon || b.coupon_code || '').toLowerCase());
    await saveCart(c, cart);
    return c.json({ result: 'success', ...(await fragments(await computeCart(cart))) });
  },
  async pls_update_shipping_method(c, b) {
    const cart = await loadCart(c);
    cart.shipping_method = b['shipping_method[0]'] || b.shipping_method || cart.shipping_method;
    await saveCart(c, cart);
    return fragmentsResponse(c, cart);
  },
  async pls_add_order_note(c, b) {
    const cart = await loadCart(c);
    cart.customer = { ...cart.customer, note: String(b.note || '') };
    await saveCart(c, cart);
    return c.json({ result: 'success' });
  },
  async pls_ajax_search(c) {
    const q = String(c.req.query('query') || '').trim().toLowerCase();
    if (q.length < 2) return c.json({ suggestions: [] });
    const cat = c.req.query('product_cat');
    const params = [`%${q}%`];
    let where = `p.status = 'publish' and p.online_visible and p.catalog_visibility in ('visible','search') and (lower(p.name) like $1 or lower(coalesce(p.sku,'')) like $1)`;
    if (cat) { params.push(cat); where += ` and exists (select 1 from product_categories pc join categories cc on cc.id = pc.category_id where pc.product_id = p.id and cc.slug = $2)`; }
    const rows = await query(`select p.id from products p where ${where} order by (p.stock_status = 'outofstock'), p.total_sales desc limit 10`, params);
    const products = await productsByIds(rows.map((r) => r.id));
    if (!products.length) return c.json({ suggestions: [{ id: -1, value: 'No data found.', url: '' }] });
    return c.json({
      suggestions: products.map((p) => ({
        id: p.id, value: decodeEntities(p.name), url: siteUrl(c) + productUrl(p),
        img: p.image ? imageTag(p.image, 'woocommerce_gallery_thumbnail', { mode: 'attachment' }) : '',
        price: p.type === 'variable' ? (p.range ? wcPrice(p.range.min) : '') : (p.price != null ? wcPrice(p.price) : ''),
      })),
    });
  },
};

export async function adminAjax(c) {
  const b = { ...c.req.query(), ...(await body(c)) };
  const action = b.action || c.req.query('action');
  const fn = ADMIN_AJAX[action];
  if (!fn) return c.text('0', 400);
  return fn(c, b);
}

// ---------------------------------------------------------------- Store API (cart & checkout blocks)

const NONCE = 'poudre';
async function storeResponse(c, cart, status = 200) {
  const state = await computeCart(cart);
  c.header('Nonce', NONCE);
  c.header('Nonce-Timestamp', String(Math.floor(Date.now() / 1000)));
  c.header('Cart-Token', cart.id);
  c.header('Cache-Control', 'no-store');
  return c.json(await storeCart(state, siteUrl(c)), status);
}
const storeError = (c, code, message, status = 400) => c.json({ code, message, data: { status } }, status);

export async function storeCartData(c) {
  return storeCart(await computeCart(await loadCart(c)), siteUrl(c));
}

// Each Store API route as a function so /batch can call them too
const STORE = {
  'GET cart': async (c) => storeResponse(c, await loadCart(c)),
  'POST cart/add-item': async (c, b) => {
    const cart = await loadCart(c);
    const variation = Object.fromEntries((b.variation || []).map((v) => [v.attribute.startsWith('attribute_') ? v.attribute : `attribute_${v.attribute}`, v.value]));
    const err = await addToCart(cart, { productId: b.id, quantity: b.quantity, variation });
    if (err) return storeError(c, 'woocommerce_rest_cart_invalid_product', err.replace(/<[^>]+>/g, ''));
    await saveCart(c, cart);
    return storeResponse(c, cart, 201);
  },
  'POST cart/update-item': async (c, b) => {
    const cart = await loadCart(c);
    const it = cart.items.find((i) => i.key === b.key);
    if (!it) return storeError(c, 'woocommerce_rest_cart_invalid_key', 'Cart item no longer exists or is invalid.', 409);
    it.quantity = Math.max(1, Math.floor(Number(b.quantity) || 1));
    await saveCart(c, cart);
    return storeResponse(c, cart);
  },
  'POST cart/remove-item': async (c, b) => {
    const cart = await loadCart(c);
    cart.items = cart.items.filter((i) => i.key !== b.key);
    await saveCart(c, cart);
    return storeResponse(c, cart);
  },
  'POST cart/apply-coupon': async (c, b) => {
    const cart = await loadCart(c);
    const code = String(b.code || '').trim().toLowerCase();
    const test = await computeCart({ ...cart, coupons: [...new Set([...(cart.coupons || []), code])] });
    if (test.errors.length) return storeError(c, 'woocommerce_rest_cart_coupon_error', test.errors[0]);
    cart.coupons = [...new Set([...(cart.coupons || []), code])];
    await saveCart(c, cart);
    return storeResponse(c, cart);
  },
  'POST cart/remove-coupon': async (c, b) => {
    const cart = await loadCart(c);
    cart.coupons = (cart.coupons || []).filter((x) => x !== String(b.code || '').toLowerCase());
    await saveCart(c, cart);
    return storeResponse(c, cart);
  },
  'POST cart/select-shipping-rate': async (c, b) => {
    const cart = await loadCart(c);
    cart.shipping_method = b.rate_id;
    await saveCart(c, cart);
    return storeResponse(c, cart);
  },
  'POST cart/update-customer': async (c, b) => {
    const cart = await loadCart(c);
    cart.customer = { ...cart.customer, ...(b.billing_address ? { billing_address: b.billing_address } : {}), ...(b.shipping_address ? { shipping_address: b.shipping_address } : {}) };
    await saveCart(c, cart);
    return storeResponse(c, cart);
  },
  'GET checkout': async (c) => c.json(checkoutDraft(await loadCart(c))),
  'PUT checkout': async (c, b) => {
    const cart = await loadCart(c);
    if (b.additional_fields || b.order_notes !== undefined) cart.customer = { ...cart.customer, note: b.order_notes ?? cart.customer.note };
    await saveCart(c, cart);
    return c.json(checkoutDraft(cart));
  },
  'POST checkout': async (c, b) => placeOrder(c, b),
};

function checkoutDraft(cart) {
  const bill = { first_name: '', last_name: '', company: '', address_1: '', address_2: '', city: '', state: '', postcode: '', country: 'LB', email: '', phone: '', ...(cart.customer.billing_address || {}) };
  const ship = { first_name: '', last_name: '', company: '', address_1: '', address_2: '', city: '', state: '', postcode: '', country: 'LB', phone: '', ...(cart.customer.shipping_address || {}) };
  return { order_id: 0, status: 'checkout-draft', order_key: '', order_number: '0', customer_note: cart.customer.note || '', customer_id: 0, billing_address: bill, shipping_address: ship, payment_method: '', payment_result: null, additional_fields: {}, __experimentalCart: null, extensions: {} };
}

async function placeOrder(c, b) {
  const cart = await loadCart(c);
  const state = await computeCart(cart);
  if (!state.lines.length) return storeError(c, 'woocommerce_rest_cart_empty', 'Cannot create order from empty cart.');
  const billing = { ...(b.billing_address || {}) };
  const shipping = { ...(b.shipping_address || billing) };
  if (!billing.email && !billing.phone && !shipping.phone) return storeError(c, 'invalid_billing', 'Please enter a valid email address or phone number.');
  if (!billing.first_name && shipping.first_name) Object.assign(billing, { first_name: shipping.first_name, last_name: shipping.last_name, address_1: shipping.address_1, city: shipping.city, phone: billing.phone || shipping.phone });
  const rate = state.selected;
  const orderKey = `wc_order_${randomBytes(9).toString('base64url')}`;
  let order;
  try {
    order = await tx((t) => createOrder(t, {
      items: state.lines.map((l) => ({ product_id: l.product_id, variation_id: l.variation_id, quantity: l.quantity })),
      billing, shipping, coupon_code: cart.coupons?.[0] || null,
      shipping_total: rate ? Number(rate.cost || 0) : 0, shipping_method: rate ? decodeEntities(rate.label || rate.title) : null,
      payment_method: b.payment_method || 'cod', payment_title: 'Cash on delivery Or Via Whish account',
      customer_note: b.customer_note || cart.customer.note || '', status: 'processing',
      meta: { order_key: orderKey, source: 'website' },
    }, { channel: 'online', enforceStock: true }));
  } catch (e) {
    return storeError(c, 'woocommerce_rest_checkout_error', e.message);
  }
  cart.items = [];
  cart.coupons = [];
  await saveCart(c, cart);
  // like WooCommerce: alert the shop and confirm to the customer (in parallel, failures only logged)
  const mails = Promise.all([sendOrderEmail('new_order', order.id), sendOrderEmail('customer_processing', order.id)]);
  // on Netlify the e-mails finish after the response (context.waitUntil), so the customer is not kept waiting
  const waitUntil = c.env?.context?.waitUntil?.bind(c.env.context);
  if (waitUntil) waitUntil(mails); else await mails;
  const redirect = `${siteUrl(c)}/checkout/order-received/${order.id}/?key=${orderKey}`;
  return c.json({
    order_id: order.id, status: 'processing', order_key: orderKey, order_number: String(order.id), customer_note: b.customer_note || '', customer_id: 0,
    billing_address: billing, shipping_address: shipping, payment_method: b.payment_method || 'cod',
    payment_result: { payment_status: 'success', payment_details: [], redirect_url: redirect }, additional_fields: {}, extensions: {},
  });
}

shopApi.all('/wp-json/wc/store/v1/batch', async (c) => {
  const b = await c.req.json().catch(() => ({ requests: [] }));
  const responses = [];
  for (const r of b.requests || []) {
    const path = String(r.path || '').replace(/^\/wc\/store\/v1\//, '').replace(/\?.*$/, '');
    const fn = STORE[`${(r.method || 'POST').toUpperCase()} ${path}`];
    if (!fn) { responses.push({ body: { code: 'rest_no_route', message: 'No route', data: { status: 404 } }, status: 404, headers: {} }); continue; }
    const res = await fn(c, r.body || {});
    responses.push({ body: await res.json(), status: res.status, headers: {} });
  }
  return c.json({ responses }, 207);
});

shopApi.all('/wp-json/wc/store/v1/*', async (c) => {
  const path = c.req.path.replace(/^\/wp-json\/wc\/store\/v1\//, '').replace(/\/$/, '');
  const fn = STORE[`${c.req.method} ${path}`];
  if (!fn) return storeError(c, 'rest_no_route', 'No route was found matching the URL and request method.', 404);
  return fn(c, c.req.method === 'GET' ? c.req.query() : await c.req.json().catch(() => ({})));
});

shopApi.all('/wp-admin/admin-ajax.php', adminAjax);


// ---------------- Contact Form 7 (Contact Us page): same REST endpoints and answers as the plugin ----------------
const CF7_RULES = [
  { rule: 'required', field: 'your-name', error: 'Please fill out this field.' }, { rule: 'maxlength', field: 'your-name', threshold: 400, error: 'This field has a too long input.' },
  { rule: 'required', field: 'your-email', error: 'Please fill out this field.' }, { rule: 'email', field: 'your-email', error: 'Please enter an email address.' },
  { rule: 'maxlength', field: 'your-email', threshold: 400, error: 'This field has a too long input.' },
  { rule: 'required', field: 'your-subject', error: 'Please fill out this field.' }, { rule: 'maxlength', field: 'your-subject', threshold: 400, error: 'This field has a too long input.' },
  { rule: 'maxlength', field: 'your-message', threshold: 2000, error: 'This field has a too long input.' },
];
shopApi.get('/wp-json/contact-form-7/v1/contact-forms/:id/feedback/schema', (c) => c.json({ version: 'Contact Form 7 SWV Schema 2024-10', locale: 'en_US', rules: CF7_RULES }));
shopApi.post('/wp-json/contact-form-7/v1/contact-forms/:id/feedback', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const unit = String(f._wpcf7_unit_tag || `wpcf7-f${id}-p39-o1`);
  const val = (k) => String(f[k] ?? '').trim();
  const invalid = [];
  for (const r of CF7_RULES) {
    if (invalid.some((x) => x.field === r.field)) continue;
    const v = val(r.field);
    const bad = r.rule === 'required' ? !v : r.rule === 'email' ? v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) : v.length > r.threshold;
    if (bad) invalid.push({ field: r.field, message: r.error, idref: null, error_id: `${unit}-ve-${r.field}` });
  }
  const base = { contact_form_id: id, posted_data_hash: '', into: `#${unit}` };
  if (invalid.length) return c.json({ ...base, status: 'validation_failed', message: 'One or more fields have an error. Please check and try again.', invalid_fields: invalid });
  const msg = { name: val('your-name'), email: val('your-email'), subject: val('your-subject'), body: val('your-message') };
  // bots: obvious link spam is stored as already-read so it does not bother the shop
  const spammy = (msg.body.match(/https?:\/\//g) || []).length > 2;
  await query('insert into messages (kind, name, email, subject, body, read) values ($1,$2,$3,$4,$5,$6)', ['contact', msg.name, msg.email, msg.subject, msg.body, spammy]);
  if (!spammy) {
    try {
      const cfg = await emailSettings();
      if (cfg.enabled.contact_form && cfg.notify_to && cfg.smtp_user && cfg.smtp_pass) {
        await sendMail({
          to: cfg.notify_to, replyTo: msg.email, subject: `[${cfg.from_name}] ${msg.subject}`,
          html: layout(cfg, 'New message from the website', `<p><b>From:</b> ${esc(msg.name)} &lt;${esc(msg.email)}&gt;</p><p><b>Subject:</b> ${esc(msg.subject)}</p><p style="white-space:pre-wrap;border:1px solid #eee;padding:12px">${esc(msg.body)}</p><p style="color:#8a8a8a">Reply to this e-mail to answer the customer. All messages are also in Dashboard → Messages.</p>`),
        }, cfg);
      }
    } catch (e) { console.error('contact mail', e.message); }
  }
  return c.json({ ...base, status: 'mail_sent', message: 'Thank you for your message. It has been sent.', invalid_fields: [] });
});
export { texturize };
