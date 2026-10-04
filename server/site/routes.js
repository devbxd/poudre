// Public website routes (same URLs as the WordPress site).
import { Hono } from 'hono';
import { query } from '../db.js';
import { esc } from './html.js';
import { categories } from './data.js';
import { renderPage } from './layout.js';
import { renderArchive, breadcrumbHtml, categoryPath, categoryUrl } from './catalog.js';
import { renderProduct, stickyBar, schemaJson } from './product-page.js';
import { renderHome } from './home.js';
import { registerPages } from './pages.js';
import { decodeEntities } from './html.js';

export const site = new Hono();

const THEME_CLASSES = 'wp-embed-responsive wp-theme-anvogue theme-anvogue';
const PLS_CLASSES = 'pls-widget-default pls-widget-toggle pls-widget-menu-toggle pls-product-hover-mobile pls-slider-navigation-mobile pls-product-image-radio3x4 pls-mobile-canvas-sidebar pls-slider-nav-circle';
const OVERLAY_HEADER = 'pls-site-header pls-header-2 pls-header-icon-2 header-sticky pls-header-overlay header-color-dark';

export const bodyClass = (before, { woo = 'woocommerce woocommerce-page', layout = 'pls-no-sidebar', after = '', tail = 'elementor-default elementor-kit-8' } = {}) =>
  [before, THEME_CLASSES, woo, 'woocommerce-no-js eio-default pls-wrapper-full pls-theme-skin-light', layout, PLS_CLASSES, after, tail].filter(Boolean).join(' ');

/** Query args kept on pagination links (everything except paging) */
function keptQuery(c, drop = ['paged', 'product-page']) {
  const u = new URL(c.req.url);
  for (const k of drop) u.searchParams.delete(k);
  const s = u.searchParams.toString();
  return s ? `?${s}` : '';
}

function filters(c, page) {
  const q = c.req.query();
  return {
    page,
    orderby: q.orderby,
    view: q.view,
    min_price: q.min_price !== undefined && q.min_price !== '' ? Number(q.min_price) : undefined,
    max_price: q.max_price !== undefined && q.max_price !== '' ? Number(q.max_price) : undefined,
    filter_size: q.filter_size || undefined,
  };
}

const currentUrl = (c) => { const u = new URL(c.req.url); return u.pathname + u.search; };

async function archivePage(c, { title, titleTag = title, woo, crumbs, base, q, before, menuCtx, search }) {
  const { html, res } = await renderArchive({
    title, breadcrumb: breadcrumbHtml(crumbs), base, q, search,
    currentUrl: currentUrl(c), pageQuery: keptQuery(c),
  });
  if (q.page > res.pages && res.total > 0) return c.notFound();
  const page = await renderPage({ c,
    template: 'archive', title: res.page > 1 ? `${titleTag} &#8211; Page ${res.page}` : titleTag, main: html, path: new URL(c.req.url).pathname,
    bodyClass: bodyClass(before, { woo: woo || 'woocommerce woocommerce-page', layout: 'pls-has-sidebar left-sidebar pls-catalog-ajax-filter', after: 'pls-catalog-page' }),
    headerClass: OVERLAY_HEADER, menuCtx,
  });
  return c.html(page);
}

const HOME = { title: 'Home', url: '/' };
const SHOP = { title: 'Products', url: '/shop/' };

// ---------------- Shop
const shop = async (c) => {
  const page = Number(c.req.param('page') || 1);
  const s = c.req.query('s');
  return archivePage(c, {
    title: 'Products', titleTag: 'Shop', woo: 'woocommerce-shop woocommerce woocommerce-page', crumbs: [HOME, { title: 'Products' }], base: '/shop/', q: filters(c, page),
    before: 'archive post-type-archive post-type-archive-product', menuCtx: null,
    ...(s != null ? { search: s } : {}),
  }).then((r) => r);
};
site.get('/shop/', shop);
site.get('/shop/page/:page{[0-9]+}/', shop);

// ---------------- Search (/?s=…&post_type=product)
export async function searchPage(c) {
  const s = (c.req.query('s') || '').trim();
  const page = Number(c.req.query('paged') || 1);
  return archivePage(c, {
    title: `Search Results: ${s}`, woo: 'woocommerce-shop woocommerce woocommerce-page', crumbs: [HOME, SHOP, { title: `Search - ${esc(s)}` }], base: '/', q: { ...filters(c, page), search: s }, search: s,
    before: 'archive search search-results post-type-archive post-type-archive-product', menuCtx: null,
  });
}

