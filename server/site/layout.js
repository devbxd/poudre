// Fills a page skeleton (header, menus, footer, scripts) around the rendered main content.
import { readFile } from 'node:fs/promises';
import { fill, esc } from './html.js';
import { categories, menus, cached } from './data.js';
import { renderMenu, renderCategorySelect } from './menus.js';

const skeletons = new Map();
export async function skeleton(name) {
  if (!skeletons.has(name)) skeletons.set(name, await readFile(new URL(`../../site/templates/${name}.html`, import.meta.url), 'utf8'));
  return skeletons.get(name);
}

let popupBlock;
async function searchPopupBlock() {
  // the "trending products" block of the search popup is kept as on the original site for now
  if (popupBlock === undefined) popupBlock = await readFile(new URL('../../site/templates/search_popup_block.html', import.meta.url), 'utf8').catch(() => '');
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
  const html = fill(tpl, {
    title: `${esc(page.title)} &#8211; Poudre Beauty`,
    head: page.head || '',
    body_class: page.bodyClass,
    header_class: page.headerClass || 'pls-site-header pls-header-2 pls-header-icon-2 header-sticky',
    ...menusHtml,
    search_popup_block: await searchPopupBlock(),
    main: page.main,
    path: esc(page.path || '/'),
  });
  // each search form gets its own select id, like WordPress
  return html.replace(/<!--@search_categories-->/g, () => menusHtml.search_categories.replace("id='product-cat-1'", `id='product-cat-${++selects}'`));
}

function buildMenus(menuSets, cats, ctx) {
  return {
    menu_topbar: renderMenu(menuSets['topbar-menu'] || [], { id: 'menu-topbar-menu', className: 'menu', style: 'plain', ctx }),
    menu_primary: renderMenu(menuSets.primary || [], { id: 'menu-primary-menu', className: 'menu', ctx }),
    menu_mobile: renderMenu(menuSets.primary || [], { id: 'menu-primary-menu-1', className: 'mobile-main-menu', style: 'mobile', ctx }),
    menu_mobile_categories: renderMenu(menuSets.primary || [], { id: 'menu-primary-menu-2', className: 'mobile-main-menu', style: 'mobile', ctx }),
    search_categories: renderCategorySelect(cats),
  };
}
