// Single product page, rendered with the exact markup of WooCommerce + Anvogue.
import { readFile } from 'node:fs/promises';
import { query } from '../db.js';
import { esc, escName, fill, wcPrice } from './html.js';
import { categories, productsByIds, mediaByIds } from './data.js';
import { productCard, productClasses, productUrl, texturize, salePercent } from './product-card.js';
import { imageTag, imageUrl, srcset } from './images.js';
import { attributeTaxonomies, attributeKeyValue, phpJson, escJsonAttr, sanitizeTitle } from './variations.js';
import { categoryPath, categoryUrl } from './catalog.js';
import { decodeEntities, phpUrlencode } from './html.js';

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
let tpl;
const template = async () => {
  reviewsEmptyTpl ??= await readFile(new URL('../../site/templates/reviews_empty.html', import.meta.url), 'utf8');
  return (tpl ??= await readFile(new URL('../../site/templates/product.main.tpl.html', import.meta.url), 'utf8'));
};
const uniqid = () => `quantity_${Date.now().toString(16).slice(-8)}${Math.floor(Math.random() * 0xfffff).toString(16).padStart(5, '0')}`;
const SITE_URL = () => process.env.SITE_URL || 'https://poudrebeauty.com';
// share links use the displayed (texturized) title, encoded like PHP urlencode()
const plusEncode = (s) => phpUrlencode(decodeEntities(texturize(s)));

/** WooCommerce breadcrumb category: the deepest term (orderby parent DESC) and its ancestors */
async function mainCategory(productId) {
  const cats = await categories();
  const rows = await query('select category_id from product_categories where product_id = $1', [productId]);
  const mine = rows.map((r) => cats.find((c) => c.id === r.category_id)).filter(Boolean).sort((a, b) => (b.parent_id || 0) - (a.parent_id || 0) || a.id - b.id);
  return { cats, main: mine[0] || null, mine };
}

function productNav(prev, next) {
  return `<div class="pls-product-navigation">\r\n${prev ? `\t\t\t\t\t\t\t<div class="pls-product-nav-btn pls-product-nav-prev">\r\n\t\t\t\t\t<a href="${productUrl(prev)}">\r\n\t\t\t\t\t\tPrevious Product\t\t\t\t\t</a>\r\n\t\t\t\t</div>\r\n` : ''}\t\t\t\t\t\t\r\n${next ? `\t\t\t\t\t\t\t<div class="pls-product-nav-btn pls-product-nav-next">\t\t\t\t\r\n\t\t\t\t\t<a href="${productUrl(next)}">\r\n\t\t\t\t\t\tNext Product\t\t\t\t\t</a>\r\n\t\t\t\t</div>\r\n` : ''}\t\t\t\t\t</div>`;
}

/** Previous / next product by publication date (WordPress adjacent posts) */
async function adjacent(p) {
  const [prev] = await query(`select id, slug from products where status = 'publish' and (created_at, id) < ($1, $2) order by created_at desc, id desc limit 1`, [p.created_at, p.id]);
  const [next] = await query(`select id, slug from products where status = 'publish' and (created_at, id) > ($1, $2) order by created_at asc, id asc limit 1`, [p.created_at, p.id]);
  return { prev, next };
}

function galleryImage(m, i, productName) {
  const single = (m.sizes || []).find((s) => s.name === 'woocommerce_single') || { file: m.url.split('/').pop(), width: m.width, height: m.height };
  const dir = m.url.slice(0, m.url.lastIndexOf('/') + 1);
  const thumb = imageUrl(m, 'woocommerce_gallery_thumbnail');
  const gal = (m.sizes || []).find((s) => s.name === 'woocommerce_gallery_thumbnail') || { width: m.width, height: m.height, file: m.url.split('/').pop() };
  const alt = i === 0 ? (m.alt || productName) : (m.alt || '');
  const set = srcset(m, single);
  const thumbSet = srcset(m, gal);
  const loading = i === 0 ? 'fetchpriority="high" ' : i < 3 ? '' : 'loading="lazy" ';
  const title = i > 0 && m.title ? ` title="${esc(m.title)}"` : '';
  const dataThumb = i === 0
    ? `data-thumb="${thumb}" data-thumb-alt="${esc(alt)}" data-thumb-srcset="${thumbSet}"  data-thumb-sizes="(max-width: ${gal.width}px) 100vw, ${gal.width}px"`
    : `data-thumb="${thumb}" data-thumb-alt="${esc(alt)}"`;
  return `<div ${dataThumb} class="woocommerce-product-gallery__image"><img ${loading}width="${single.width}" height="${single.height}" src="${dir}${single.file}" class="wp-post-image" alt="${esc(alt)}"${title} data-caption="${esc(m.caption || '')}" data-src="${m.url}" data-large_image="${m.url}" data-large_image_width="${m.width}" data-large_image_height="${m.height}" decoding="async"${set ? ` srcset="${set}" sizes="(max-width: ${single.width}px) 100vw, ${single.width}px"` : ''} /></div>`;
}

