// Website cart: storage, totals, shipping, the theme's mini-cart fragments and the WooCommerce Store API format.
import { createHash, randomBytes } from 'node:crypto';
import { getCookie, setCookie } from 'hono/cookie';
import { query, tx } from '../db.js';
import { esc, wcPrice, decodeEntities } from './html.js';
import { productsByIds, mediaByIds, setting } from './data.js';
import { imageTag, srcset } from './images.js';
import { texturize, productUrl } from './product-card.js';
import { attributeTaxonomies, attributeKeyValue } from './variations.js';
import { applyCoupon } from '../orders.js';

const COOKIE = 'poudre_session';
const md5 = (s) => createHash('md5').update(s).digest('hex');
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const P = (n) => wcPrice(n, { bdi: true, symbol: '&#36;', translate: true });
const cents = (n) => String(Math.round(Number(n || 0) * 100));
const uniqid = () => `quantity_${Date.now().toString(16).slice(-8)}${Math.floor(Math.random() * 0xfffff).toString(16).padStart(5, '0')}`;
const CURRENCY = { currency_code: 'USD', currency_symbol: '$', currency_minor_unit: 2, currency_decimal_separator: '.', currency_thousand_separator: ',', currency_prefix: '$', currency_suffix: '' };

// ---------------------------------------------------------------- storage

export function sessionId(c) {
  let id = getCookie(c, COOKIE);
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = randomBytes(16).toString('hex');
    setCookie(c, COOKIE, id, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 60, secure: new URL(c.req.url).protocol === 'https:' });
  }
  return id;
}

export async function loadCart(c) {
  const id = sessionId(c);
  const [row] = await query('select * from carts where id = $1', [id]);
  return row ? { ...row, items: json(row.items) || [], customer: json(row.customer) || {} } : { id, items: [], coupons: [], shipping_method: null, customer: {} };
}

export async function saveCart(c, cart) {
  await query(`insert into carts (id, items, coupons, shipping_method, customer, updated_at) values ($1, $2, $3, $4, $5, now())
    on conflict (id) do update set items = excluded.items, coupons = excluded.coupons, shipping_method = excluded.shipping_method, customer = excluded.customer, updated_at = now()`,
  [cart.id, JSON.stringify(cart.items), cart.coupons || [], cart.shipping_method || null, JSON.stringify(cart.customer || {})]);
  // WooCommerce JS watches these cookies to refresh the mini cart
  const count = cart.items.reduce((s, i) => s + i.quantity, 0);
  const secure = new URL(c.req.url).protocol === 'https:';
  if (count) {
    setCookie(c, 'woocommerce_items_in_cart', '1', { path: '/', secure });
    setCookie(c, 'woocommerce_cart_hash', md5(JSON.stringify(cart.items)), { path: '/', secure });
  } else {
    setCookie(c, 'woocommerce_items_in_cart', '0', { path: '/', maxAge: 0 });
    setCookie(c, 'woocommerce_cart_hash', '', { path: '/', maxAge: 0 });
  }
}

const itemKey = (pid, vid, variation) => md5(`${pid}_${vid || 0}_${JSON.stringify(variation || {})}`);

/** Adds a product; returns an error message or null. variation: { attribute_pa_color: 'slug', ... } */
export async function addToCart(cart, { productId, variationId = null, quantity = 1, variation = {} }) {
  const [p] = await productsByIds([Number(productId)]);
  if (!p || p.status !== 'publish') return 'Sorry, this product cannot be purchased.';
  let vid = variationId ? Number(variationId) : null;
  if (p.type === 'variable') {
    if (!vid) {
      // find the variation from the selected attributes (like WooCommerce's data store lookup)
      const match = (p.available_variations || []).find((v) => Object.entries(v.attributes).every(([k, val]) => val === '' || variation[k] === val));
      vid = match?.variation_id || null;
    }
    if (!vid) return 'Please choose product options by visiting <a href="' + productUrl(p) + '" title="' + esc(decodeEntities(p.name)) + '">' + esc(decodeEntities(p.name)) + '</a>.';
  }
  const stock = await stockOf(p.id, vid);
  const key = itemKey(p.id, vid, variation);
  const existing = cart.items.find((i) => i.key === key);
  const wanted = (existing?.quantity || 0) + Math.max(1, Number(quantity) || 1);
  if (stock.status === 'outofstock') return `You cannot add &quot;${esc(decodeEntities(p.name))}&quot; to the cart because the product is out of stock.`;
  if (stock.max != null && wanted > stock.max) return `You cannot add that amount to the cart &mdash; we have ${stock.max} in stock and you already have ${existing?.quantity || 0} in your cart.`;
  if (existing) existing.quantity = wanted;
  else cart.items.push({ key, product_id: p.id, variation_id: vid, quantity: wanted, variation });
  return null;
}

