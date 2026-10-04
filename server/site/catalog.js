// Product archives (shop, categories, brands, tags, search) rendered like WooCommerce + Anvogue.
import { templateFile } from './files.js';
import { readFile } from 'node:fs/promises';
import { query } from '../db.js';
import { esc, fill } from './html.js';
import { cached, categories, productsByIds } from './data.js';
import { productCard } from './product-card.js';
import { attributeTaxonomies } from './variations.js';

const PER_PAGE = 32;
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
// MySQL utf8mb4_unicode_ci ordering: case/accent-insensitive, straight quote before typographic quote
const collator = new Intl.Collator('en', { sensitivity: 'base' });
const sortKey = (s) => String(s || '').replace(/[’‘]/g, '"');
const byName = (a, b) => collator.compare(sortKey(a), sortKey(b));

let tpl;
async function template() {
  if (!tpl) tpl = await readFile(templateFile('archive.main.tpl.html'), 'utf8');
  return tpl;
}

/** Ids of a category and all its descendants */
export function descendants(cats, id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of cats) if (c.parent_id === out[i]) out.push(c.id);
  return out;
}

export function categoryPath(cats, cat) {
  const chain = [];
  let c = cat;
  let guard = 0;
  while (c && guard++ < 10) { chain.unshift(c); c = cats.find((x) => x.id === c.parent_id); }
  return chain;
}
export const categoryUrl = (cats, cat) => `/product-category/${categoryPath(cats, cat).map((c) => c.slug).join('/')}/`;

/** Every product visible in the shop, with what sorting and filtering need (cached briefly). */
async function visibleProducts() {
  return cached('visible-products', 20000, async () => {
    const rows = await query(`
      select p.id, p.type, p.menu_order, coalesce(p.meta->>'wp_name', p.name) sort_name, p.name, p.catalog_visibility,
        lower(p.name || ' ' || coalesce(p.short_description, '') || ' ' || coalesce(p.description, '')) haystack, lower(p.name) lname,
        p.total_sales, p.average_rating::float8, p.rating_count, p.created_at, p.attributes,
        coalesce(p.sale_price, p.regular_price)::float8 simple_price, p.regular_price::float8, p.sale_price::float8, p.sale_from, p.sale_to,
        (select min(coalesce(case when v.sale_price is not null and v.sale_price < coalesce(v.regular_price, p.regular_price) then v.sale_price end, v.regular_price, p.regular_price))::float8
           from variations v where v.product_id = p.id and v.status = 'publish' and v.stock_status <> 'outofstock') var_min,
        (select max(coalesce(case when v.sale_price is not null and v.sale_price < coalesce(v.regular_price, p.regular_price) then v.sale_price end, v.regular_price, p.regular_price))::float8
           from variations v where v.product_id = p.id and v.status = 'publish' and v.stock_status <> 'outofstock') var_max,
        coalesce((select array_agg(category_id) from product_categories where product_id = p.id), '{}') cats,
        coalesce((select array_agg(brand_id) from product_brands where product_id = p.id), '{}') brands,
        coalesce((select array_agg(tag_id) from product_tags where product_id = p.id), '{}') tags
      from products p
      where p.status = 'publish' and p.online_visible and p.stock_status <> 'outofstock'`);
    const now = Date.now();
    return rows.map((r) => {
      let min = r.var_min, max = r.var_max;
      if (r.type !== 'variable') {
        const onSale = r.sale_price != null && r.sale_price < r.regular_price
          && (!r.sale_from || new Date(r.sale_from).getTime() <= now) && (!r.sale_to || new Date(r.sale_to).getTime() >= now);
        min = max = onSale ? r.sale_price : r.regular_price;
      }
      return { ...r, min_price: min, max_price: max, attributes: json(r.attributes) || [] };
    });
  });
}

const ORDERBY = ['menu_order', 'popularity', 'rating', 'date', 'price', 'price-desc'];