function galleryThumb(m) {
  const gal = (m.sizes || []).find((s) => s.name === 'woocommerce_gallery_thumbnail') || { width: m.width, height: m.height, file: m.url.split('/').pop() };
  const dir = m.url.slice(0, m.url.lastIndexOf('/') + 1);
  const set = srcset(m, gal);
  return `<div class="pls-product-thumb-image"><img loading="lazy" width="${gal.width}" height="${gal.height}" src="${dir}${gal.file}" class="attachment-150x150 size-150x150" alt="" decoding="async"${set ? ` srcset="${set}" sizes="(max-width: ${gal.width}px) 100vw, ${gal.width}px"` : ''} /></div>`;
}

function gallery(images, productName) {
  if (!images.length) {
    return `<div class="woocommerce-product-gallery pls-product-gallery-with-thumbnails  images" data-columns="4" style="opacity: 0; transition: opacity .25s ease-in-out;">\n\t<div class="woocommerce-product-gallery__wrapper">\n\t\n\t\t\t\t\n\t\t<div class="pls-single-product-gallery pls-product-slider" data-slider_options='{&quot;slidesPerView&quot;:1,&quot;spaceBetween&quot;:16,&quot;loop&quot;:false,&quot;navigation&quot;:false,&quot;thumbs&quot;:true}'>\n\t\t\t<div class="woocommerce-product-gallery__image--placeholder"><img src="/wp-content/uploads/woocommerce-placeholder-800x800.png" alt="Awaiting product image" class="wp-post-image" /></div>\t\t</div>\n\t\t\n\t\t<div class="pls-product-gallery-btns">\n\t\t\t\t\t</div>\n\t\t\n\t</div>\n\t\n\t</div>`;
  }
  if (images.length === 1) {
    return `<div class="woocommerce-product-gallery pls-product-gallery-without-thumbnails  images" data-columns="4" style="opacity: 0; transition: opacity .25s ease-in-out;">\n\t<div class="woocommerce-product-gallery__wrapper">\n\t\n\t\t\t\t\n\t\t<div class="pls-single-product-gallery" >\n\t\t\t${galleryImage(images[0], 0, productName)}\t\t</div>\n\t\t\n\t\t<div class="pls-product-gallery-btns">\n\t\t\t\t\t</div>\n\t\t\n\t</div>\n\t\n\t\t\n</div>`;
  }
  return `<div class="woocommerce-product-gallery pls-product-gallery-with-thumbnails  images" data-columns="4" style="opacity: 0; transition: opacity .25s ease-in-out;">\n\t<div class="woocommerce-product-gallery__wrapper">\n\t\n\t\t\t\t\n\t\t<div class="pls-single-product-gallery pls-product-slider" data-slider_options='{&quot;slidesPerView&quot;:1,&quot;spaceBetween&quot;:16,&quot;loop&quot;:false,&quot;navigation&quot;:false,&quot;thumbs&quot;:true}'>\n\t\t\t${images.map((m, i) => galleryImage(m, i, productName)).join('')}\t\t</div>\n\t\t\n\t\t<div class="pls-product-gallery-btns">\n\t\t\t\t\t</div>\n\t\t\n\t</div>\n\t\n\t\t<div class="pls-product-thumbnail-wrapper">\n\t\t<div class="pls-product-thumbnail-inner">\n\t\t\t<div class="pls-single-product-thumbnails" data-slider_options='{&quot;slidesPerView&quot;:4,&quot;spaceBetween&quot;:16,&quot;loop&quot;:false,&quot;navigation&quot;:false,&quot;direction&quot;:&quot;vertical&quot;,&quot;mobile_direction&quot;:&quot;horizontal&quot;,&quot;tablet_slidesPerView&quot;:5,&quot;mobile_slidesPerView&quot;:4}'>\n\t\t\t\t${images.map(galleryThumb).join('')}\t\t\t</div>\n\t\t</div>\n\t</div>\n\t\t\n</div>`;
}

/** Price block of the summary (wc_price with <bdi>) */
function summaryPrice(p) {
  const P = (n) => wcPrice(n, { bdi: true, symbol: '&#36;', translate: true });
  if (p.type === 'variable') {
    const r = p.range;
    if (!r) return '<p class="price pls-product-price"></p>';
    if (r.min !== r.max) return `<p class="price pls-product-price">${P(r.min)} <span aria-hidden="true">&ndash;</span> ${P(r.max)}<span class="screen-reader-text">Price range: &#36;${r.min.toFixed(2)} through &#36;${r.max.toFixed(2)}</span></p>`;
    if (r.regMax > r.min && r.regMin === r.regMax) return `<p class="price pls-product-price"><ins>${P(r.min)}</ins> <del aria-hidden="true">${P(r.regMax)}</del></p>`;
    return `<p class="price pls-product-price">${P(r.min)}</p>`;
  }
  if (p.price == null) return '<p class="price pls-product-price"></p>';
  if (p.on_sale) return `<p class="price pls-product-price"><ins>${P(p.price)}</ins> <del aria-hidden="true">${P(p.regular)}</del></p>`;
  return `<p class="price pls-product-price">${P(p.price)}</p>`;
}

