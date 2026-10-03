// Renders navigation menus with the exact markup of the WordPress walker used by the theme.
import { esc, decodeEntities } from './html.js';

const TAXONOMIES = new Set(['product_cat', 'category', 'product_tag', 'product_brand']);
const itemType = (it) => (it.type === 'custom' || !it.type ? 'custom' : TAXONOMIES.has(it.type) ? 'taxonomy' : 'post_type');
const objectName = (it) => (itemType(it) === 'custom' ? 'custom' : it.type);

/**
 * Current-page classes as WordPress adds them.
 * ctx: { objectType: 'product_cat'|'page'|..., objectId, ancestors: [ids of parent terms], productCats: [cat ids] }
 */
function currentClasses(it, ctx, hasCurrentChild, isParentOfCurrent) {
  const out = [];
  if (!ctx) return out;
  const type = objectName(it);
  if (ctx.objectType === type && Number(it.object_id) === Number(ctx.objectId)) out.push('current-menu-item');
  if (ctx.productCats && type === 'product_cat' && ctx.productCats.includes(Number(it.object_id))) out.push('current-product-ancestor', 'current-menu-parent', 'current-product-parent');
  else if (ctx.productAncestors && type === 'product_cat' && ctx.productAncestors.includes(Number(it.object_id))) out.push('current-product-ancestor');
  if (ctx.objectType === 'product_cat' && type === 'product_cat' && ctx.ancestors?.includes(Number(it.object_id))) out.push('current-product_cat-ancestor');
  if (hasCurrentChild) out.push('current-menu-ancestor');
  if (isParentOfCurrent) out.push('current-menu-parent');
  if (ctx.objectType === 'product_cat' && type === 'product_cat' && ctx.ancestors?.length && Number(it.object_id) === ctx.ancestors[ctx.ancestors.length - 1]) out.push('current-product_cat-parent');
  return out;
}

const isCurrent = (it, ctx) => ctx && objectName(it) === ctx.objectType && Number(it.object_id) === Number(ctx.objectId);
const containsCurrent = (it, ctx) => (it.children || []).some((c) => isCurrent(c, ctx) || containsCurrent(c, ctx));

/** style: 'desktop' (theme walker with ids), 'mobile' (theme mobile walker), 'plain' (default WP walker, topbar) */
export function renderMenu(items, { id, className, style = 'desktop', ctx = null }) {
  const walk = (list, depth) => list.map((it) => {
    const indent = '\t'.repeat(depth);
    const kids = it.children || [];
    const hasCurrentChild = containsCurrent(it, ctx);
    const isParent = kids.some((c) => isCurrent(c, ctx));
    const classes = ['menu-item', `menu-item-type-${itemType(it)}`, `menu-item-object-${objectName(it)}`,
      ...currentClasses(it, ctx, hasCurrentChild, isParent),
      ...(kids.length ? ['menu-item-has-children'] : []), `menu-item-${it.id}`];
    if (style !== 'plain') classes.push(`item-level-${depth}`);
    const idAttr = style === 'mobile' ? '' : ` id="menu-item-${it.id}"`;
    // WordPress' stored title (entities included) is used until the title is edited in the dashboard
    const raw = it.raw_title && decodeEntities(it.raw_title) === it.title ? it.raw_title : null;
    const title = raw ?? (style === 'plain' ? esc(it.title).replace(/&amp;/g, '&#038;') : esc(it.title));
    const link = style === 'plain'
      ? `<a href="${esc(it.url)}">${title}</a>`
      : `<a href="${esc(it.url)}" class="nav-link"><span class="pls-menu-text">${title}</span></a>`;
    let html = `${indent}<li${idAttr} class="${classes.join(' ')}">${link}`;
    if (kids.length) {
      const inner = walk(kids, depth + 1);
      html += style === 'mobile'
        ? `<div class="pls-mobile-submenu"><span class="pls-menu-back">Back</span>\n${indent}<ul class="sub-menu">\n${inner}${indent}</ul>\n</div>`
        : `\n${indent}<ul class="sub-menu">\n${inner}${indent}</ul>\n`;
    }
    return `${html}</li>\n`;
  }).join('');
  return `<ul id="${id}" class="${className}">${walk(items, 0)}</ul>`;
}

/** <select> of product categories used by the search forms (wp_dropdown_categories, hierarchical, hide empty). */
export function renderCategorySelect(categories, { id = 'product-cat-1', selected = '' } = {}) {
  const kids = new Map();
  for (const c of categories) {
    if (!c.visible || c.slug === 'uncategorized') continue;
    const k = c.parent_id || 0;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(c);
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  let out = `<select  name='product_cat' id='${id}' class='categories-filter product_cat'>\n\t<option value=''>All Categories</option>\n`;
  const walk = (pid, depth) => {
    for (const c of kids.get(pid) || []) {
      if (!c.total_count) continue;
      out += `\t<option class="level-${depth}" value="${esc(c.slug)}"${c.slug === selected ? ' selected="selected"' : ''}>${'&nbsp;'.repeat(depth * 3)}${esc(c.name)}</option>\n`;
      walk(c.id, depth + 1);
    }
  };
  walk(0, 0);
  return `${out}</select>`;
}
