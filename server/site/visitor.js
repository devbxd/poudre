// Per-visitor header state (cart counter, mini cart, wishlist counter), rendered server-side like WordPress.
import { getCookie } from 'hono/cookie';
import { query } from '../db.js';
import { loadCart, computeCart, fragments } from './cart.js';

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const EMPTY_MINI = `<div class="widget_shopping_cart_content">\n\t\n\t<div class="woocommerce-mini-cart-empty">\n\t\t<i class="cart-empty-icon"></i>\n\t\t<p class="woocommerce-mini-cart__empty-message">Your cart is empty.</p>\t\n\t\t\t<p class="woocommerce-empty-mini-cart__buttons">\r\n\t\t<a class="button" href="/">Start Shopping</a>\r\n\t</p>\r\n\t\t</div>\n\n\n</div>`;

export async function wishlistIds(c) {
  const id = getCookie(c, 'poudre_session');
  if (!id) return {};
  const [row] = await query('select items from wishlists where id = $1', [id]);
  return json(row?.items) || {};
}

export async function visitorVars(c) {
  const vars = { cart_count: '<span class="pls-header-cart-count pls-hidden">0</span>', mini_cart: EMPTY_MINI, wishlist_count: '<span class="pls-header-wishlist-count" data-count="0">0</span>' };
  if (!c || !getCookie(c, 'poudre_session')) return vars;
  const cart = await loadCart(c);
  if (cart.items.length) {
    const state = await computeCart(cart);
    const f = await fragments(state);
    vars.cart_count = f.fragments['span.pls-header-cart-count'];
    vars.mini_cart = f.fragments['div.widget_shopping_cart_content'];
    vars.cartState = state;
  }
  const wl = Object.keys(await wishlistIds(c)).length;
  vars.wishlist_count = `<span class="pls-header-wishlist-count" data-count="${wl}">${wl}</span>`;
  return vars;
}