function quantityNumber(id, label, max) {
  return `\n\t<div class="pls-quantity-label">Quantity:</div>\n\t<div class="quantity">\n\t\t\t\t<label class="minus"></label>\r\n\t\t\r\n\t\t\t<label class="screen-reader-text" for="${id}">${label} quantity</label>\n\t\t<input\n\t\t\ttype="number"\n\t\t\t\t\t\tid="${id}"\n\t\t\tclass="input-text qty text"\n\t\t\tname="quantity"\n\t\t\tvalue="1"\n\t\t\taria-label="Product quantity"\n\t\t\t\t\t\tmin="1"\n${max ? `\t\t\t\t\t\t\tmax="${max}"\n` : ''}\t\t\t\t\t\t\t\t\t\tstep="1"\n\t\t\t\tplaceholder=""\n\t\t\t\tinputmode="numeric"\n\t\t\t\tautocomplete="off"\n\t\t\t\t\t/>\n\t\t\t\t<label class="plus"></label>\r\n\t\t</div> `;
}

function quickBuy(p, type) {
  return `<input type="hidden" class="pls_quick_buy_product_${p.id}" value="${p.id}"  /><div class="pls-quick-buy"><button  class="pls_quick_buy_button pls_quick_buy_${type} pls_quick_buy_${p.id}" value="Buy It Now" type="button" name="pls_quick_buy_button"  data-product-type="${type}" data-pls-product-id="${p.id}">Buy It Now</button></div>`;
}

function simpleForm(p) {
  if (p.stock_status === 'outofstock' || !p.purchasable) return '<p class="stock out-of-stock">Out of stock</p>\n';
  const id = uniqid();
  const max = p.manage_stock && p.backorders === 'no' ? Math.max(0, p.stock_quantity) : null;
  const qty = max === 1
    ? `\n\t\t\t<div class="quantity hidden">\n\t\t<input \n\t\t\ttype="hidden"\n\t\t\tid="${id}"\n\t\t\tclass="input-text qty text"\n\t\t\tname="quantity"\n\t\t\taria-label="Product quantity"\n\t\t\tvalue="1"\n\t\t/>\n\t</div>\n\t\n\t\t`
    : `\n\t\t\t${quantityNumber(id, esc(p.plain_name), max)}\n\t\t`;
  return `<form class="cart" action="${productUrl(p)}" method="post" enctype='multipart/form-data'>\n\t\t${qty}<button type="submit" name="add-to-cart" value="${p.id}" class="single_add_to_cart_button button alt">Add to cart</button>\n\n\t\t${quickBuy(p, 'simple')}\t</form>\n\n\t`;
}

function variationForm(p, taxonomies) {
  const attrs = (json(p.attributes) || []).filter((a) => a.variation);
  const rows = attrs.map((a) => {
    const tax = a.id ? taxonomies.get(Number(a.id)) : null;
    const name = tax ? tax.slug : sanitizeTitle(a.name);
    const options = a.options.map((o) => {
      const term = tax?.terms.find((t) => decodeEntities(t.name) === decodeEntities(o));
      return { value: term ? term.slug : o, label: term ? term.name : o, color: term?.color || '' };
    });
    const select = `<select id="${name}" class="" name="attribute_${name}" data-attribute_name="attribute_${name}" data-show_option_none="yes"><option value="">Choose an option</option>${options.map((o) => `<option value="${esc(o.value)}" >${esc(o.label)}</option>`).join('')}</select>`;
    if (tax?.slug === 'pa_color') {
      const sw = options.map((o) => `<span class="swatch-term swatch swatch-color term-${o.value} swatch-circle swatch-normal " title="${esc(o.label).replace(/&#039;/g, '&apos;')}" data-term="${o.value}"><span class="pls-tooltip" style="background-color:${o.color}">${esc(o.label)}</span></span>`).join('');
      return `\t\t\t\t\t\t\t<div class="variation-swatche">\n\t\t\t\t\t<div class="label"><label for="${name}">\t\n\t\t\t\t\t\t${esc(tax.name)}:</label>\t\t\t\n\t\t\t\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t<div class="value with-swatches">\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t<div class="pls-swatches" data-attribute="${name}">\n\t\t\t\t\t\t\t\t\t${sw}\t\t\t\t\t\t\t\t</div> \t\t\t\t\t\t<div class="variation-selector pls-hidden">\n\t\t\t\t\t\t\t${select}\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t\t\t\t\t\t<a class="reset_variations" href="#" aria-label="Clear options">Clear</a>\t\t\t\t\t</div>\n\t\t\t\t</div>\n\t\t\t\t`;
    }
    return `\t\t\t\t\t\t\t<div class="variation-swatche">\n\t\t\t\t\t<div class="label"><label for="${name}">\t\n\t\t\t\t\t\t${esc(tax ? tax.name : a.name)}:</label>\t\t\t\n\t\t\t\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t<div class="value">\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t<div class="variation-selector">\n\t\t\t\t\t\t\t${select}\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t\t\t\t\t\t<a class="reset_variations" href="#" aria-label="Clear options">Clear</a>\t\t\t\t\t</div>\n\t\t\t\t</div>\n\t\t\t\t`;
  }).join('');
  const id = uniqid();
  return `<form class="variations_form cart pls-swatches-wrap" action="${productUrl(p)}" method="post" enctype='multipart/form-data' data-product_id="${p.id}" data-product_variations="${escJsonAttr(phpJson((p.available_variations || []).map((v) => ({ ...v, availability_html: '' }))))}">\n\t\n\t\t\t<div class="variations" role="presentation">\n${rows}\t</div>\t\t\n\t\t<div class="reset_variations_alert screen-reader-text" role="alert" aria-live="polite" aria-relevant="all"></div>\n\t\t\n\t\t<div class="single_variation_wrap">\n\t\t\t<div class="woocommerce-variation single_variation" role="alert" aria-relevant="additions"></div><div class="woocommerce-variation-add-to-cart variations_button">\n\t\n\t\t${quantityNumber(id, esc(p.plain_name), null)}\n\t<button type="submit" class="single_add_to_cart_button button alt">Add to cart</button>\n\n\t${quickBuy(p, 'variable')}\n\t<input type="hidden" name="add-to-cart" value="${p.id}" />\n\t<input type="hidden" name="product_id" value="${p.id}" />\n\t<input type="hidden" name="variation_id" class="variation_id" value="0" />\n</div>\n\t\t</div>\n\t\n\t</form>\n\n\t`;
}

