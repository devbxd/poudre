import { readFile } from 'node:fs/promises';
import { query } from '../server/db.js';
import { renderMenu, renderCategorySelect } from '../server/site/menus.js';
import { compare } from './compare-fragment.mjs';

const norm = (h) => h.replaceAll('https://poudrebeauty.com/', '/');
const html = norm(await readFile('data/original/html/shop.html', 'utf8'));
const grab = (needle) => {
  const i = html.indexOf(needle);
  const start = html.lastIndexOf('<', i);
  const { elementEnd } = globalThis;
  return html.slice(start, elementEnd(html, start));
};
const { elementEnd } = await import('./extract-templates-lib.mjs');
globalThis.elementEnd = elementEnd;
const menus = await query('select * from menus');
const byLoc = Object.fromEntries(menus.map((m) => [m.location, typeof m.items === 'string' ? JSON.parse(m.items) : m.items]));
compare('topbar', grab('id="menu-topbar-menu"'), renderMenu(byLoc['topbar-menu'], { id: 'menu-topbar-menu', className: 'menu', style: 'plain' }));
compare('primary', grab('id="menu-primary-menu"'), renderMenu(byLoc.primary, { id: 'menu-primary-menu', className: 'menu' }));
compare('mobile', grab('id="menu-primary-menu-1"'), renderMenu(byLoc.primary, { id: 'menu-primary-menu-1', className: 'mobile-main-menu', style: 'mobile' }));
const cats = await query(`select c.*, (select count(*)::int from product_categories pc join products p on p.id = pc.product_id where pc.category_id = c.id and p.status = 'publish') total_count from categories c`);
const sel = grab("<select  name='product_cat'");
compare('select', sel.replace(/id='product-cat-\d+'/, "id='product-cat-1'"), renderCategorySelect(cats));
process.exit(0);