async function stockOf(productId, variationId) {
  const [r] = variationId
    ? await query('select manage_stock, stock_quantity, stock_status, backorders from variations where id = $1', [variationId])
    : await query('select manage_stock, stock_quantity, stock_status, backorders from products where id = $1', [productId]);
  if (!r) return { status: 'outofstock', max: 0 };
  return { status: r.stock_status, max: r.manage_stock && r.backorders === 'no' ? Math.max(0, r.stock_quantity) : null, quantity: r.stock_quantity, managed: r.manage_stock };
}

// ---------------------------------------------------------------- totals

/** Prices every line from the database and computes coupons, shipping rates and totals. */
export async function computeCart(cart) {
  const products = new Map((await productsByIds([...new Set(cart.items.map((i) => i.product_id))])).map((p) => [p.id, p]));
  const lines = [];
  for (const it of cart.items) {
    const p = products.get(it.product_id);
    if (!p) continue;
    let unit, regular, image = p.image, sku = p.sku, v = null;
    if (it.variation_id) {
      v = (p.available_variations || []).find((x) => x.variation_id === it.variation_id)
        || (await variationRow(it.variation_id, p));
      if (!v) continue;
      unit = Number(v.display_price); regular = Number(v.display_regular_price); sku = v.sku || p.sku;
      if (v.image_id && v.image_id !== p.image?.id) image = (await mediaByIds([v.image_id])).get(Number(v.image_id)) || p.image;
    } else {
      if (p.price == null) continue;
      unit = p.price; regular = p.regular;
    }
    const stock = await stockOf(p.id, it.variation_id);
    lines.push({ ...it, product: p, variationData: v, unit, regular, image, sku, subtotal: unit * it.quantity, stock });
  }
  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
  // coupons (validated again on every computation)
  let discount = 0;
  const coupons = [];
  const errors = [];
  for (const code of cart.coupons || []) {
    try {
      const r = await tx((t) => applyCoupon(t, code, lines.map((l) => ({ product_id: l.product_id, price: l.unit, quantity: l.quantity, subtotal: l.subtotal, on_sale: l.unit < l.regular, category_ids: [] }))));
      discount += r.discount;
      coupons.push({ code: r.coupon.code, discount: r.discount, free_shipping: r.free_shipping, type: r.coupon.type });
    } catch (e) { errors.push(e.message); }
  }
  discount = Math.min(discount, subtotal);
  // shipping rates
  const ship = await setting('shipping', { methods: [] });
  const freeByCoupon = coupons.some((c) => c.free_shipping);
  let rates = (ship.methods || []).filter((m) => m.enabled !== false).filter((m) => {
    if (m.type === 'free_shipping' && m.min_amount != null) return freeByCoupon || subtotal >= m.min_amount;
    return true;
  });
  // once free shipping is reached (order amount or coupon), only free shipping and store pickup are offered
  const earnedFree = rates.filter((m) => m.type === 'free_shipping' && m.min_amount != null);
  if (earnedFree.length) rates = rates.filter((m) => earnedFree.includes(m) || /pickup/.test(m.type || m.id));
  const selected = rates.find((r) => r.id === cart.shipping_method) || rates[0] || null;
  const shippingTotal = lines.length && selected ? Number(selected.cost || 0) : 0;
  const total = Math.max(0, subtotal - discount) + shippingTotal;
  return { cart, lines, subtotal, discount, coupons, errors, rates, selected, shippingTotal, total, count: lines.reduce((s, l) => s + l.quantity, 0) };
}