/** Estimated delivery: 2 to 6 days from today (shop timezone), "06 October  - 10 October " */
function deliveryDates() {
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', timeZone: 'Asia/Beirut' });
  const now = Date.now();
  return `${fmt(new Date(now + 2 * 86400000))}  - ${fmt(new Date(now + 6 * 86400000))} `;
}

function summary(p, ctx) {
  const catLinks = ctx.mine.sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<a href="${categoryUrl(ctx.cats, c)}" rel="tag">${esc(c.name)}</a>`).join(', ');
  const thumb = p.image ? imageUrl(p.image, 'woocommerce_gallery_thumbnail') : '';
  const url = `${SITE_URL()}${productUrl(p)}`;
  const name = decodeEntities(p.name);
  const pct = salePercent(p);
  const discount = pct && p.type !== 'variable'
    ? `\n\t\t\r\n\t\t<div class="pls-product-discount-label">\r\n\t\t\t<span class="on-sale">-${pct}% </span>\t\t</div> \n\t\n\t`
    : p.type === 'variable' ? '\n\n' : '\n\n\t\n\t';
  const form = p.type === 'variable' ? variationForm(p, ctx.taxonomies) : simpleForm(p);
  return `<div class="summary entry-summary">\n\t\t\t\t\t\t<div class="pls-single-product-title">\r\n\t\t\t\t\t<div class="pls-product-cat">\r\n\t\t\t<span class="posted_in">${catLinks}</span>\t\t</div>\r\n\t<h1 class="product_title entry-title">${texturize(p.name)}</h1>\t\t\r\n\t\t<div class="pls-whishlist-btn">\r\n\t\t\t<a href="?add-to-wishlist=${p.id}" class="woosw-btn woosw-btn-${p.id}" data-id="${p.id}" data-product_name="${escName(p.name)}" data-product_image="${thumb}" rel="nofollow" aria-label="Add to wishlist">Add to wishlist</a>\t\t</div>\t\t\r\n\t\t\t </div>\r\n\t\t ${summaryPrice(p)}${discount}${form}\n\t\t\r\n\t\t<div class="pls-product-compare-share-wrap">\r\n\t\t\t\t\t\r\n\t\t<div class="pls-compare-btn">\r\n\t\t\t<a href="?add-to-compare=${p.id}" class="woosc-btn woosc-btn-${p.id} " rel="nofollow" data-text="Compare" data-text_added="Compare" data-id="${p.id}" data-product_id="${p.id}" data-product_name="${esc(p.name)}" data-product_image="${thumb}">Compare</a>\t\t</div>\r\n\t\t\t\t\r\n\t\t\t\t\t<div class="pls-product-share">\r\n\t\t\t\t<span class="share-label"> Share Products </span>\r\n\t\t\t</div>\r\n\t\t\t<div id="pls-product-share-popup" class="pls-product-share-popup mfp-hide">\r\n\t\t\t\t<h5 class="pls-share-popup-title">Share</h5>\r\n\t\t\t\t\t\t\t\t<div class="pls-social icons-fill-colour icons-shape-circle icons-size-small">\r\n\t\t\t\t\t<span class="pls-social-title">Share:</span>\t\t\t\t\t\r\n\t\t\t\t\t<a href="https://www.facebook.com/sharer/sharer.php?u=${url}" rel="external" class="social-facebook" aria-label="Facebook" target="_blank"><i class="picon-facebook-f"></i> <span class="social-text">Facebook</span></a><a href="https://www.linkedin.com/shareArticle?mini=true&url=${url}&amp;title=${plusEncode(name)}" rel="external" class="social-linkedin" aria-label="LinkedIn" target="_blank"><i class="picon-linkedin-in"></i> <span class="social-text">LinkedIn</span></a><a href="https://twitter.com/share?url=${plusEncode(name)}&amp;url=${url}" rel="external" class="social-twitter" aria-label="Twitter" target="_blank"><i class="picon-x-twitter"></i> <span class="social-text">Twitter</span></a><a href="https://pinterest.com/pin/create/button/?url=${url}&amp;description=${plusEncode(name)}&amp;media=${p.image ? SITE_URL() + p.image.url : ''}" rel="external" class="social-pinterest" aria-label="Pinterest" target="_blank"><i class="picon-pinterest-p"></i> <span class="social-text">Pinterest</span></a><a href="https://telegram.me/share/url?url=${url}" rel="external" class="social-telegram" aria-label="Telegram" target="_blank"><i class="picon-telegram"></i> <span class="social-text">Telegram</span></a>\t\t\t\t</div>\r\n\t\t\t\t\t\t\t<div class="pls-copy-link-wrap">\r\n\t\t\t\t\t<h6 class="pls-copy-link-title">Copy URL</h6>\r\n\t\t\t\t\t<form class="pls-product-share-form">\r\n\t\t\t\t\t\t<input id="pls-product-share-url" type="text" value="${url}" readonly>\r\n\t\t\t\t\t\t<button class="button pls-copy-btn" data-copy="Copy" data-copied="Copied"> \r\n\t\t\t\t\t\t\tCopy\t\t\t\t\t\t</button>\r\n\t\t\t\t\t</form>\r\n\t\t\t\t</div>\r\n\t\t\t</div>\r\n\t\t\t\t </div>\r\n\t\t \t\t<div class="pls-estimated-delivery">\r\n\t\t\t<div class="pls-delivery-label">\r\n\t\t\t\tEstimated Delivery:\t\t\t</div>\r\n\t\t\t<div class="pls-delivery-date">${deliveryDates()}</div>\r\n\t\t</div>\r\n\t\t<div class="pls-visitor-count pls-visitor-change" data-min="2" data-max="8" data-delay="5"><span class="product-visitor-count">${2 + Math.floor(Math.random() * 7)}</span> People viewing this product right now!</div><div class="product_meta">\n\n\t\n\t\n\t\t<span class="sku_wrapper">SKU: <span class="sku">${p.sku ? esc(p.sku) : 'N/A'}</span></span>\n\n\t\n\t<span class="posted_in">${ctx.mine.length > 1 ? 'Categories' : 'Category'}: ${catLinks}</span>\n\t\n\t\n</div>\n\t\t\t</div>`;
}

let reviewsEmptyTpl;
function reviewsPanel(p, reviews) {
  const approved = reviews.filter((r) => r.status === 'approved');
  const n = approved.length;
  if (!n && reviewsEmptyTpl) {
    return fill(reviewsEmptyTpl, { product_name: esc(decodeEntities(p.name)), product_url: productUrl(p), product_id: String(p.id) });
  }
  const avg = n ? (approved.reduce((s, r) => s + (r.rating || 0), 0) / n) : 0;
  const bars = [5, 4, 3, 2, 1].map((star) => {
    const count = approved.filter((r) => r.rating === star).length;
    const pctv = n ? Math.round((count / n) * 100) : 0;
    const quality = star >= 3 ? 'good' : star === 2 ? 'poor' : 'bad';
    return `\t\t\t\t\t\t\t\t\t\t\t\t\t\t\n\t\t\t\t\t\t<div class="pls-rating-bar">\t\t\t\t\t\t\t\t\t\n\t\t\t\t\t\t\t<div class="pls-rating-star">${star}</div>\n\t\t\t\t\t\t\t<div class="pls-progress">\n\t\t\t\t\t\t\t\t<div class="pls-progress-bar ${quality}" style="width:${pctv}%"></div>\n\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t<div class="pls-rating-count${count ? '' : ' zero'}">${count}</div>\n\t\t\t\t\t\t\t\t\t\t\t\t\t</div>\n`;
  }).join('');
  const title = n ? 'Add a review' : `Be the first to review &ldquo;${esc(decodeEntities(p.name))}&rdquo;`;
  const list = n
    ? `\n\t\t\t<ol class="commentlist">\n${approved.map((r) => `\t\t\t\t<li class="review" id="li-comment-${r.id}">\n\t\t\t\t\t<div id="comment-${r.id}" class="comment_container">\n\t\t\t\t\t\t<div class="comment-text">\n\t\t\t\t\t\t\t<div class="star-rating" role="img" aria-label="Rated ${r.rating} out of 5"><span style="width:${(r.rating / 5) * 100}%">Rated <strong class="rating">${r.rating}</strong> out of 5</span></div>\n\t\t\t\t\t\t\t<p class="meta"><strong class="woocommerce-review__author">${esc(r.author)} </strong><span class="woocommerce-review__dash">&ndash;</span> <time class="woocommerce-review__published-date" datetime="${new Date(r.created_at).toISOString()}">${new Date(r.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</time></p>\n\t\t\t\t\t\t\t<div class="description"><p>${esc(r.content)}</p>\n</div>\n\t\t\t\t\t\t</div>\n\t\t\t\t\t</div>\n\t\t\t\t</li>\n`).join('')}\t\t\t</ol>\n\t\t\t\t\t`
    : '\n\t\t\t\t\t<p class="woocommerce-noreviews">There are no reviews yet.</p>\n\t\t\t\t';
  return `<div id="reviews" class="row woocommerce-Reviews">\n\n\t<div id="review_form_wrapper" class="col-12 col-md-6">\n\t\t\n\t\t\t\t\n\t\t<div class="pls-product-rating-histogram">\n\t\t\t<div class="pls-product-rating-avg-wrapper">\n\t\t\t\t<div class="pls-product-rating-avg">${n ? avg.toFixed(1).replace(/\.0$/, '') : 0}</div>\n\t\t\t\t\t\t\t\t<div class="pls-product-rating-count">\n\t\t\t\t\t<span>(${n} Ratings)</span>\n\t\t\t\t</div>\n\t\t\t</div>\n\t\t\t<div class="pls-rating-histogram-wrapper">\n\t\t\t\t<div class="pls-rating-histogram">\n${bars}\t\t\t\t\t\t\t\t\t\t\t\t\n\t\t\t\t</div>\n\t\t\t</div>\n\t\t</div>\n\t\t\t\t\n\t\t\t\t\t<div id="review_form">\n\t\t\t\t\t<div id="respond" class="comment-respond">\n\t\t<span id="reply-title" class="comment-reply-title" role="heading" aria-level="3">${title} <small><a rel="nofollow" id="cancel-comment-reply-link" href="${productUrl(p)}#respond" style="display:none;">Cancel reply</a></small></span><form action="/wp-comments-post.php" method="post" id="commentform" class="comment-form"><p class="comment-notes"><span id="email-notes">Your email address will not be published.</span> <span class="required-field-message">Required fields are marked <span class="required">*</span></span></p><p class="comment-form-rating"><label for="rating" id="comment-form-rating-label">Your rating&nbsp;<span class="required">*</span></label><select name="rating" id="rating" required>\n\t\t\t\t\t\t<option value="">Rate&hellip;</option>\n\t\t\t\t\t\t<option value="5">Perfect</option>\n\t\t\t\t\t\t<option value="4">Good</option>\n\t\t\t\t\t\t<option value="3">Average</option>\n\t\t\t\t\t\t<option value="2">Not that bad</option>\n\t\t\t\t\t\t<option value="1">Very poor</option>\n\t\t\t\t\t</select></p><p class="comment-form-comment"><label for="comment">Your review&nbsp;<span class="required">*</span></label><textarea id="comment" name="comment" cols="45" rows="8" required></textarea></p><p class="comment-form-author"><label for="author">Name&nbsp;<span class="required">*</span></label><input id="author" name="author" type="text" autocomplete="name"  value="" size="30" required /></p>\n<p class="comment-form-email"><label for="email">Email&nbsp;<span class="required">*</span></label><input id="email" name="email" type="email" autocomplete="email"  value="" size="30" required /></p>\n<p class="comment-form-cookies-consent"><input id="wp-comment-cookies-consent" name="wp-comment-cookies-consent" type="checkbox" value="yes" /> <label for="wp-comment-cookies-consent">Save my name, email, and website in this browser for the next time I comment.</label></p>\n<p class="form-submit"><input name="submit" type="submit" id="submit" class="submit" value="Submit" /> <input type='hidden' name='comment_post_ID' value='${p.id}' id='comment_post_ID' />\n<input type='hidden' name='comment_parent' id='comment_parent' value='0' />\n</p></form>\t</div><!-- #respond -->\n\t\t\t\t</div>\n\t\t\t\t\n\t</div>\n\t\n\t<div id="comments" class="col-12 col-md-6">\n\t\t${list}\n\t</div>\n\t\n\t<div class="clear"></div>\n</div>`;
}

