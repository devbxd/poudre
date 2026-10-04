// Builds the website page skeletons (site/templates/*.html) from the captured WordPress HTML.
// Everything stays byte-identical except the dynamic regions, replaced by <!--@name--> markers
// that the server fills from the database.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SRC = 'data/original';
const OUT = 'site/templates';
await mkdir(OUT, { recursive: true });

/** Index just after the closing tag of the element that starts at `start`. */
export function elementEnd(html, start) {
  const tag = html.slice(start + 1).match(/^[a-zA-Z0-9]+/)[0];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html));) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error(`No end for <${tag}> at ${start}`);
}

function replaceElement(html, needle, marker, { all = false, required = true } = {}) {
  let count = 0;
  let from = 0;
  for (;;) {
    const i = html.indexOf(needle, from);
    if (i < 0) break;
    const start = html.lastIndexOf('<', i);
    const end = elementEnd(html, start);
    const name = typeof marker === 'function' ? marker(count) : marker;
    html = html.slice(0, start) + `<!--@${name}-->` + html.slice(end);
    count++;
    from = start + 1;
    if (!all) break;
  }
  if (!count && required) throw new Error(`Region not found: ${needle}`);
  return [html, count];
}

function normalise(html) {
  return html
    // root-relative URLs so the site works on any domain (staging, then poudrebeauty.com)
    .replaceAll('https://poudrebeauty.com/', '/')
    .replaceAll('https:\\/\\/poudrebeauty.com\\/', '\\/')
    .replaceAll('//poudrebeauty.com/', '/')
    .replaceAll('"https://poudrebeauty.com"', '"/"')
    // URL-encoded JSON (wcSettings, preloaded API data)
    .replaceAll('https%3A%5C%2F%5C%2Fpoudrebeauty.com', '')
    .replaceAll('https%3A%2F%2Fpoudrebeauty.com', '')
    .replaceAll('https://poudrebeauty.com', '');
}