async function variationRow(id, p) {
  const [v] = await query('select * from variations where id = $1', [id]);
  if (!v) return null;
  const price = v.sale_price != null && Number(v.sale_price) < Number(v.regular_price ?? p.regular_price) ? Number(v.sale_price) : Number(v.regular_price ?? p.regular_price);
  return { variation_id: v.id, display_price: price, display_regular_price: Number(v.regular_price ?? p.regular_price), sku: v.sku, image_id: json(v.image)?.id, attributes: {} };
}

/** "Color: 304 Bikini Bubbles" pairs for a cart line */
async function variationPairs(line) {
  if (!line.variation_id) return [];
  const taxonomies = await attributeTaxonomies();
  const [v] = await query('select attributes from variations where id = $1', [line.variation_id]);
  const attrs = json(v?.attributes) || [];
  const productAttrs = (json(line.product.attributes) || []).filter((a) => a.variation);
  return productAttrs.map((pa) => {
    const own = attrs.find((a) => (pa.id && a.id ? Number(a.id) === Number(pa.id) : a.name.toLowerCase() === pa.name.toLowerCase()));
    const { key } = attributeKeyValue(own || { id: pa.id, name: pa.name, option: '' }, taxonomies);
    let value = own?.option || '';
    if (!value) value = line.variation?.[key] || '';
    const tax = pa.id ? taxonomies.get(Number(pa.id)) : null;
    const term = tax?.terms.find((t) => t.slug === value || decodeEntities(t.name) === decodeEntities(value));
    return { raw: key, label: tax ? tax.name : pa.name, value: term ? term.name : value, slug: term ? term.slug : value };
  });
}

const lineUrl = async (l) => {
  const pairs = await variationPairs(l);
  if (!pairs.length) return productUrl(l.product);
  return `${productUrl(l.product)}?${pairs.map((p) => `${p.raw}=${encodeURIComponent(p.slug).replace(/%20/g, '+')}`).join('&')}`;
};

// ---------------------------------------------------------------- theme mini cart (fragments)

function shippingRows(state) {
  if (!state.lines.length || !state.rates.length) return '';
  const items = state.rates.map((r) => {
    const id = `shipping_method_0_${r.id.replace(/[^a-z0-9]/gi, '')}`;
    const label = r.label || r.title;
    const price = Number(r.cost) > 0 ? `: ${P(r.cost)}` : '';
    return `\t\t\t\t\t\t\t\t\t\t\t\t\t<li>\r\n\t\t\t\t\t\t\t\t<input type="radio" name="shipping_method[0]" data-index="0" id="${id}" value="${r.id}" class="shipping_method"  ${state.selected?.id === r.id ? "checked='checked' " : ''}/><label for="${id}">${label}${price}</label>\t\t\t\t\t\t\t</li>\r\n`;
  }).join('');
  return `\t\t\t\t\t\t<tr>\r\n\t\t\t\t<th>Shipping</th>\r\n\t\t\t\t<td data-title="Shipping">\r\n\t\t\t\t\t<ul id="shipping_method" class="woocommerce-shipping-methods">\r\n${items}\t\t\t\t\t\t\t\t\t\t\t</ul>\r\n\t\t\t\t</td>\r\n\t\t\t</tr>\r\n\t\t\t\n`;
}