function attributesTable(p, taxonomies) {
  const attrs = (json(p.attributes) || []).filter((a) => a.visible !== false);
  if (!attrs.length && !p.weight) return '';
  const rows = attrs.map((a) => {
    const tax = a.id ? taxonomies.get(Number(a.id)) : null;
    const key = tax ? tax.slug : sanitizeTitle(a.name);
    return `\t\t\t<tr class="woocommerce-product-attributes-item woocommerce-product-attributes-item--attribute_${key}">\n\t\t\t<th class="woocommerce-product-attributes-item__label" scope="row">${esc(tax ? tax.name : a.name)}</th>\n\t\t\t<td class="woocommerce-product-attributes-item__value"><p>${a.options.map((o) => esc(o)).join(', ')}</p>\n</td>\n\t\t</tr>\n`;
  }).join('');
  return `\n\n<table class="woocommerce-product-attributes shop_attributes" aria-label="Product Details">\n${rows}\t</table>\n`;
}

function tabs(p, reviews, taxonomies) {
  const list = [];
  if (p.description && p.description.trim()) list.push(['description', 'Description', `\n\n${p.description}\n`]);
  const attrTable = attributesTable(p, taxonomies);
  if (attrTable) list.push(['additional_information', 'Additional information', attrTable]);
  const approved = reviews.filter((r) => r.status === 'approved').length;
  list.push(['reviews', `Reviews (${approved})`, reviewsPanel(p, reviews)]);
  const titles = list.map(([k, label]) => `\t\t\t\t\t\t\t<li role="presentation" class="${k}_tab" id="tab-title-${k}">\n\t\t\t\t\t<a href="#tab-${k}" role="tab" aria-controls="tab-${k}">\n\t\t\t\t\t\t${label}\t\t\t\t\t</a>\n\t\t\t\t</li>\n`).join('');
  const panels = list.map(([k, label, body], i) => `\t\t\t\t\t<div class="tab-content-wrap">\n\t\t\t\t<a href="#tab-${k}" class="accordion-title title-${k}"><span>${label}</span></a>\n\t\t\t\t<div class="woocommerce-Tabs-panel woocommerce-Tabs-panel--${k} panel entry-content wc-tab" id="tab-${k}" role="tabpanel" aria-labelledby="tab-title-${k}" ${i > 0 ? 'style="display: none;" ' : ' '}>\n\t\t\t\t\t${body}\t\t\t\t</div>\n\t\t\t</div>\n`).join('');
  return `<div class="woocommerce-tabs wc-tabs-wrapper tabs-layout">\n\t\t<ul class="tabs wc-tabs" role="tablist">\n${titles}\t\t\t\t\t</ul>\n${panels}\t\t\t\t\n\t\t\t</div>`;
}

