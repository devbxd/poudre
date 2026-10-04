// Fills a page skeleton (header, menus, footer, scripts) around the rendered main content.
import { templateFile } from './files.js';
import { readFile } from 'node:fs/promises';
import { fill, esc } from './html.js';
import { categories, menus, cached } from './data.js';
import { renderMenu, renderCategorySelect } from './menus.js';
import { visitorVars } from './visitor.js';

const skeletons = new Map();
export async function skeleton(name) {
  if (!skeletons.has(name)) skeletons.set(name, await readFile(templateFile(`${name}.html`), 'utf8'));
  return skeletons.get(name);
}

let popupBlock;
async function searchPopupBlock() {
  // the "trending products" block of the search popup is kept as on the original site for now
  if (popupBlock === undefined) popupBlock = await readFile(templateFile('search_popup_block.html'), 'utf8').catch(() => '');
  return popupBlock;
}

/**
 * page: { template, title, main, bodyClass, headerClass, head, path, menuCtx }
 */
export async function renderPage(page) {
  const [tpl, menuSets, cats] = await Promise.all([skeleton(page.template), menus(), categories()]);
  const ctx = page.menuCtx || null;
  const key = ctx ? null : 'menus-default';
  const menusHtml = key
    ? await cached(key, 30000, async () => buildMenus(menuSets, cats, null))
    : buildMenus(menuSets, cats, ctx);
  let selects = 0;
  let html = fill(withMobileCart(tpl), {
    title: `${esc(page.title)} &#8211; Poudre Beauty`,
    head: page.head || '',
    body_class: page.bodyClass,
    header_class: page.headerClass || 'pls-site-header pls-header-2 pls-header-icon-2 header-sticky',
    ...menusHtml,
    search_popup_block: await searchPopupBlock(),
    main: page.main,
    path: esc(page.path || '/'),
    ...(page.c ? await visitorVars(page.c) : {}),
    ...(page.vars || {}),
  });
  // each search form gets its own select id, like WordPress
  html = html.replace(/<!--@search_categories-->/g, () => menusHtml.search_categories.replace("id='product-cat-1'", `id='product-cat-${++selects}'`));
  return /variations_form|has-quick-shop/.test(html) ? withVariationScripts(html) : html;
}

/** Menu items linking to a category hidden from the website are left out (with their sub-items) */
function withoutHidden(items, hidden) {
  return items.filter((it) => !(it.type === 'product_cat' && hidden.has(Number(it.object_id))))
    .map((it) => (it.children?.length ? { ...it, children: withoutHidden(it.children, hidden) } : it));
}

function buildMenus(allMenuSets, cats, ctx) {
  const hidden = new Set(cats.filter((c) => !c.visible).map((c) => c.id));
  const menuSets = hidden.size ? Object.fromEntries(Object.entries(allMenuSets).map(([k, v]) => [k, withoutHidden(v, hidden)])) : allMenuSets;
  return {
    menu_topbar: renderMenu(menuSets['topbar-menu'] || [], { id: 'menu-topbar-menu', className: 'menu', style: 'plain', ctx }),
    menu_primary: renderMenu(menuSets.primary || [], { id: 'menu-primary-menu', className: 'menu', ctx }),
    menu_mobile: renderMenu(menuSets.primary || [], { id: 'menu-primary-menu-1', className: 'mobile-main-menu', style: 'mobile', ctx }),
    menu_mobile_categories: renderMenu(menuSets.primary || [], { id: 'menu-primary-menu-2', className: 'mobile-main-menu', style: 'mobile', ctx }),
    search_categories: renderCategorySelect(cats),
  };
}

// WooCommerce variation scripts (choosing an option swaps photo, price and stock; quick shop on product cards).
// WordPress only printed them on product-with-options pages; the captured skeletons do not all have them.
let variationParts;
const NO_JS = "c = c.replace(/woocommerce-no-js/, 'woocommerce-js');\n\t\t\tdocument.body.className = c;\n\t\t})();\n\t</script>";
async function withVariationScripts(html) {
  if (html.includes('add-to-cart-variation.min.js')) return html;
  variationParts ??= await Promise.all(['variation_tmpl.html', 'variation_scripts.html'].map((f) => readFile(templateFile(f), 'utf8')));
  const [tmpl, scripts] = variationParts;
  return html.replace(NO_JS, () => `${NO_JS}\n${tmpl}`)
    .replace(/(<script id="popup-maker-site-js" src="[^"]*"><\/script>)/, (m) => `${m}\n${scripts}`);
}


// The theme's phone header only had search + account: the cart icon (with its counter) is added next to them,
// same markup as the desktop one so the theme's mini cart opens the same way.
const MOBILE_END = '\t</div>\t</div>\n</div>\t\t\t<!-- End Mobile Header-->';
const MOBILE_CART = `\n<div class="pls-header-cart pls-cart-icon-1 pdr-mobile-cart">\n\t<a href="/cart/" aria-label="Header Cart">\t\t\n\t\t\t\t<div class="pls-header-cart-icon">\n\t\t\t\t\t<!--@cart_count-->\n\t\t\t\t</div>\n\t</a>\t\n</div>`;
const withMobileCart = (tpl) => (tpl.includes(MOBILE_END) && !tpl.includes('pdr-mobile-cart')
  ? tpl.replace(MOBILE_END, `\t</div>${MOBILE_CART}\t</div>\n</div>\t\t\t<!-- End Mobile Header-->`)
  : tpl);