function sortProducts(list, orderby, search) {
  const s = [...list];
  const desc = (k) => (a, b) => (b[k] ?? -Infinity) - (a[k] ?? -Infinity);
  switch (orderby) {
    case 'popularity': return s.sort((a, b) => desc('total_sales')(a, b) || b.id - a.id);
    case 'rating': return s.sort((a, b) => desc('average_rating')(a, b) || desc('rating_count')(a, b) || b.id - a.id);
    case 'date': return s.sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id);
    case 'price': return s.sort((a, b) => (a.min_price ?? Infinity) - (b.min_price ?? Infinity) || a.id - b.id);
    case 'price-desc': return s.sort((a, b) => (b.max_price ?? -Infinity) - (a.max_price ?? -Infinity) || b.id - a.id);
    case 'relevance': {
      // WordPress search relevance: full phrase in title, all words in title, any word in title, then newest
      const phrase = search.toLowerCase();
      const words = phrase.split(/\s+/).filter(Boolean);
      const score = (p) => (p.lname.includes(phrase) ? 4 : 0) + (words.every((w) => p.lname.includes(w)) ? 2 : 0) + (words.some((w) => p.lname.includes(w)) ? 1 : 0);
      return s.sort((a, b) => score(b) - score(a) || new Date(b.created_at) - new Date(a.created_at) || b.id - a.id);
    }
    // default sorting: the shop's manual order first, then newest products first (asked by the shop instead of A–Z)
    default: return s.sort((a, b) => a.menu_order - b.menu_order || new Date(b.created_at) - new Date(a.created_at) || b.id - a.id);
  }
}

/**
 * q: { category, brand, tag, search, orderby, page, min_price, max_price, filter_size }
 * Returns the products of the page and everything the archive page needs.
 */
export async function queryCatalog(q) {
  const all = await visibleProducts();
  const cats = await categories();
  let list = all.filter((p) => (q.search != null ? ['visible', 'search'] : ['visible', 'catalog']).includes(p.catalog_visibility));
  if (q.category) {
    const ids = new Set(descendants(cats, q.category.id));
    list = list.filter((p) => p.cats.some((c) => ids.has(c)));
  }
  if (q.brand) list = list.filter((p) => p.brands.includes(q.brand.id));
  if (q.tag) list = list.filter((p) => p.tags.includes(q.tag.id));
  if (q.search != null) {
    const words = q.search.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter((p) => words.every((w) => p.haystack.includes(w)));
  }
  // the price widget shows the range before the price filter itself is applied
  const beforePrice = list;
  const taxonomies = await attributeTaxonomies();
  const sizeTax = [...taxonomies.values()].find((t) => t.slug === 'pa_size');
  const sizeOf = (p) => p.attributes.filter((a) => Number(a.id) === sizeTax?.id).flatMap((a) => a.options);
  if (q.filter_size && sizeTax) {
    const wanted = q.filter_size.split(',');
    const names = sizeTax.terms.filter((t) => wanted.includes(t.slug)).map((t) => t.name);
    list = list.filter((p) => sizeOf(p).some((o) => names.includes(o)));
  }
  if (q.min_price != null || q.max_price != null) {
    const lo = Number(q.min_price ?? 0), hi = Number(q.max_price ?? Infinity);
    list = list.filter((p) => p.max_price != null && p.max_price >= lo && p.min_price <= hi);
  }
  const orderby = ORDERBY.includes(q.orderby) ? q.orderby : (q.search != null && !q.orderby ? 'relevance' : 'menu_order');
  const sorted = sortProducts(list, orderby, q.search || '');
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, q.page || 1), pages);
  const ids = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((p) => p.id);
  const prices = beforePrice.map((p) => [p.min_price, p.max_price]).flat().filter((x) => x != null);
  const sizeNames = new Set(beforePrice.flatMap(sizeOf));
  return {
    total, pages, page, orderby, products: await productsByIds(ids),
    priceRange: prices.length ? [Math.floor(Math.min(...prices) / 10) * 10, Math.ceil(Math.max(...prices) / 10) * 10] : [0, 0],
    sizes: sizeTax ? sizeTax.terms.filter((t) => sizeNames.has(t.name)).sort((a, b) => byName(a.name, b.name)) : [],
  };
}

// ---------------------------------------------------------------- HTML pieces

const VIEWS = [['grid-two-col', '2 Columns'], ['grid-three-col', '3 Columns'], ['grid-four-col', '4 Columns'], ['grid-list', 'List']];
const GRID_CLASS = { 'grid-two-col': 'grid-view grid-col-xl-2', 'grid-three-col': 'grid-view grid-col-xl-3', 'grid-four-col': 'grid-view grid-col-xl-4', 'grid-list': 'list-view grid-col-xl-3' };

/** URL with extra query args, escaped like esc_url (& → &#038;) */
const withArg = (url, arg) => `${url}${url.includes('?') ? '&' : '?'}${arg}`.replace(/&/g, '&#038;');

function productsView(currentUrl, view) {
  return `<div class="pls-products-view">\r\n${VIEWS.map(([v, label]) => `\t\t\t\t\t\t\t<a class="pls-tooltip ${v} ${v === view ? 'active' : ''}" data-shopview="${v}" href="${withArg(currentUrl, `view=${v}`)}">${label}</a>\r\n`).join('')}\t\t\t\t\t</div>`;
}