// ---------------- Categories (/product-category/parent/child/[page/N/])
site.get('/product-category/*', async (c) => {
  const parts = c.req.path.replace(/^\/product-category\//, '').split('/').filter(Boolean);
  let page = 1;
  if (parts.length >= 2 && parts[parts.length - 2] === 'page' && /^\d+$/.test(parts[parts.length - 1])) { page = Number(parts.pop()); parts.pop(); }
  const cats = await categories();
  const cat = cats.find((x) => x.slug === parts[parts.length - 1] && x.visible);
  if (!cat) return c.notFound();
  const canonical = categoryUrl(cats, cat);
  if (!c.req.path.startsWith(canonical)) return c.redirect(canonical + (page > 1 ? `page/${page}/` : '') + keptQuery(c, []), 301);
  const chain = categoryPath(cats, cat);
  const crumbs = [HOME, SHOP, ...chain.slice(0, -1).map((x) => ({ title: esc(x.name), url: categoryUrl(cats, x) })), { title: esc(cat.name) }];
  return archivePage(c, {
    title: cat.name, crumbs, base: canonical, q: { ...filters(c, page), category: cat },
    before: `archive tax-product_cat term-${cat.slug} term-${cat.id}`,
    menuCtx: { objectType: 'product_cat', objectId: cat.id, ancestors: chain.slice(0, -1).map((x) => x.id) },
  });
});

// ---------------- Brands and tags
for (const [prefix, table, link, tax] of [['brand', 'brands', 'product_brands', 'product_brand'], ['product-tag', 'tags', 'product_tags', 'product_tag']]) {
  const handler = async (c) => {
    const [row] = await query(`select * from ${table} where slug = $1`, [c.req.param('slug')]);
    if (!row || row.visible === false) return c.notFound();
    const page = Number(c.req.param('page') || 1);
    return archivePage(c, {
      title: row.name, crumbs: [HOME, SHOP, { title: esc(row.name) }], base: `/${prefix}/${row.slug}/`,
      q: { ...filters(c, page), [table === 'brands' ? 'brand' : 'tag']: row },
      before: `archive tax-${tax} term-${row.slug} term-${row.id}`, menuCtx: null,
    });
  };
  void link;
  site.get(`/${prefix}/:slug/`, handler);
  site.get(`/${prefix}/:slug/page/:page{[0-9]+}/`, handler);
}

// ---------------- Homepage
site.get('/', async (c) => {
  const html = await renderPage({ c,
    template: 'home', title: 'Poudre Beauty', main: await renderHome(), path: '/',
    bodyClass: bodyClass('home wp-singular page-template-default page page-id-27', { woo: '', tail: 'elementor-default elementor-kit-8 elementor-page elementor-page-27' }),
    menuCtx: { objectType: 'page', objectId: 27 },
  });
  return c.html(html.replace('<title>Poudre Beauty &#8211; Poudre Beauty</title>', '<title>Poudre Beauty</title>'));
});

// ---------------- Single product
site.get('/product/:slug/', async (c) => {
  const preview = c.req.query('preview') === '1';
  const r = await renderProduct(c.req.param('slug'), { currentUrl: currentUrl(c), preview });
  if (!r) return c.notFound();
  const p = r.product;
  const siteUrl = process.env.SITE_URL || new URL(c.req.url).origin;
  const html = await renderPage({ c,
    template: 'product', title: decodeEntities(p.name), main: r.html, path: new URL(c.req.url).pathname,
    bodyClass: bodyClass(`wp-singular product-template-default single single-product postid-${p.id}`, { after: 'product-thumbnail-overlay  pls-single-product-quick-buy' }),
    menuCtx: { objectType: 'product', objectId: p.id, productCats: r.categories.map((x) => x.id), productAncestors: r.chain.map((x) => x.id) },
    head: `<link rel="canonical" href="${siteUrl}/product/${p.slug}/" />\n`,
    vars: { sticky: stickyBar(p), schema: schemaJson(p, siteUrl) },
  });
  return c.html(html);
});

// Cart, checkout, account, wishlist, static pages
registerPages(site);

// WordPress always uses trailing slashes
site.get('/:path{.*[^/]$}', async (c, next) => {
  const p = c.req.path;
  if (/\.[a-z0-9]+$/i.test(p) || p.startsWith('/api') || p.startsWith('/dashboard') || p.startsWith('/wp-')) return next();
  return c.redirect(`${p}/${new URL(c.req.url).search}`, 301);
});