function totalsFragment(state) {
  const coupons = state.coupons.map((c) => `\t\t\t<tr class="cart-discount coupon-${esc(c.code)}">\n\t\t\t\t<th>Coupon: ${esc(c.code)}</th>\n\t\t\t\t<td data-title="Coupon: ${esc(c.code)}">-${P(c.discount)} <a href="#" class="woocommerce-remove-coupon" data-coupon="${esc(c.code)}">[Remove]</a></td>\n\t\t\t</tr>\n`).join('');
  const middle = state.lines.length
    ? `\t\t\t\t\n${coupons}\t\t\n\t\t\t\n${shippingRows(state)}\t\t\t\t\t\n\t\t\t\t\n\n\t\t\n`
    : `\t\t\t\t\n${coupons}\t\t\t\t\n\n\t\t\n`;
  return `<div class="pls-minicart-cart-totals">\n\t<table class="minicart_table has-pls-minicart-items">\n\n\t\t<tr class="cart-subtotal">\n\t\t\t<th>Subtotal</th>\n\t\t\t<td data-title="Subtotal">${P(state.subtotal)}</td>\n\t\t</tr>\n${middle}\t\t\t\t<tr class="order-total">\n\t\t\t<th>Total</th>\n\t\t\t<td data-title="Total"><strong>${P(state.total)}</strong> </td>\n\t\t</tr>\n\t\t\t</table>\n</div>\n`;
}

async function miniCartItem(l) {
  const name = l.product.name;
  const url = await lineUrl(l);
  const pairs = await variationPairs(l);
  const img = l.image ? imageTag(l.image, 'woocommerce_thumbnail', { mode: 'attachment' }).replace(' decoding="async"', '').replace(/ alt="[^"]*"/, ` alt="${esc(decodeEntities(name))}"`) : '';
  const id = uniqid();
  const max = l.stock.max != null ? `\t\t\t\t\t\t\tmax="${l.stock.max}"\n` : '';
  const variationDl = pairs.length
    ? `<dl class="variation">\n${pairs.map((p) => `\t\t\t<dt class="variation-${p.label.replace(/[^a-z0-9]/gi, '')}">${esc(p.label)}:</dt>\n\t\t<dd class="variation-${p.label.replace(/[^a-z0-9]/gi, '')}"><p>${esc(p.value)}</p>\n</dd>\n`).join('')}\t</dl>\n\t\t\t\t\t\t\t\t\t\t`
    : '\n\t\t\t\t\t\t\t\t\t\t';
  return `<li class="woocommerce-mini-cart-item mini_cart_item" data-cart_item_key="${l.key}" >\n\t\t\t\t\t\t\t\t\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<a class="mini_cart_item_image" href="${url}">\n\t\t\t\t\t\t\t\t\t\t${img}\t\t\t\t\t\t\t\t\t</a>\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<div class="mini-cart-item-content">\n\t\t\t\t\t\t\t\t\t<div class="pls-mini-cart-item-title">\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<a class="mini_cart_item_title" href="${url}">\n\t\t\t\t\t\t\t\t\t\t\t\t${esc(decodeEntities(name))}\t\t\t\t\t\t\t\t\t\t\t</a>\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<a role="button" href="/cart/?remove_item=${l.key}" class="remove remove_from_cart_button" aria-label="Remove ${esc(decodeEntities(name))} from cart" data-product_id="${l.product_id}" data-cart_item_key="${l.key}" data-product_sku="${esc(l.sku || '')}" data-success_message="&ldquo;${esc(decodeEntities(name))}&rdquo; has been removed from your cart">Remove</a>\t\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t\t\t<div class="pls-mini-cart-item-data">\n\t\t\t\t\t\t\t\t\t\t${variationDl}\n\t\t\t\t\t\t\t\t\t\t<div class="pls-mini-cart-item-quantity">\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<div class="mini-cart-item-quantity">\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\n\t<div class="pls-quantity-label">Quantity:</div>\n\t<div class="quantity">\n\t\t\t\t<label class="minus"></label>\r\n\t\t\r\n\t\t\t<label class="screen-reader-text" for="${id}">${esc(decodeEntities(name))} quantity</label>\n\t\t<input\n\t\t\ttype="number"\n\t\t\t\t\t\tid="${id}"\n\t\t\tclass="input-text qty text"\n\t\t\tname="quantity"\n\t\t\tvalue="${l.quantity}"\n\t\t\taria-label="Product quantity"\n\t\t\t\t\t\tmin="0"\n${max}\t\t\t\t\t\t\t\t\t\tstep="1"\n\t\t\t\tplaceholder=""\n\t\t\t\tinputmode="numeric"\n\t\t\t\tautocomplete="off"\n\t\t\t\t\t/>\n\t\t\t\t<label class="plus"></label>\r\n\t\t</div> \t\t\t\t\t\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t\t\t\t\t\t<span class="quantity">${l.quantity} &times; ${P(l.unit)}</span>\t\t\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t</li>\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t`;
}