function orderbyOptions(orderby) {
  const labels = [['menu_order', 'Default'], ['popularity', 'Popularity'], ['rating', 'Average rating'], ['date', 'Latest'], ['price', 'Price: low to high'], ['price-desc', 'Price: high to low']];
  return labels.map(([v, l]) => `\t\t\t\t\t<option value="${v}" ${v === orderby ? " selected='selected'" : ''}>${l}</option>\n`).join('');
}

function resultCount(total, page) {
  if (total === 1) return '\tShowing the single Product';
  if (total <= PER_PAGE) return `\tShowing all ${total} Products`;
  const first = (page - 1) * PER_PAGE + 1;
  return `\t${first}–${Math.min(total, page * PER_PAGE)} Products of ${total} Products`;
}

/** paginate_links() with end_size 2 and mid_size 2, like the theme */
function pagination(base, query, page, pages) {
  if (pages < 2) return '';
  const link = (n) => `${base}page/${n}/${query}`;
  const items = [];
  if (page > 1) items.push(`\t<li><a class="prev page-numbers" href="${link(page - 1)}">Previous</a></li>`);
  let dots = false;
  for (let n = 1; n <= pages; n++) {
    if (n === page) { items.push(`\t<li><span aria-label="Page ${n}" aria-current="page" class="page-numbers current">${n}</span></li>`); dots = true; continue; }
    if (n <= 2 || n > pages - 2 || (n >= page - 2 && n <= page + 2)) { items.push(`\t<li><a aria-label="Page ${n}" class="page-numbers" href="${link(n)}">${n}</a></li>`); dots = true; }
    else if (dots) { items.push('\t<li><span class="page-numbers dots">&hellip;</span></li>'); dots = false; }
  }
  if (page < pages) items.push(`\t<li><a class="next page-numbers" href="${link(page + 1)}">Next</a></li>`);
  return `<div class="pls-pagination default"  aria-label="Product Pagination">\n\t<ul class='page-numbers'>\n${items.join('\n')}\n</ul>\n</div>`;
}

function sizeWidget(action, sizes, selected) {
  if (!sizes.length) return '';
  const opts = sizes.map((t) => `<option value="${esc(t.slug)}" ${t.slug === selected ? 'selected="selected"' : ''}>${esc(t.name)}</option>`).join('');
  return `<div id="woocommerce_layered_nav-3" class="widget woocommerce widget_layered_nav woocommerce-widget-layered-nav"><h3 class="widget-title">Filter by</h3><form method="get" action="${action}" class="woocommerce-widget-layered-nav-dropdown"><select class="woocommerce-widget-layered-nav-dropdown dropdown_layered_nav_size"><option value="">Any Size</option>${opts}</select><input type="hidden" name="filter_size" value="${esc(selected || '')}" /></form></div>`;
}

function priceWidget(action, [min, max], q) {
  return `<div id="woocommerce_price_filter-2" class="widget woocommerce widget_price_filter"><h3 class="widget-title">Price Range</h3>
<form method="get" action="${action}">
\t<div class="price_slider_wrapper">
\t\t<div class="price_slider" style="display:none;"></div>
\t\t<div class="price_slider_amount" data-step="10">
\t\t\t<label class="screen-reader-text" for="min_price">Min price</label>
\t\t\t<input type="text" id="min_price" name="min_price" value="${q.min_price ?? min}" data-min="${min}" placeholder="Min price" />
\t\t\t<label class="screen-reader-text" for="max_price">Max price</label>
\t\t\t<input type="text" id="max_price" name="max_price" value="${q.max_price ?? max}" data-max="${max}" placeholder="Max price" />
\t\t\t${q.filter_size ? `<input type="hidden" name="filter_size" value="${esc(q.filter_size)}" />` : ''}\t\t\t<button type="submit" class="button">Filter</button>
\t\t\t<div class="price_label" style="display:none;">
\t\t\t\tPrice: <span class="from"></span> &mdash; <span class="to"></span>
\t\t\t</div>
\t\t\t\t\t\t<div class="clear"></div>
\t\t</div>
\t</div>
</form>

</div>`;
}