/** Related products: other visible products of the same categories (stable per product and day) */
async function relatedIds(p, catIds) {
  if (!catIds.length) return [];
  const rows = await query(`select distinct p.id from products p join product_categories pc on pc.product_id = p.id
    where pc.category_id = any($1::int[]) and p.id <> $2 and p.status = 'publish' and p.online_visible and p.stock_status <> 'outofstock'
      and p.catalog_visibility in ('visible', 'catalog')`, [catIds, p.id]);
  const seed = (p.id * 2654435761 + Math.floor(Date.now() / 86400000)) >>> 0;
  const rand = (x) => (Math.imul(x ^ seed, 2246822519) >>> 0);
  return rows.map((r) => r.id).sort((a, b) => rand(a) - rand(b)).slice(0, 16);
}

function relatedSection(products, currentUrl) {
  if (!products.length) return '\t\t\t\t\t';
  const images = { count: 99 };
  const cards = products.map((rp, i) => `\n\t\t\t\n\t\t\t\t${productCard(rp, { position: i, columns: 4, images, currentUrl, slide: true })}`).join('');
  const sid = 10000 + Math.floor(Math.random() * 89999);
  return `\t\t\t\t\t\n\t<section class="related products">\n\t\n\t\t\t\t\t<h2>Related products</h2>\n\t\t\n\t\t\t<div id="section-${sid}" class="pls-slider swiper row">\n\t\t<div class="products products-wrap product-style-5  grid-view swiper-wrapper slider-col-xl-4 slider-col-lg- slider-col-md-3 slider-col-2 has-quick-shop pls-variation-on-hover" data-slider_options="{&quot;slider_loop&quot;:true,&quot;slider_autoplay&quot;:true,&quot;slider_autoplay_delay&quot;:&quot;1500&quot;,&quot;slider_autoplay_speed&quot;:&quot;1500&quot;,&quot;slider_pause_on_hover&quot;:true,&quot;slider_rewind&quot;:false,&quot;slider_autoHeigh&quot;:false,&quot;slider_touchDrag&quot;:true,&quot;slider_touchDrag_mobile&quot;:true,&quot;slider_navigation&quot;:true,&quot;slider_pagination&quot;:true,&quot;slider_scrollbar&quot;:false,&quot;slider_centered&quot;:false,&quot;slider_effect&quot;:&quot;slide&quot;,&quot;slider_spaceBetween&quot;:0,&quot;slides_to_show&quot;:&quot;4&quot;,&quot;slides_to_show_tablet&quot;:&quot;3&quot;,&quot;slides_to_show_mobile&quot;:&quot;2&quot;,&quot;slides_to_scroll&quot;:1}" >\n\n${cards}\n\t\t\t\n\t\t\t\t</div>\n\t</div>\n\n\t</section> <!-- .related .products -->`;
}