const SHIPPING_CALC = `\n<div class="pls-minicart-action-block pls-minicart-shipping" data-block_name="shipping">\n    <div class="pls-minicart-block-title">Estimate Shipping Rates</div>\n    <div class="pls-minicart-block-content">\n       \n<form class="woocommerce-shipping-calculator" action="/cart/" method="post">\n\n\t<a href="#" class="shipping-calculator-button" aria-expanded="false" aria-controls="shipping-calculator-form" role="button">Calculate shipping</a>\n\t<section class="shipping-calculator-form" id="shipping-calculator-form" style="display:none;">\n\n\t\t\t\t\t<p class="form-row form-row-wide" id="calc_shipping_country_field">\n\t\t\t\t<label for="calc_shipping_country">Country / region</label>\n\t\t\t\t<select name="calc_shipping_country" id="calc_shipping_country" class="country_to_state country_select" rel="calc_shipping_state">\n\t\t\t\t\t<option value="default">Select a country / region&hellip;</option>\n\t\t\t\t\t<option value="LB" selected='selected'>Lebanon</option>\t\t\t\t</select>\n\t\t\t</p>\n\t\t\n\t\t\t\t\t<p class="form-row form-row-wide" id="calc_shipping_state_field">\n\t\t\t\t\t\t\t\t\t<input type="hidden" name="calc_shipping_state" id="calc_shipping_state" />\n\t\t\t\t\t\t\t\t</p>\n\t\t\n\t\t\t\t\t<p class="form-row form-row-wide" id="calc_shipping_city_field">\n\t\t\t\t<label for="calc_shipping_city">City:</label>\n\t\t\t\t<input type="text" class="input-text" value="" name="calc_shipping_city" id="calc_shipping_city" />\n\t\t\t</p>\n\t\t\n\t\t\t\t\t<p class="form-row form-row-wide" id="calc_shipping_postcode_field">\n\t\t\t\t<label for="calc_shipping_postcode">Postcode / ZIP:</label>\n\t\t\t\t<input type="text" class="input-text" value="" name="calc_shipping_postcode" id="calc_shipping_postcode" />\n\t\t\t</p>\n\t\t\n\t\t<p><button type="submit" name="calc_shipping" value="1" class="button">Update</button></p>\n\t\t<input type="hidden" id="woocommerce-shipping-calculator-nonce" name="woocommerce-shipping-calculator-nonce" value="" /><input type="hidden" name="_wp_http_referer" value="/?wc-ajax=get_refreshed_fragments" />\t</section>\n</form>\n\n\t    <div class="pls-minicart-form-actions">\n\t\t\t<button type="submit" class="button pls-update-shipping">Calculator</button>\n\t\t\t<a href="#" rel="nofollow" class="pls-block-close">Cancel</a>\n\t\t</div>\n    </div>\n</div>`;

