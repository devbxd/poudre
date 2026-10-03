// Product card ("loop item") exactly as rendered by the Anvogue theme (product-style-5).
import { esc, escName, wcPrice } from './html.js';
import { imageTag, imageUrl } from './images.js';

/** wptexturize for product titles: straight/curly apostrophes become &#8217; */
// wptexturize(): only straight characters are converted, existing typographic ones stay as they are
export const texturize = (s) => {
  let t = String(s ?? '')
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '\u0008')
    .replace(/(^|\s|\()'/g, '$1\u0009')
    .replace(/'/g, '\u0001')
    .replace(/ -- /g, ' \u0003 ').replace(/ - /g, ' \u0002 ')
    .replace(/\.\.\./g, '\u0004')
    .replace(/\b(\d[\d.,]*)x(\d[\d.,]*)\b/g, '$1\u0005$2')
    .replace(/(^|\s|\()"/g, '$1\u0006').replace(/"/g, '\u0007');
  t = esc(t).replace(/\u0008/g, '&#038;');
  return t.replace(/\u0009/g, '&#8216;').replace(/\u0001/g, '&#8217;').replace(/\u0002/g, '&#8211;').replace(/\u0003/g, '&#8212;').replace(/\u0004/g, '&#8230;')
    .replace(/\u0005/g, '&#215;').replace(/\u0006/g, '&#8220;').replace(/\u0007/g, '&#8221;');
};

export const productUrl = (p) => `/product/${p.slug}/`;

/** Active price data for a product row prepared by the data layer. */
export function priceHtml(p) {
  if (p.type === 'variable') {
    const { min, max, regMin, regMax } = p.range || {};
    if (min == null) return '<span class="price"></span>';
    if (min !== max) {
      return `<span class="price"><span class="woocommerce-Price-amount amount" aria-hidden="true"><span class="woocommerce-Price-currencySymbol">&#036;</span>${fmt(min)}</span> <span aria-hidden="true">&ndash;</span> <span class="woocommerce-Price-amount amount" aria-hidden="true"><span class="woocommerce-Price-currencySymbol">&#036;</span>${fmt(max)}</span><span class="screen-reader-text">Price range: &#036;${fmt(min)} through &#036;${fmt(max)}</span></span>`;
    }
    if (regMin === regMax && regMax > min) return `<span class="price"><ins>${wcPrice(min)}</ins> <del aria-hidden="true">${wcPrice(regMax)}</del></span>`;
    return `<span class="price">${wcPrice(min)}</span>`;
  }
  if (p.price == null) return '<span class="price"></span>';
  if (p.on_sale) return `<span class="price"><ins>${wcPrice(p.price)}</ins> <del aria-hidden="true">${wcPrice(p.regular)}</del></span>`;
  return `<span class="price">${wcPrice(p.price)}</span>`;
}
const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// the theme drops the whole price block when the product has no price at all
export const hasPrice = (p) => (p.type === 'variable' ? p.range?.min != null : p.price != null);

export function salePercent(p) {
  if (p.type === 'variable') return p.range?.percent || 0;
  if (!p.on_sale || !p.regular) return 0;
  return Math.round(((p.regular - p.price) / p.regular) * 100);
}

export function productClasses(p, extra = []) {
  const c = ['product', 'type-product', `post-${p.id}`, `status-${p.status}`, ...extra, p.stock_status];
  for (const s of p.category_slugs || []) c.push(`product_cat-${s}`);
  for (const s of p.tag_slugs || []) c.push(`product_tag-${s}`);
  if (p.image) c.push('has-post-thumbnail');
  if (p.featured) c.push('featured');
  if (p.on_sale || p.range?.on_sale) c.push('sale');
  c.push('shipping-taxable');
  if (p.purchasable) c.push('purchasable');
  c.push(`product-type-${p.type === 'variable' ? 'variable' : 'simple'}`);
  return c.join(' ');
}

// the theme links simple products to the current page URL + add-to-cart
const addToCartHref = (current, id) => `${current.replace(/&/g, '&#038;')}${current.includes('?') ? '&#038;' : '?'}add-to-cart=${id}`;

function cartButton(p, { currentUrl = '/shop/' } = {}) {
  const attrName = esc(p.name);
  if (p.type === 'variable' && !p.purchasable) {
    return `<a href="${productUrl(p)}" aria-describedby="woocommerce_loop_add_to_cart_link_describedby_${p.id}" data-quantity="1" class="button product_type_variable" data-product_id="${p.id}" data-product_sku="${esc(p.sku || '')}" aria-label="Select options for &ldquo;${attrName}&rdquo;" rel="">Read more</a>`;
  }
  if (p.type === 'variable') {
    return `<a href="${productUrl(p)}" aria-describedby="woocommerce_loop_add_to_cart_link_describedby_${p.id}" data-quantity="1" class="button product_type_variable add_to_cart_button" data-product_id="${p.id}" data-product_sku="${esc(p.sku || '')}" aria-label="Select options for &ldquo;${attrName}&rdquo;" rel="">Quick Shop</a>`;
  }
  if (!p.purchasable || p.stock_status === 'outofstock') {
    return `<a href="${productUrl(p)}" aria-describedby="woocommerce_loop_add_to_cart_link_describedby_${p.id}" data-quantity="1" class="button product_type_simple" data-product_id="${p.id}" data-product_sku="${esc(p.sku || '')}" aria-label="Read more about &ldquo;${attrName}&rdquo;" rel="nofollow" data-success_message="">Read more</a>`;
  }
  return `<a href="${addToCartHref(currentUrl, p.id)}" aria-describedby="woocommerce_loop_add_to_cart_link_describedby_${p.id}" data-quantity="1" class="button product_type_simple add_to_cart_button ajax_add_to_cart" data-product_id="${p.id}" data-product_sku="${esc(p.sku || '')}" aria-label="Add to cart: &ldquo;${attrName}&rdquo;" rel="nofollow" data-success_message="&ldquo;${attrName}&rdquo; has been added to your cart" role="button">Add to cart</a>`;
}

/**
 * opts.position: index in the loop (for first/last), opts.columns: loop columns,
 * opts.images: shared lazy-loading counter { count } like WordPress' content image counter.
 */
export function productCard(p, { position = 0, columns = 3, images, currentUrl } = {}) {
  const extra = [];
  if (columns > 0 && position % columns === 0) extra.push('first');
  else if (columns > 0 && position % columns === columns - 1) extra.push('last');
  const url = productUrl(p);
  const front = p.image
    ? imageTag(p.image, 'woocommerce_thumbnail', { className: 'front-image', counter: images })
    : `<img decoding="async" width="500" src="/wp-content/themes/anvogue/assets/images/transparent.png" class="attachment-woocommerce_thumbnail size-woocommerce_thumbnail front-image" alt="Place holder" />`;
  const hover = p.hover_image ? imageTag(p.hover_image, 'woocommerce_thumbnail', { className: 'hover-image', counter: images, hover: true }) : '';
  const percent = salePercent(p);
  const labels = (p.on_sale || p.range?.on_sale) ? '<div class="pls-product-labels"><span class="on-sale">Sale</span></div>' : '';
  const thumb = p.image ? imageUrl(p.image, 'woocommerce_gallery_thumbnail') : '';
  return `<div class="${productClasses(p, extra)}">\t \n\t\n<div class="pls-product-inner">\n\t\t\n\t<div class="pls-product-image">\n\t\t${labels}<a href="${url}" class="woocommerce-LoopProduct-link" target="_self">${front}${hover}</a>\t\t\t\t\t\t<div class="pls-product-icons">\n\t\t\t\t\t\r\n\t\t<div class="pls-whishlist-btn">\r\n\t\t\t<a href="?add-to-wishlist=${p.id}" class="woosw-btn woosw-btn-${p.id}" data-id="${p.id}" data-product_name="${escName(p.name)}" data-product_image="${thumb}" rel="nofollow" aria-label="Add to wishlist">Add to wishlist</a>\t\t</div>\t\t\r\n\t\t\t</div>\n\t</div>\n\t<div class="pls-product-info">\n\t\t<h3 class="product-title"><a href="${url}" target="_self">${texturize(p.name)}</a></h3>${hasPrice(p) ? `\n\t<div class="pls-product-price">\n\t\t${priceHtml(p)}\n\t\t${percent ? `<span class="on-sale">-${percent}% </span>\t</div>` : '\t</div>'}` : ''}\n\t\t\n\t\t\n\t\t\t\t${p.swatches || ''}<div class="pls-product-actions">\n\t\t\t\t\t\r\n\t\t<div class="pls-cart-button">\r\n\t\t\t${cartButton(p, { currentUrl })}\t\t </div>\r\n\t\t\t\t</div>\n\t</div>\n</div>\t \n</div>\n\n`;
}