function skeleton(html, { name, mainNeedle = '<main', keepMain = false }) {
  const log = [];
  let h = normalise(html);
  const sub = (re, marker) => {
    const before = h;
    h = h.replace(re, marker);
    log.push(`${marker.slice(0, 40)}: ${before === h ? 'MISSING' : 'ok'}`);
  };
  sub(/<title>[\s\S]*?<\/title>/, '<title><!--@title--></title>');
  // feeds / oembed / api links / canonical / shortlink are rebuilt per page
  h = h.replace(/<link rel="alternate"[^>]*>\s*/g, '').replace(/<link rel="(https:\/\/api\.w\.org\/|EditURI|canonical|shortlink)"[^>]*>/g, '').replace(/<link rel='shortlink'[^>]*>/g, '').replace(/<link rel="https:\/\/api\.w\.org\/"[^>]*>/g, '');
  sub(/<\/head>/, '<!--@head--></head>');
  sub(/<body class="[^"]*"/, '<body class="<!--@body_class-->"');
  sub(/<header id="header" class="[^"]*"/, '<header id="header" class="<!--@header_class-->"');
  let n;
  [h, n] = replaceElement(h, 'id="menu-topbar-menu"', 'menu_topbar'); log.push(`menu_topbar: ${n}`);
  [h, n] = replaceElement(h, 'id="menu-primary-menu"', 'menu_primary'); log.push(`menu_primary: ${n}`);
  [h, n] = replaceElement(h, 'id="menu-primary-menu-1"', 'menu_mobile'); log.push(`menu_mobile: ${n}`);
  [h, n] = replaceElement(h, 'id="menu-primary-menu-2"', 'menu_mobile_categories'); log.push(`menu_mobile_categories: ${n}`);
  [h, n] = replaceElement(h, "<select  name='product_cat'", 'search_categories', { all: true }); log.push(`search_categories: ${n}`);
  [h, n] = replaceElement(h, 'class="pls-block pls-block-1247"', 'search_popup_block', { required: false }); log.push(`search_popup_block: ${n}`);
  // visitor state rendered per request: cart counter, mini cart, wishlist counter
  sub(/<span class="pls-header-cart-count[^"]*">\d+<\/span>/, '<!--@cart_count-->');
  sub(/<span class="pls-header-wishlist-count">\d+<\/span>/, '<!--@wishlist_count-->');
  if (h.includes('<div class="widget_shopping_cart_content">')) { [h, n] = replaceElement(h, '<div class="widget_shopping_cart_content">', 'mini_cart'); log.push(`mini_cart: ${n}`); }
  // cart & checkout blocks: the cart preloaded for the block scripts
  h = h.replace(/(createPreloadingMiddleware\( JSON\.parse\( decodeURIComponent\( ')[^']+(' \) \) \))/, '$1<!--@preload-->$2');
  if (name === 'product') {
    // product-specific parts outside <main>: sticky add-to-cart bar and schema.org data
    [h, n] = replaceElement(h, 'class="pls-sticky-add-to-cart"', 'sticky'); log.push(`sticky: ${n}`);
    sub(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '<script type="application/ld+json"><!--@schema--></script>');
  }
  if (!keepMain) {
    const start = h.indexOf(mainNeedle);
    const end = elementEnd(h, start);
    h = `${h.slice(0, start)}<!--@main-->${h.slice(end)}`;
  }
  // per-request nonces are not used by the new server
  h = h.replace(/name="woocommerce-login-nonce" value="[^"]*"/g, 'name="woocommerce-login-nonce" value=""')
    .replace(/name="woocommerce-register-nonce" value="[^"]*"/g, 'name="woocommerce-register-nonce" value=""')
    .replace(/<input type="hidden" name="_wp_http_referer" value="[^"]*" \/>/g, '<input type="hidden" name="_wp_http_referer" value="<!--@path-->" />');
  console.log(name.padEnd(10), log.join(' | '));
  return h;
}

const PAGES = [
  ['home', 'html/home.html'],
  ['archive', 'html/shop.html'],
  ['product', 'html/product_simple.html'],
  ['page', 'html/about.html'],
  ['contact', 'html/contact.html'],
  ['terms', 'html/terms.html'],
  ['stores', 'html/stores.html'],
  ['tracking', 'html/tracking.html'],
  ['cart', 'ajax/page_cart_full.txt'],
  ['cart_empty', 'html/cart.html'],
  ['checkout', 'ajax/page_checkout_full.txt'],
  ['account', 'html/account.html'],
  ['wishlist', 'ajax/page_wishlist_full.txt'],
  ['blog', 'html/blog.html'],
  ['post', 'html/post.html'],
  ['notfound', 'html/notfound.html'],
];

/** Cuts `html` between two literal markers (start included, end excluded) and replaces it with <!--@name--> */
function cut(html, start, end, name, { includeEnd = false } = {}) {
  const a = html.indexOf(start);
  if (a < 0) throw new Error(`cut ${name}: start not found`);
  const b = html.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`cut ${name}: end not found`);
  return html.slice(0, a) + `<!--@${name}-->` + html.slice(includeEnd ? b + end.length : b);
}

// Product archive main area (shop, categories, brands, tags, search)
function archiveMain(main) {
  let h = main;
  h = cut(h, '<h1 class="title">', '\t</h1>', 'page_title_h1');
  h = h.replace('<!--@page_title_h1-->', '<h1 class="title">\n\t\t<!--@page_title-->');
  h = cut(h, '<nav class="pls-breadcrumb">', '</div>', 'breadcrumb');
  h = cut(h, '<div class="pls-products-view">', '</div>', 'products_view', { includeEnd: true });
  h = cut(h, '\t\t\t\t\t<option value="menu_order"', '\t\t\t</select>', 'orderby_options');
  h = cut(h, '<input type="hidden" name="paged" value="1" />', '</form>', 'ordering_hidden');
  h = cut(h, '<div class="woocommerce-result-count" role="alert" aria-relevant="all" >\n', '</div>', 'result_count');
  h = h.replace('<!--@result_count-->', '<div class="woocommerce-result-count" role="alert" aria-relevant="all" >\n<!--@result_count-->');
  h = cut(h, '<div class="products products-wrap', '\r\n</div><!-- .pls-content-area -->', 'products');
  h = cut(h, '<div class="sidebar-inner">\r\n', '\t</div>\r\n</div><!-- #secondary -->', 'sidebar');
  h = h.replace('<!--@sidebar-->', '<div class="sidebar-inner">\r\n<!--@sidebar-->');
  return h;
}

/** Replaces the whole element whose opening tag contains `needle` */
function cutElement(html, needle, name) {
  const i = html.indexOf(needle);
  if (i < 0) throw new Error(`cutElement ${name}: not found`);
  const start = html.lastIndexOf('<', i);
  return html.slice(0, start) + `<!--@${name}-->` + html.slice(elementEnd(html, start));
}

// Single product main area
function productMain(main) {
  let h = main;
  h = cut(h, '<nav class="pls-breadcrumb">', '</div>', 'breadcrumb');
  h = cutElement(h, 'class="pls-product-navigation"', 'product_nav');
  h = h.replace(/<div id="product-\d+" class="[^"]*">/, '<div id="product-<!--@product_id-->" class="<!--@product_class-->">');
  h = cutElement(h, 'class="woocommerce-product-gallery ', 'gallery');
  h = cutElement(h, 'class="summary entry-summary"', 'summary');
  h = cutElement(h, 'class="woocommerce-tabs ', 'tabs');
  h = cut(h, '\t\t\t\t\t\n\t<section class="related products">', '</section> <!-- .related .products -->', 'related', { includeEnd: true });
  return h;
}

const meta = {};
for (const [name, file] of PAGES) {
  let html = await readFile(`${SRC}/${file}`, 'utf8');
  if (file.endsWith('.txt')) html = html.slice(html.indexOf('\n\n') + 2);
  // keep the original main area alongside, as reference for the renderers
  const norm = normalise(html);
  const ms = norm.indexOf('<main');
  const main = norm.slice(ms, elementEnd(norm, ms));
  meta[name] = {
    bodyClass: (norm.match(/<body class="([^"]*)"/) || [])[1],
    headerClass: (norm.match(/<header id="header" class="([^"]*)"/) || [])[1],
    title: ((norm.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(),
  };
  await writeFile(`${OUT}/${name}.main.html`, main);
  if (name === 'archive') await writeFile(`${OUT}/archive.main.tpl.html`, archiveMain(main));
  if (name === 'product') {
    await writeFile(`${OUT}/product.main.tpl.html`, productMain(main));
    // reviews panel without reviews (theme file uses CRLF in places): keep it verbatim
    const r0 = main.indexOf('<div id="reviews" class="row woocommerce-Reviews">');
    const reviews = main.slice(r0, elementEnd(main, r0))
      .replaceAll('Hoody Blanket', '<!--@product_name-->').replaceAll('/product/hoody-blanket/', '<!--@product_url-->')
      .replaceAll("value='18859'", "value='<!--@product_id-->'");
    await writeFile(`${OUT}/reviews_empty.html`, reviews);
  }
  if (name === 'home') {
    const i = norm.indexOf('class="pls-block pls-block-1247"');
    const start = norm.lastIndexOf('<', i);
    await writeFile(`${OUT}/search_popup_block.html`, norm.slice(start, elementEnd(norm, start)));
  }
  await writeFile(`${OUT}/${name}.html`, skeleton(html, { name }));
}
await writeFile(`${OUT}/pages.json`, JSON.stringify(meta, null, 1));