export async function fragments(state) {
  let content;
  if (!state.lines.length) {
    content = `<div class="widget_shopping_cart_content">\n\t\n\t<div class="woocommerce-mini-cart-empty">\n\t\t<i class="cart-empty-icon"></i>\n\t\t<p class="woocommerce-mini-cart__empty-message">Your cart is empty.</p>\t\n\t\t\t<p class="woocommerce-empty-mini-cart__buttons">\r\n\t\t<a class="button" href="/">Start Shopping</a>\r\n\t</p>\r\n\t\t</div>\n\n\n</div>`;
  } else {
    const items = (await Promise.all(state.lines.map(miniCartItem))).join('');
    content = `<div class="widget_shopping_cart_content">\n\t\t<div class="widget_shopping_cart_body pls-scroll">\n\t\t<div class="pls-scroll-content">\n\t\t\t<ul class="woocommerce-mini-cart cart_list product_list_widget ">\n\t\t\t\t\t\t\t\t\t\t\t${items}\t\t\t\t\t\t\t\t\t\t</ul>\n\t\t</div>\n\t</div>\n\t\n\t<div class="widget_shopping_cart_footer">\n\t\n\t\t<p class="woocommerce-mini-cart__total total">\n\t\t\t\t\t</p>\n\n\t\t\t\t<div class="pls-minicart-action-btns">\t\t\t\r\n\t\t\t                 <a href="#" class="pls-minicart-action-btn pls-minicart-note-btn" data-action_name="note">\r\n\t\t\t\t\t<span>Note</span>\r\n                </a>\r\n\t\t\t \t\t\t                 <a href="#" class="pls-minicart-action-btn pls-minicart-shipping-btn" data-action_name="shipping">\r\n\t\t\t\t\t<span>Shipping</span>\r\n                </a>\r\n\t\t\t \t\t\t                  <a href="#" class="pls-minicart-action-btn pls-minicart-coupon-btn" data-action_name="coupon">\r\n\t\t\t\t\t<span>Coupon</span>\r\n                </a>\r\n\t\t\t \t\t</div>\r\n\t\t${totalsFragment(state)}\n\t\t<p class="woocommerce-mini-cart__buttons buttons"><a href="/cart/" class="button wc-forward">View cart</a><a href="/checkout/" class="button checkout wc-forward">Checkout</a></p>\n\n\t\t\t\t\n\t</div>\n\n\n</div>`;
  }
  const n = state.count;
  return {
    fragments: {
      'div.widget_shopping_cart_content': content,
      'span.pls-header-cart-count': `<span class="pls-header-cart-count${n ? '' : ' pls-hidden'}">${n}</span>`,
      'span.pls-header-cart-total': `<span class="pls-header-cart-total">${n}</span>`,
      'span.pls-header-cart-item-text': `<span class="pls-header-cart-item-text">${n} item${n === 1 ? '' : 's'}</span>`,
      '.pls-minicart-cross-sells': '<div class="pls-minicart-cross-sells"></div>\n',
      '.pls-minicart-cart-totals': totalsFragment(state),
      '.pls-minicart-shipping': SHIPPING_CALC,
    },
    cart_hash: n ? md5(JSON.stringify(state.cart.items)) : '',
  };
}

// ---------------------------------------------------------------- Store API format (cart & checkout blocks)

const imagesFor = (m, siteUrl) => {
  if (!m) return [];
  const full = { file: m.url.split('/').pop(), width: m.width, height: m.height };
  const thumb = (m.sizes || []).find((s) => s.name === 'woocommerce_thumbnail') || full;
  const dir = m.url.slice(0, m.url.lastIndexOf('/') + 1);
  const abs = (u) => u.replace(/^\/wp-content/, `${siteUrl}/wp-content`).replace(/, \/wp-content/g, `, ${siteUrl}/wp-content`);
  return [{
    id: m.id, src: siteUrl + m.url, thumbnail: siteUrl + dir + thumb.file,
    srcset: abs(srcset(m, full)), sizes: `(max-width: ${m.width}px) 100vw, ${m.width}px`,
    thumbnail_srcset: abs(srcset(m, thumb)), thumbnail_sizes: `(max-width: ${thumb.width}px) 100vw, ${thumb.width}px`,
    name: m.title || m.url.split('/').pop(), alt: m.alt || '',
  }];
};

