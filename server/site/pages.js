// Remaining website pages: cart, checkout, order received, wishlist, account, static pages, blog, 404.
import { templateFile } from './files.js';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { query, one } from '../db.js';
import { esc, wcPrice, decodeEntities } from './html.js';
import { renderPage } from './layout.js';
import { storeCartData, wishlistPageContent } from './shop-api.js';
import { loadCart } from './cart.js';
import { currentCustomer, loginCustomer, logoutCustomer } from '../auth.js';

const tplCache = new Map();
const main = async (name) => {
  if (!tplCache.has(name)) tplCache.set(name, await readFile(templateFile(`${name}.main.html`), 'utf8'));
  return tplCache.get(name);
};
let meta;
const pageMeta = async (name) => (meta ??= JSON.parse(await readFile(templateFile('pages.json'), 'utf8')))[name];

/** Static page from the original site (title tag kept as on WordPress) */
async function staticPage(c, name, { mainHtml, menuCtx = null, status = 200, preload } = {}) {
  const m = await pageMeta(name);
  const html = await renderPage({
    c, template: name, title: '', main: mainHtml ?? await main(name), path: new URL(c.req.url).pathname,
    bodyClass: m.bodyClass, headerClass: m.headerClass, menuCtx,
    vars: preload ? { preload } : {},
  });
  return c.html(html.replace(/<title>[\s\S]*?<\/title>/, `<title>${m.title}</title>`), status);
}

const preloadFor = async (c) => {
  const body = await storeCartData(c);
  const cart = await loadCart(c);
  // rawurlencode() like PHP: the quote must be encoded too, the data sits in a single-quoted JS string
  return encodeURIComponent(JSON.stringify({ '/wc/store/v1/cart': { body, headers: { Nonce: 'poudre', 'Nonce-Timestamp': Math.floor(Date.now() / 1000), 'User-ID': 0, 'Cart-Token': cart.id, 'Cart-Hash': '', 'Cache-Control': 'no-store' } } })).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
};