/** Sticky "add to cart" bar shown when scrolling down the product page */
export function stickyBar(p) {
  const img = p.image ? imageTag(p.image, 'woocommerce_gallery_thumbnail', { mode: 'attachment' })
    .replace('<img ', '<img loading="lazy" ').replace(/ alt="[^"]*"/, ` alt="${esc(decodeEntities(p.name))}"`) : '';
  const price = p.type === 'variable' && p.range
    ? `<span class="price">${wcPrice(p.range.min)}${p.range.min !== p.range.max ? ` &ndash; ${wcPrice(p.range.max)}` : ''}</span>`
    : p.on_sale ? `<span class="price"><ins>${wcPrice(p.price)}</ins> <del aria-hidden="true">${wcPrice(p.regular)}</del></span>` : `<span class="price">${p.price != null ? wcPrice(p.price) : ''}</span>`;
  const button = p.type === 'variable'
    ? '<a href="#" class="button variable" rel="nofollow">\r\n\t\t\t\t\t\t\tSelect Options\t\t\t\t\t\t</a>'
    : '<a href="#" class="button simple" rel="nofollow">\r\n\t\t\t\t\t\t\tAdd to cart\t\t\t\t\t\t</a>';
  return `<div class="pls-sticky-add-to-cart">\r\n\t\t\t<div class="container">\r\n\t\t\t\t<div class="row">\r\n\t\t\t\t\t<div class="col pls-sticky-add-to-cart-left">\r\n\t\t\t\t\t\t<div class="pls-sticky-product-image">\r\n\t\t\t\t\t\t\t${img}\t\t\t\t\t\t</div>\r\n\t\t\t\t\t\t<div class="pls-sticky-product-info">\r\n\t\t\t\t\t\t\t<div class="pls-sticky-product-title">${texturize(p.name)}</div>\r\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t${price}\r\n\t\t\t\t\t\t</div>\r\n\t\t\t\t\t</div>\r\n\t\t\t\t\t<div class="col-auto pls-sticky-add-to-cart-right">\t\r\n\t\t\t\t\t\t\t\t\t\t\t\t${button}\r\n\t\t\t\t\t\t\t\t\t\t\t</div>\r\n\t\t\t\t</div>\r\n\t\t\t</div>\r\n\t\t</div>`;
}