export async function storeCart(state, siteUrl) {
  const items = [];
  for (const l of state.lines) {
    const pairs = await variationPairs(l);
    const raw = (n) => String(Math.round(n * 1e6));
    items.push({
      key: l.key, id: l.variation_id || l.product_id, type: l.variation_id ? 'variation' : 'simple', quantity: l.quantity,
      quantity_limits: { minimum: 1, maximum: l.stock.max != null ? l.stock.max : 9999, multiple_of: 1, editable: true },
      name: decodeEntities(l.product.name).replace(/&/g, '&amp;'), short_description: '', description: '', sku: l.sku || '',
      low_stock_remaining: l.stock.managed && l.stock.max != null && l.stock.max <= 2 ? l.stock.max : null,
      backorders_allowed: false, show_backorder_badge: false, sold_individually: false,
      permalink: siteUrl + (await lineUrl(l)), images: imagesFor(l.image, siteUrl),
      variation: pairs.map((p) => ({ raw_attribute: p.raw, attribute: p.label, value: p.value })), item_data: [],
      prices: { price: cents(l.unit), regular_price: cents(l.regular), sale_price: cents(l.unit), price_range: null, ...CURRENCY, raw_prices: { precision: 6, price: raw(l.unit), regular_price: raw(l.regular), sale_price: raw(l.unit) } },
      totals: { line_subtotal: cents(l.subtotal), line_subtotal_tax: '0', line_total: cents(l.subtotal - (state.subtotal ? state.discount * (l.subtotal / state.subtotal) : 0)), line_total_tax: '0', ...CURRENCY },
      catalog_visibility: 'visible', extensions: {},
    });
  }
  const c = state.cart;
  const addr = { first_name: '', last_name: '', company: '', address_1: '', address_2: '', city: '', state: '', postcode: '', country: 'LB', phone: '', ...(c.customer.shipping_address || {}) };
  const bill = { first_name: '', last_name: '', company: '', address_1: '', address_2: '', city: '', state: '', postcode: '', country: 'LB', email: '', phone: '', ...(c.customer.billing_address || {}) };
  const itemsMeta = state.lines.map((l) => `${esc(decodeEntities(l.product.name))} &times; ${l.quantity}`).join(', ');
  return {
    items,
    coupons: state.coupons.map((cp) => ({ code: cp.code, discount_type: cp.type, totals: { total_discount: cents(cp.discount), total_discount_tax: '0', ...CURRENCY } })),
    fees: [],
    totals: { total_items: cents(state.subtotal), total_items_tax: '0', total_fees: '0', total_fees_tax: '0', total_discount: cents(state.discount), total_discount_tax: '0', total_shipping: cents(state.shippingTotal), total_shipping_tax: '0', total_price: cents(state.total), total_tax: '0', tax_lines: [], ...CURRENCY },
    shipping_address: addr, billing_address: bill,
    needs_payment: state.lines.length > 0, needs_shipping: state.lines.length > 0, payment_requirements: ['products'],
    has_calculated_shipping: true,
    shipping_rates: state.lines.length ? [{
      package_id: 0, name: 'Shipment',
      destination: { address_1: addr.address_1, address_2: addr.address_2, city: addr.city, state: addr.state, postcode: addr.postcode, country: addr.country },
      items: state.lines.map((l) => ({ key: l.key, name: decodeEntities(l.product.name).replace(/&/g, '&amp;'), quantity: l.quantity })),
      shipping_rates: state.rates.map((r) => {
        const [method_id, instance] = r.id.split(':');
        const meta = r.pickup
          ? [{ key: 'pickup_location', value: r.pickup.name }, { key: 'pickup_address', value: r.pickup.address }, { key: 'pickup_details', value: r.pickup.details || '' }, { key: 'Items', value: itemsMeta }]
          : [{ key: 'Items', value: itemsMeta }];
        return { rate_id: r.id, name: r.title, description: '', delivery_time: '', price: cents(r.cost), taxes: '0', instance_id: Number(instance), method_id, meta_data: meta, selected: state.selected?.id === r.id, ...CURRENCY };
      }),
    }] : [],
    items_count: state.count, items_weight: 0, cross_sells: [], errors: [], payment_methods: state.lines.length ? ['cod'] : [], extensions: {},
  };
}

export { cents };
