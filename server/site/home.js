// Homepage: the Elementor page of the original site, with every product grid/slider rebuilt from the database.
import { readFile } from 'node:fs/promises';
import { query } from '../db.js';
import { categories, productsByIds, setting } from './data.js';
import { productCard } from './product-card.js';
import { descendants } from './catalog.js';
import { elementEnd } from './dom.js';

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
let source;
const page = async () => (source ??= await readFile(new URL('../../site/templates/home.main.html', import.meta.url), 'utf8'));
const unquote = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** Products for a widget config: { categories: "12,34", limit, orderby, order, data_source } — like the theme's WC query */
export async function widgetProducts(cfg) {
  const cats = await categories();
  const catIds = String(cfg.categories || '').split(',').map(Number).filter(Boolean).flatMap((id) => descendants(cats, id));
  const limit = Math.max(1, Math.min(60, Number(cfg.limit) || 8));
  const params = [];
  let where = `p.status = 'publish' and p.online_visible and p.stock_status <> 'outofstock' and p.catalog_visibility in ('visible','catalog')`;
  if (catIds.length) { params.push(catIds); where += ` and exists (select 1 from product_categories pc where pc.product_id = p.id and pc.category_id = any($${params.length}::int[]))`; }
  if (cfg.data_source === 'featured') where += ' and p.featured';
  if (cfg.data_source === 'sale') where += ' and p.sale_price is not null';
  const order = cfg.data_source === 'best_selling' ? 'p.total_sales desc, p.id desc'
    : cfg.data_source === 'top_rated' ? 'p.average_rating desc, p.id desc'
    : cfg.orderby === 'title' ? `p.name ${cfg.order === 'ASC' ? 'asc' : 'desc'}`
    : `p.created_at ${cfg.order === 'ASC' ? 'asc' : 'desc'}, p.id ${cfg.order === 'ASC' ? 'asc' : 'desc'}`;
  const rows = await query(`select p.id from products p where ${where} order by ${order} limit ${limit}`, params);
  return productsByIds(rows.map((r) => r.id));
}

/** Rebuilds the cards inside a products-wrap element, keeping its exact surrounding whitespace */
function fillGrid(html, start, products, { slider, images }) {
  const end = elementEnd(html, start);
  const block = html.slice(start, end);
  const open = block.slice(0, block.indexOf('>') + 1);
  const inner = block.slice(open.length, block.length - '</div>'.length);
  const lastCard = inner.lastIndexOf('</div>\t \n</div>\n');
  const tail = lastCard >= 0 ? inner.slice(lastCard + '</div>\t \n</div>\n'.length) : inner.replace(/^\s*\n\n/, '');
  const head = inner.slice(0, inner.indexOf('\n<div class="') >= 0 ? inner.indexOf('\n<div class="') : inner.length);
  const cards = products.map((p, i) => productCard(p, { position: i, columns: 4, images, currentUrl: '/', slide: slider })).join('');
  return html.slice(0, start) + open + head + cards + tail + '</div>' + html.slice(end);
}

export async function renderHome() {
  let html = await page();
  const overrides = (await setting('homepage', {})).sections || [];
  const images = { count: 0 };
  // every tabs widget: the active pane shows the first tab's products
  const widgets = [...html.matchAll(/<div id="pls-products-tabs-\d+" class="[^"]*">/g)].map((m) => m.index);
  for (let w = widgets.length - 1; w >= 0; w--) {
    const ws = widgets[w];
    const we = elementEnd(html, ws);
    const seg = html.slice(ws, we);
    const attr = seg.match(/<li class="nav-item"\s+data-attribute="([^"]+)"/);
    if (!attr) continue;
    let cfg = JSON.parse(unquote(attr[1]));
    const ov = overrides[w]?.tabs?.[0];
    if (ov) cfg = { ...cfg, ...ov };
    const gridAt = seg.indexOf('<div class="products products-wrap');
    if (gridAt < 0) continue;
    const products = await widgetProducts(cfg);
    const newSeg = fillGrid(seg, gridAt, products, { slider: cfg.layout === 'slider', images });
    html = html.slice(0, ws) + newSeg + html.slice(we);
  }
  return html;
}

/** AJAX tab switch (pls_category_tab_product): returns the grid HTML of a tab */
export async function categoryTabHtml(cfg) {
  const products = await widgetProducts(cfg);
  const images = { count: 99 };
  const cards = products.map((p, i) => productCard(p, { position: i, columns: 4, images, currentUrl: '/', slide: cfg.layout === 'slider' })).join('');
  if (cfg.layout === 'slider') {
    return `<div class="woocommerce columns-4 ">\t<div id="" class="pls-slider swiper row">\n\t\t<div class="products products-wrap product-style-5  grid-view swiper-wrapper slider-col-xl- slider-col-lg- slider-col-md- slider-col- has-quick-shop pls-variation-on-hover"  >\n\n${cards}\t\t</div>\n\t</div>\n</div>`;
  }
  return `<div class="woocommerce columns-4 ">\t<div class="products products-wrap product-style-5  row grid-view grid-col-xl-4 grid-col-lg-3 grid-col-md-3 grid-col-2 has-quick-shop pls-variation-on-hover">\n\n${cards}</div>\n</div>`;
}

export { json };