export function registerPages(site) {
  for (const [path, name, objectId] of [['/about-us/', 'page', 38], ['/contact-us/', 'contact', 39], ['/terms-conditions/', 'terms', 42], ['/store-list/', 'stores', 40], ['/order-tracking/', 'tracking', 1598], ['/blog/', 'blog', 729]]) {
    site.get(path, (c) => staticPage(c, name, { menuCtx: { objectType: 'page', objectId } }));
  }

  // Cart & checkout (WooCommerce blocks render client-side from the preloaded Store API cart)
  site.get('/cart/', async (c) => {
    const cart = await loadCart(c);
    const preload = await preloadFor(c);
    return staticPage(c, cart.items.length ? 'cart' : 'cart_empty', { preload, menuCtx: { objectType: 'page', objectId: 1680 } });
  });
  site.get('/checkout/', async (c) => {
    const cart = await loadCart(c);
    if (!cart.items.length) return c.redirect('/cart/');
    return staticPage(c, 'checkout', { preload: await preloadFor(c), menuCtx: { objectType: 'page', objectId: 1681 } });
  });
  site.get('/checkout/order-received/:id/', async (c) => {
    const order = await one('select * from orders where id = $1', [Number(c.req.param('id'))]);
    const meta2 = order && (typeof order.meta === 'string' ? JSON.parse(order.meta) : order.meta);
    if (!order || meta2?.order_key !== c.req.query('key')) return notFound(c);
    const items = await query('select * from order_items where order_id = $1 order by id', [order.id]);
    const date = new Date(order.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const rows = items.map((i) => `\t\t\t<tr class="woocommerce-table__line-item order_item">\n\t\t\t\t<td class="woocommerce-table__product-name product-name">${esc(i.name)} <strong class="product-quantity">&times;&nbsp;${i.quantity}</strong></td>\n\t\t\t\t<td class="woocommerce-table__product-total product-total">${wcPrice(i.subtotal)}</td>\n\t\t\t</tr>\n`).join('');
    const b = typeof order.billing === 'string' ? JSON.parse(order.billing) : order.billing;
    const body = `<div class="woocommerce">\n<div class="woocommerce-order">\n\t<p class="woocommerce-notice woocommerce-notice--success woocommerce-thankyou-order-received">Thank you. Your order has been received.</p>\n\t<ul class="woocommerce-order-overview woocommerce-thankyou-order-details order_details">\n\t\t<li class="woocommerce-order-overview__order order">Order number: <strong>${order.number}</strong></li>\n\t\t<li class="woocommerce-order-overview__date date">Date: <strong>${date}</strong></li>\n\t\t${b.email ? `<li class="woocommerce-order-overview__email email">Email: <strong>${esc(b.email)}</strong></li>` : ''}\n\t\t<li class="woocommerce-order-overview__total total">Total: <strong>${wcPrice(order.total)}</strong></li>\n\t\t<li class="woocommerce-order-overview__payment-method method">Payment method: <strong>${esc(order.payment_title || '')}</strong></li>\n\t</ul>\n\t<p>Pay with cash upon delivery or Via Whish Account to 71 493 066</p>\n\t<section class="woocommerce-order-details">\n\t\t<h2 class="woocommerce-order-details__title">Order details</h2>\n\t\t<table class="woocommerce-table woocommerce-table--order-details shop_table order_details">\n\t\t\t<thead><tr><th class="woocommerce-table__product-name product-name">Product</th><th class="woocommerce-table__product-table product-total">Total</th></tr></thead>\n\t\t\t<tbody>\n${rows}\t\t\t</tbody>\n\t\t\t<tfoot>\n\t\t\t\t<tr><th scope="row">Subtotal:</th><td>${wcPrice(order.subtotal)}</td></tr>\n${Number(order.discount_total) ? `\t\t\t\t<tr><th scope="row">Discount:</th><td>-${wcPrice(order.discount_total)}</td></tr>\n` : ''}\t\t\t\t<tr><th scope="row">Shipping:</th><td>${Number(order.shipping_total) ? wcPrice(order.shipping_total) : ''}&nbsp;<small class="shipped_via">via ${esc(order.shipping_method || '')}</small></td></tr>\n\t\t\t\t<tr><th scope="row">Payment method:</th><td>${esc(order.payment_title || '')}</td></tr>\n\t\t\t\t<tr><th scope="row">Total:</th><td>${wcPrice(order.total)}</td></tr>\n\t\t\t</tfoot>\n\t\t</table>\n\t</section>\n</div>\n</div>`;
    const tpl = (await main('tracking')).replace(/<h1 class="title">\s*Order Tracking\t<\/h1>/, '<h1 class="title">\n\t\tOrder received\t</h1>')
      .replace('<span class="last">Order Tracking</span>', '<span class="last">Order received</span>');
    const s = tpl.indexOf('<div class="entry-content">');
    const e = tpl.indexOf('</div><!-- .entry-content -->');
    return staticPage(c, 'tracking', { mainHtml: `${tpl.slice(0, s)}<div class="entry-content">\n${body}\n\t${tpl.slice(e)}` });
  });

  // Wishlist
  site.get('/wishlist/', async (c) => {
    const tpl = await main('wishlist');
    const s = tpl.indexOf('<div class="woosw-list"');
    const e = tpl.indexOf('</div>\n</div><!-- .entry-content -->');
    const html = s > 0 && e > 0 ? `${tpl.slice(0, s)}${await wishlistPageContent(c)}${tpl.slice(e + 6)}` : tpl;
    return staticPage(c, 'wishlist', { mainHtml: html, menuCtx: { objectType: 'page', objectId: 1876 } });
  });

  // My account: login / register / orders
  site.get('/my-account/', async (c) => accountPage(c));
  site.post('/my-account/', async (c) => {
    const b = await c.req.parseBody();
    if (b.login !== undefined || (b.username && b.password && !b.email)) {
      const cust = await one('select id, password_hash from customers where lower(email) = lower($1)', [String(b.username || '').trim()]);
      if (!cust?.password_hash || !bcrypt.compareSync(String(b.password || ''), cust.password_hash)) return accountPage(c, { error: '<strong>Error:</strong> The username or password you entered is incorrect.' });
      await loginCustomer(c, cust.id);
      return c.redirect('/my-account/');
    }
    if (b.register !== undefined || b.email) {
      const email = String(b.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return accountPage(c, { error: '<strong>Error:</strong> Please provide a valid email address.' });
      if (String(b.password || '').length < 6) return accountPage(c, { error: '<strong>Error:</strong> Please enter an account password.' });
      const existing = await one('select id, password_hash from customers where lower(email) = $1', [email]);
      if (existing?.password_hash) return accountPage(c, { error: '<strong>Error:</strong> An account is already registered with your email address. <a href="#" class="showlogin">Please log in.</a>' });
      const hash = bcrypt.hashSync(String(b.password), 10);
      const id = existing ? (await one('update customers set password_hash = $2 where id = $1 returning id', [existing.id, hash])).id
        : (await one('insert into customers (email, password_hash, billing, shipping) values ($1, $2, $3, $3) returning id', [email, hash, JSON.stringify({ email })])).id;
      await loginCustomer(c, id);
      return c.redirect('/my-account/');
    }
    return c.redirect('/my-account/');
  });
  site.get('/my-account/customer-logout/', (c) => { logoutCustomer(c); return c.redirect('/my-account/'); });
}

async function accountPage(c, { error } = {}) {
  const customer = await currentCustomer(c);
  let tpl = await main('account');
  if (error) tpl = tpl.replace('<div class="woocommerce-notices-wrapper"></div>', `<div class="woocommerce-notices-wrapper"><ul class="woocommerce-error" role="alert">\n\t\t\t<li>\n\t\t\t${error}\t\t</li>\n\t</ul>\n</div>`);
  if (customer) {
    const orders = await query('select id, number, status, total, created_at from orders where customer_id = $1 order by created_at desc', [customer.id]);
    const rows = orders.map((o) => `<tr class="woocommerce-orders-table__row woocommerce-orders-table__row--status-${o.status} order"><td class="woocommerce-orders-table__cell" data-title="Order">#${o.number}</td><td class="woocommerce-orders-table__cell" data-title="Date"><time datetime="${new Date(o.created_at).toISOString()}">${new Date(o.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</time></td><td class="woocommerce-orders-table__cell" data-title="Status">${esc(o.status.charAt(0).toUpperCase() + o.status.slice(1))}</td><td class="woocommerce-orders-table__cell" data-title="Total">${wcPrice(o.total)}</td></tr>`).join('');
    const name = esc([customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.email);
    const body = `<div class="woocommerce"><div class="woocommerce-notices-wrapper"></div><nav class="woocommerce-MyAccount-navigation" aria-label="Account pages"><ul><li class="woocommerce-MyAccount-navigation-link woocommerce-MyAccount-navigation-link--dashboard is-active"><a href="/my-account/" aria-current="page">Dashboard</a></li><li class="woocommerce-MyAccount-navigation-link woocommerce-MyAccount-navigation-link--customer-logout"><a href="/my-account/customer-logout/">Log out</a></li></ul></nav><div class="woocommerce-MyAccount-content"><div class="woocommerce-notices-wrapper"></div><p>Hello <strong>${name}</strong> (not <strong>${name}</strong>? <a href="/my-account/customer-logout/">Log out</a>)</p><h3>Orders</h3>${orders.length ? `<table class="woocommerce-orders-table woocommerce-MyAccount-orders shop_table shop_table_responsive my_account_orders account-orders-table"><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="woocommerce-message woocommerce-message--info woocommerce-Message woocommerce-Message--info woocommerce-info">No order has been made yet.</div>'}</div></div>`;
    const s = tpl.indexOf('<div class="woocommerce">');
    const e = tpl.indexOf('</div><!-- .entry-content -->');
    tpl = `${tpl.slice(0, s)}${body}\n\t${tpl.slice(e)}`;
  }
  return staticPage(c, 'account', { mainHtml: tpl, menuCtx: { objectType: 'page', objectId: 1682 } });
}

export async function notFound(c) {
  return staticPage(c, 'notfound', { status: 404 });
}

export { decodeEntities };