/** schema.org Product data (same fields as WooCommerce) */
export function schemaJson(p, siteUrl) {
  const url = `${siteUrl}${productUrl(p)}`;
  const avail = p.stock_status === 'outofstock' ? 'OutOfStock' : p.stock_status === 'onbackorder' ? 'BackOrder' : 'InStock';
  const price = p.type === 'variable' ? p.range?.min : p.price;
  const offer = { '@type': 'Offer' };
  if (p.type === 'variable' && p.range && p.range.min !== p.range.max) {
    Object.assign(offer, { '@type': 'AggregateOffer', lowPrice: p.range.min.toFixed(2), highPrice: p.range.max.toFixed(2), offerCount: (p.available_variations || []).length });
  } else if (price != null) {
    offer.priceSpecification = [{ '@type': 'UnitPriceSpecification', price: price.toFixed(2), priceCurrency: 'USD', validThrough: `${new Date().getFullYear() + 1}-12-31` }];
    if (p.on_sale) offer.priceSpecification.push({ '@type': 'UnitPriceSpecification', price: p.regular.toFixed(2), priceCurrency: 'USD', validThrough: `${new Date().getFullYear() + 1}-12-31`, priceType: 'https://schema.org/ListPrice' });
    offer.priceValidUntil = `${new Date().getFullYear() + 1}-12-31`;
  }
  Object.assign(offer, { availability: `https://schema.org/${avail}`, url, seller: { '@type': 'Organization', name: 'Poudre Beauty', url: `${siteUrl}/` } });
  if (price != null && offer['@type'] === 'Offer') Object.assign(offer, { price: price.toFixed(2), priceCurrency: 'USD' });
  return JSON.stringify({ '@context': 'https://schema.org/', '@type': 'Product', '@id': `${url}#product`, name: decodeEntities(p.name), url, description: '', image: p.image ? `${siteUrl}${p.image.url}` : '', sku: p.sku || String(p.id), offers: [offer] });
}

/** Returns { html, product, category } or null when the product is not viewable. */
export async function renderProduct(slug, { currentUrl, preview = false } = {}) {
  const [row] = await query(`select id, created_at, description, weight, catalog_visibility, online_visible, status from products where slug = $1`, [slug]);
  if (!row) return null;
  if (!preview && (row.status !== 'publish' || !row.online_visible)) return null;
  const [p] = await productsByIds([row.id]);
  Object.assign(p, { created_at: row.created_at, description: row.description, weight: row.weight });
  const { cats, main, mine } = await mainCategory(p.id);
  const taxonomies = await attributeTaxonomies();
  const [imagesRows, reviews, nav] = await Promise.all([
    query('select images from products where id = $1', [p.id]),
    query('select * from reviews where product_id = $1 order by created_at', [p.id]),
    adjacent(p),
  ]);
  const refs = json(imagesRows[0].images) || [];
  const media = await mediaByIds(refs.map((r) => r.id));
  const images = refs.map((r) => media.get(Number(r.id))).filter(Boolean);
  const related = await productsByIds(await relatedIds(p, mine.map((c) => c.id)));
  const chain = main ? categoryPath(cats, main) : [];
  const crumbs = [{ title: 'Home', url: '/' }, { title: 'Products', url: '/shop/' }, ...chain.map((c) => ({ title: esc(c.name), url: categoryUrl(cats, c) })), { title: texturize(p.name) }];
  const breadcrumb = `<nav class="pls-breadcrumb">${crumbs.map((it, i) => (i === crumbs.length - 1 ? `<span class="last">${it.title}</span>` : `<a href="${it.url}">${it.title}</a><span class="pls-delimiter-sep pls-greater-than"></span>`)).join('')}</nav>`;
  const html = fill(await template(), {
    breadcrumb,
    product_nav: productNav(nav.prev, nav.next),
    product_id: String(p.id),
    product_class: `pls-single-product-page pls-product-content-style-1 pls-product-sticky ${productClasses(p, ['first'])}`,
    gallery: gallery(images, decodeEntities(p.name)),
    summary: summary(p, { cats, mine, taxonomies }),
    tabs: tabs(p, reviews, taxonomies),
    related: relatedSection(related, currentUrl),
  });
  return { html, product: p, mainCategory: main, categories: mine, chain };
}
