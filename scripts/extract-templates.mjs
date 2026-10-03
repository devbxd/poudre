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
  sub(/<\/head>/, '<!--@head-->\n</head>');
  sub(/<body class="[^"]*"/, '<body class="<!--@body_class-->"');
  sub(/<header id="header" class="[^"]*"/, '<header id="header" class="<!--@header_class-->"');
  let n;
  [h, n] = replaceElement(h, 'id="menu-topbar-menu"', 'menu_topbar'); log.push(`menu_topbar: ${n}`);
  [h, n] = replaceElement(h, 'id="menu-primary-menu"', 'menu_primary'); log.push(`menu_primary: ${n}`);
  [h, n] = replaceElement(h, 'id="menu-primary-menu-1"', 'menu_mobile'); log.push(`menu_mobile: ${n}`);
  [h, n] = replaceElement(h, 'id="menu-primary-menu-2"', 'menu_mobile_categories'); log.push(`menu_mobile_categories: ${n}`);
  [h, n] = replaceElement(h, "<select  name='product_cat'", 'search_categories', { all: true }); log.push(`search_categories: ${n}`);
  [h, n] = replaceElement(h, 'class="pls-block pls-block-1247"', 'search_popup_block', { required: false }); log.push(`search_popup_block: ${n}`);
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

for (const [name, file] of PAGES) {
  let html = await readFile(`${SRC}/${file}`, 'utf8');
  if (file.endsWith('.txt')) html = html.slice(html.indexOf('\n\n') + 2);
  // keep the original main area alongside, as reference for the renderers
  const norm = normalise(html);
  const ms = norm.indexOf('<main');
  await writeFile(`${OUT}/${name}.main.html`, norm.slice(ms, elementEnd(norm, ms)));
  await writeFile(`${OUT}/${name}.html`, skeleton(html, { name }));
}