/** WooCommerce product categories widget with counts of visible products (children included). */
async function categoriesWidget(current) {
  const cats = (await categories()).filter((c) => c.visible && c.slug !== 'uncategorized');
  const counts = await cached('category-counts', 20000, async () => {
    const all = await visibleProducts();
    const allCats = await categories();
    const m = new Map();
    for (const c of allCats) {
      const ids = new Set(descendants(allCats, c.id));
      m.set(c.id, all.filter((p) => ['visible', 'catalog'].includes(p.catalog_visibility) && p.cats.some((x) => ids.has(x))).length);
    }
    return m;
  });
  // WordPress hides a category only when no published product at all is in it (hidden ones count)
  const published = await cached('category-published', 20000, async () => {
    const rows = await query("select distinct pc.category_id from product_categories pc join products p on p.id = pc.product_id where p.status = 'publish'");
    const direct = new Set(rows.map((r) => r.category_id));
    const allCats = await categories();
    return new Set(allCats.filter((x) => descendants(allCats, x.id).some((d) => direct.has(d))).map((x) => x.id));
  });
  const ancestors = current ? categoryPath(cats, current).slice(0, -1).map((c) => c.id) : [];
  const kids = new Map();
  for (const c of cats) { const k = c.parent_id || 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(c); }
  for (const l of kids.values()) l.sort((a, b) => byName(a.name, b.name));
  const walk = (pid, depth) => (kids.get(pid) || []).filter((c) => published.has(c.id)).map((c) => {
    const hasKids = (kids.get(c.id) || []).some((k) => published.has(k.id));
    let cls = `cat-item cat-item-${c.id}`;
    if (current?.id === c.id) cls += ' current-cat';
    if (hasKids) cls += ' cat-parent';
    if (ancestors.includes(c.id)) cls += ' current-cat-parent';
    let out = `<li class="${cls}"><a href="${categoryUrl(cats, c)}">${esc(c.name)}</a> <span class="count">(${counts.get(c.id) || 0})</span></span>`;
    if (hasKids) {
      const indent = '\t'.repeat(depth);
      out += `${indent}<ul class='children'>\n${walk(c.id, depth + 1)}${indent}</ul>\n`;
    }
    return `${out}</li>\n`;
  }).join('');
  return `<div id="woocommerce_product_categories-2" class="widget woocommerce widget_product_categories"><h3 class="widget-title">Products Type</h3><ul class="product-categories">${walk(0, 0)}</ul></div>`;
}

/**
 * Renders the <main> of an archive.
 * ctx: { title, breadcrumb (html), base (path without page), q (filters), currentUrl, search }
 */
export async function renderArchive(ctx) {
  const { q } = ctx;
  const res = await queryCatalog(q);
  const view = VIEWS.some(([v]) => v === q.view) ? q.view : 'grid-three-col';
  const images = { count: 0 };
  const cards = res.products.map((p, i) => productCard(p, { position: i, columns: 4, images, currentUrl: ctx.currentUrl, list: view === 'grid-list' })).join('');
  const gridOpen = `<div class="products products-wrap product-style-5  row ${GRID_CLASS[view]} grid-col-lg-3 grid-col-md-2 grid-col-2 has-quick-shop pls-variation-on-hover">\n\n`;
  const products = res.products.length
    ? `${gridOpen}${cards}\t</div>\n${pagination(ctx.base, ctx.pageQuery || '', res.page, res.pages)}`
    : '<div class="woocommerce-no-products-found">\n\t\n\t<div class="woocommerce-info" role="status">\n\t\tNo products were found matching your selection.\t</div>\n</div>\n';
  const hidden = ctx.search != null ? `<input type="hidden" name="s" value="${esc(ctx.search)}" /><input type="hidden" name="post_type" value="product" />` : '';
  const sidebar = `\t\t${sizeWidget(ctx.base, res.sizes, q.filter_size)}${priceWidget(ctx.base, res.priceRange, q)}${await categoriesWidget(q.category)}`;
  return {
    res,
    html: fill(await template(), {
      page_title: esc(ctx.title),
      breadcrumb: ctx.breadcrumb,
      products_view: productsView(ctx.currentUrl, view),
      orderby_options: orderbyOptions(res.orderby === 'relevance' ? '' : res.orderby),
      ordering_hidden: `<input type="hidden" name="paged" value="1" />\n\t${hidden}`,
      result_count: resultCount(res.total, res.page),
      products,
      sidebar,
    }),
  };
}

export const breadcrumbHtml = (items) => `<nav class="pls-breadcrumb">${items.map((it, i) => (i === items.length - 1
  ? `<span class="last">${it.title}</span>`
  : `<a href="${it.url}">${it.title}</a><span class="pls-delimiter-sep pls-greater-than"></span>`)).join('')}</nav>`;
