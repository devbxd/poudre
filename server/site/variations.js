// WooCommerce "available variations" data and the loop colour swatches of the theme.
import { query } from '../db.js';
import { effectivePrice } from '../lib.js';
import { esc, wcPrice, decodeEntities } from './html.js';
import { cached } from './data.js';
import { imageTag, imageUrl, srcset } from './images.js';

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/** PHP json_encode defaults: escaped slashes and \uXXXX for non-ASCII characters. */
export const phpJson = (v) => JSON.stringify(v)
  .replace(/\//g, '\\/')
  .replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** htmlspecialchars(ENT_QUOTES) as used by wc_esc_json() */
export const escJsonAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** sanitize_title() for local attribute names */
export const sanitizeTitle = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s_-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');

export async function attributeTaxonomies() {
  return cached('attributes', 60000, async () => {
    const rows = await query('select id, name, slug, terms from attributes');
    return new Map(rows.map((a) => [a.id, { ...a, terms: json(a.terms) || [] }]));
  });
}

/** Key/value of a variation attribute as WooCommerce stores them (taxonomy slug or local text). */
export function attributeKeyValue(attr, taxonomies) {
  const tax = attr.id ? taxonomies.get(Number(attr.id)) : null;
  if (tax) {
    const term = tax.terms.find((t) => decodeEntities(t.name) === decodeEntities(attr.option) || t.slug === attr.option);
    return { key: `attribute_${tax.slug}`, value: term ? term.slug : sanitizeTitle(attr.option || ''), taxonomy: tax, term };
  }
  return { key: `attribute_${sanitizeTitle(attr.name)}`, value: attr.option || '' };
}

function imageProps(media) {
  if (!media) return { title: '', caption: '', url: '', alt: '', src: '', srcset: false, sizes: false };
  const find = (n) => (media.sizes || []).find((s) => s.name === n);
  const dir = media.url.slice(0, media.url.lastIndexOf('/') + 1);
  const single = find('woocommerce_single') || { file: media.url.split('/').pop(), width: media.width, height: media.height };
  const thumb = find('woocommerce_thumbnail') || { file: media.url.split('/').pop(), width: media.width, height: media.height };
  const gal = find('woocommerce_gallery_thumbnail') || { file: media.url.split('/').pop(), width: media.width, height: media.height };
  const set = srcset(media, single);
  return {
    title: media.title || '', caption: media.caption || '', url: media.url, alt: media.alt || media.caption || media.title || '',
    src: dir + single.file, srcset: set || false, sizes: set ? `(max-width: ${single.width}px) 100vw, ${single.width}px` : false,
    full_src: media.url, full_src_w: media.width, full_src_h: media.height,
    gallery_thumbnail_src: dir + gal.file, gallery_thumbnail_src_w: gal.width, gallery_thumbnail_src_h: gal.height,
    thumb_src: dir + thumb.file, thumb_src_w: thumb.width, thumb_src_h: thumb.height,
    src_w: single.width, src_h: single.height,
  };
}

export function availabilityHtml(v) {
  if (v.stock_status === 'outofstock') return '<p class="stock out-of-stock">Out of stock</p>\n';
  if (v.stock_status === 'onbackorder') return '<p class="stock available-on-backorder">Available on backorder</p>\n';
  // theme low-stock message (5 or fewer left)
  if (v.manage_stock && v.stock_quantity > 0 && v.stock_quantity <= 5) return `<p class="stock min-stock">Hurry, Only ${v.stock_quantity} left.</p>\n`;
  return '<p class="stock in-stock">In Stock</p>\n';
}

/**
 * product: product row (with images) ; variations: rows from the variations table ; media: Map of media by id
 */
const WP = (n) => wcPrice(n, { bdi: true, symbol: '&#36;', translate: true });

export function availableVariations(product, variations, media, taxonomies) {
  const prices = variations.map((v) => effectivePrice({ ...v, regular_price: v.regular_price ?? product.regular_price }));
  const samePrice = prices.every((x) => x.price === prices[0]?.price && x.regular === prices[0]?.regular);
  return variations.map((v, i) => {
    const attrs = {};
    // every variation attribute of the product is listed; "any" values are empty strings
    const vattrs = json(v.attributes) || [];
    for (const pa of (json(product.attributes) || []).filter((a) => a.variation)) {
      const set = vattrs.find((a) => (pa.id && a.id ? Number(a.id) === Number(pa.id) : a.name.toLowerCase() === pa.name.toLowerCase()));
      const { key, value } = attributeKeyValue(set || { id: pa.id, name: pa.name, option: '' }, taxonomies);
      attrs[key] = set ? value : '';
    }
    const img = json(v.image);
    const own = img?.id ? media.get(Number(img.id)) : null;
    const m = own || product.image || null;
    const fullSrc = own ? { file: own.url.split('/').pop(), width: own.width, height: own.height } : null;
    const { price, regular, on_sale } = prices[i];
    const inStock = v.stock_status !== 'outofstock';
    return {
      attributes: attrs,
      availability_html: availabilityHtml(v),
      backorders_allowed: v.backorders !== 'no',
      dimensions: { length: '', width: '', height: '' },
      dimensions_html: 'N/A',
      display_price: price,
      display_regular_price: regular,
      gallery_image_ids: [],
      gallery_images_html: '',
      image: imageProps(m),
      image_id: m?.id || 0,
      is_downloadable: false,
      is_in_stock: inStock,
      is_purchasable: v.regular_price != null || product.regular_price != null,
      is_sold_individually: 'no',
      is_virtual: false,
      max_qty: v.manage_stock && v.backorders === 'no' ? Math.max(0, v.stock_quantity) : '',
      min_qty: 1,
      price_html: samePrice ? '' : `<span class="price">${on_sale ? `<ins>${WP(price)}</ins> <del aria-hidden="true">${WP(regular)}</del>` : WP(price)}</span>`,
      sku: v.sku || product.sku || '',
      variation_description: v.description || '',
      variation_id: v.id,
      variation_is_active: true,
      variation_is_visible: true,
      weight: v.weight ? String(v.weight) : '',
      weight_html: v.weight ? `${v.weight} kg` : 'N/A',
      ...(m ? { woosb_image: imageTag(m, 'woocommerce_thumbnail', { mode: 'attachment' }) } : {}),
      // set by the theme only when the variation has its own image
      image_src: own ? [own.url, own.width, own.height, false] : false,
      image_srcset: own ? srcset(own, fullSrc) || false : false,
      image_sizes: own ? `(max-width: ${own.width}px) 100vw, ${own.width}px` : false,
    };
  });
}

/** Loop swatches (product-style-5 "variation on hover"), only for colour attributes. */
export function loopSwatches(product, variationsData, taxonomies) {
  const attrs = json(product.attributes) || [];
  const color = attrs.find((a) => a.variation && a.id && taxonomies.get(Number(a.id))?.slug === 'pa_color');
  if (!color) return '';
  const tax = taxonomies.get(Number(color.id));
  // the theme shows 4 swatches, then a "+N more" link to the product
  const LIMIT = 4;
  let spans = color.options.slice(0, LIMIT).map((name) => {
    const term = tax.terms.find((t) => decodeEntities(t.name) === decodeEntities(name)) || { slug: sanitizeTitle(decodeEntities(name)), name, color: '' };
    return `<span class="swatch-term swatch swatch-color term-${term.slug} swatch-circle swatch-normal " title="${esc(term.name).replace(/&#039;/g, '&apos;')}" data-term="${term.slug}"><span class="pls-tooltip" style="background-color:${term.color || ''}">${esc(term.name)}</span></span>`;
  }).join('');
  if (color.options.length > LIMIT) spans += `<a class="pls-swatch-more" href="/product/${product.slug}/" target="_self">+${color.options.length - LIMIT} more </a>`;
  const m = product.image;
  const full = m ? { file: m.url.split('/').pop(), width: m.width, height: m.height } : null;
  const set = m ? srcset(m, full) : '';
  return `\t<div class="pls-product-variations">\r\n\t\t\t\t<div class="pls-swatches-wrap" data-srcset="${set}" data-sizes="${full ? `(max-width: ${full.width}px) 100vw, ${full.width}px` : ''}" data-product_id="${product.id}" data-product_variations="${escJsonAttr(phpJson(variationsData))}">\r\n${'\t'.repeat(14)}<div class="pls-swatches" data-attribute="${tax.slug}">\r\n${'\t'.repeat(10)}${spans}${'\t'.repeat(9)}</div> \t\t\t\t\t\r\n\t\t\t\t\t<a class="reset_variations reset_variations--loop" href="#" style="display: none;">Clear</a>\r\n\t\t\t\t</div>\r\n\t\t\t</div>\r\n\t\t\t\t\t`;
}

export { imageUrl };
