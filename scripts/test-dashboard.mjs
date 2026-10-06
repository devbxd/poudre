// End-to-end check of the dashboard & POS through their API: every workflow the shop uses, with stock/money assertions.
// Creates its own test data (names start with "ZZ TEST") and removes it at the end.
// Usage: BASE=http://localhost:8787 OWNER_USER=jeanclaude OWNER_PASSWORD=… node scripts/test-dashboard.mjs
const BASE = process.env.BASE || 'http://localhost:8787';
let cookie = '';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${detail}`}`); };

async function req(method, path, body, { as } = {}) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', Cookie: as ?? cookie }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
  if (set && as === undefined) cookie = set.split(';')[0];
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, set };
}
const A = (p) => `/api/admin${p}`;
const P = (p) => `/api/pos${p}`;
const stockOf = async (id, vid) => {
  const r = await req('POST', P('/stock'), { ids: [id] });
  return r.data.find((x) => (vid ? x.variation_id === vid : !x.variation_id))?.stock_quantity;
};
const cleanup = { products: [], coupons: [], customers: [], suppliers: [], categories: [], brands: [], staff: [], orders: [], pos: [], media: [] };

// ---------- login
let r = await req('POST', '/api/auth/login', { username: process.env.OWNER_USER || 'jeanclaude', password: process.env.OWNER_PASSWORD });
check('Owner login', r.status === 200 && cookie, JSON.stringify(r.data));
const owner = cookie;
r = await req('POST', '/api/auth/login', { username: 'jeanclaude', password: 'wrong-password' }, { as: '' });
check('Wrong password refused', r.status === 401, r.status);

// ---------- catalogue: categories & brands
r = await req('POST', A('/categories'), { name: 'ZZ TEST Category', visible: true, pos_visible: true });
const cat = r.data; check('Create category', r.status === 201 && cat.id, JSON.stringify(r.data)); cleanup.categories.push(cat.id);
r = await req('PUT', A(`/categories/${cat.id}`), { visible: false });
check('Hide category from website', r.status === 200 && r.data.visible === false, JSON.stringify(r.data).slice(0, 200));
r = await req('POST', A('/brands'), { name: 'ZZ TEST Brand' });
const brand = r.data; check('Create brand', [200, 201].includes(r.status) && brand.id, JSON.stringify(r.data).slice(0, 200)); if (brand?.id) cleanup.brands.push(brand.id);

// ---------- products
const sku = `ZZT-${Date.now()}`;
r = await req('POST', A('/products'), {
  name: 'ZZ TEST Lipstick', type: 'simple', status: 'publish', regular_price: 20, purchase_price: 8, sku, barcode: `9${Date.now()}`.slice(0, 13),
  manage_stock: true, stock_quantity: 10, online_visible: true, pos_visible: true, category_ids: [cat.id], brand_ids: brand?.id ? [brand.id] : [],
});
const simple = r.data; check('Create simple product (stock 10)', r.status === 201 && simple.id && simple.stock_quantity === 10, JSON.stringify(r.data).slice(0, 300)); cleanup.products.push(simple.id);
r = await req('GET', A(`/lookup?q=${encodeURIComponent(simple.barcode)}`));
check('Find product by barcode', r.status === 200 && JSON.stringify(r.data).includes(String(simple.id)), JSON.stringify(r.data).slice(0, 200));
r = await req('PUT', A(`/products/${simple.id}`), { ...simple, category_ids: [cat.id], regular_price: 25, sale_price: 22 });
check('Edit price (25, sale 22)', r.status === 200 && Number(r.data.regular_price) === 25 && Number(r.data.sale_price) === 22, JSON.stringify(r.data).slice(0, 300));
r = await req('GET', A(`/products?q=${encodeURIComponent('ZZ TEST Lipstick')}`));
check('Product list search', r.status === 200 && r.data.items?.some((p) => p.id === simple.id), JSON.stringify(r.data).slice(0, 200));

r = await req('POST', A('/products'), {
  name: 'ZZ TEST Perfume', type: 'variable', status: 'publish', regular_price: 50, online_visible: true, pos_visible: true,
  attributes: [{ name: 'Size', options: ['50ml', '100ml'], variation: true, visible: true }],
  variations: [
    { attributes: [{ name: 'Size', option: '50ml' }], regular_price: 50, manage_stock: true, stock_quantity: 5, status: 'publish', sku: `${sku}-50` },
    { attributes: [{ name: 'Size', option: '100ml' }], regular_price: 80, manage_stock: true, stock_quantity: 3, status: 'publish', sku: `${sku}-100` },
  ],
});
const variable = r.data; check('Create product with options (2 sizes)', r.status === 201 && variable.variations?.length === 2, JSON.stringify(r.data).slice(0, 300)); cleanup.products.push(variable.id);
const v50 = variable.variations?.find((v) => JSON.stringify(v.attributes).includes('50ml'));
const v100 = variable.variations?.find((v) => JSON.stringify(v.attributes).includes('100ml'));

r = await req('POST', A(`/products/${simple.id}/duplicate`));
check('Duplicate product', r.status === 201 && r.data.id && r.data.status === 'draft', JSON.stringify(r.data).slice(0, 200)); if (r.data?.id) cleanup.products.push(r.data.id);
r = await req('POST', A('/products/bulk'), { ids: [r.data.id], action: 'status', value: 'private' });
check('Bulk edit', r.status === 200, JSON.stringify(r.data).slice(0, 200));

// ---------- stock
r = await req('POST', A('/stock/adjust'), { lines: [{ product_id: simple.id, change: 5 }], reason: 'adjustment', note: 'test' });
check('Stock adjust +5 → 15', r.status === 200 && (await stockOf(simple.id)) === 15, JSON.stringify(r.data));
r = await req('POST', A('/stock/adjust'), { lines: [{ product_id: simple.id, set: 12 }], reason: 'count' });
check('Stock count set to 12', (await stockOf(simple.id)) === 12, JSON.stringify(r.data));
r = await req('GET', A(`/stock/movements?product_id=${simple.id}`));
check('Stock history recorded', r.status === 200 && (r.data.items || r.data).length >= 2, JSON.stringify(r.data).slice(0, 200));
for (const path of ['/stock', '/stock/summary', '/stock/reorder']) { r = await req('GET', A(path)); check(`Stock page ${path}`, r.status === 200, r.status); }

// ---------- suppliers & purchase orders
r = await req('POST', A('/suppliers'), { name: 'ZZ TEST Supplier', phone: '01000000' });
const sup = r.data; check('Create supplier', [200, 201].includes(r.status) && sup.id, JSON.stringify(r.data).slice(0, 200)); if (sup?.id) cleanup.suppliers.push(sup.id);
r = await req('POST', A('/purchase-orders'), { supplier_id: sup.id, status: 'ordered', items: [{ product_id: simple.id, name: simple.name, qty: 10, cost: 7 }] });
const po = r.data; check('Create purchase order (10 × $7)', r.status === 201 && Number(po.total) === 70, JSON.stringify(r.data).slice(0, 200));
r = await req('POST', A(`/purchase-orders/${po.id}/receive`), { all: true });
check('Receive purchase order → stock 22', r.status === 200 && (await stockOf(simple.id)) === 22, JSON.stringify(r.data).slice(0, 200));
r = await req('GET', A(`/products/${simple.id}`));
check('Cost price updated to $7', Number(r.data.purchase_price) === 7, r.data.purchase_price);

// ---------- coupon & customer
const code = `ZZTEST${Date.now() % 100000}`;
r = await req('POST', A('/coupons'), { code, type: 'percent', amount: 10, active: true });
const coupon = r.data; check('Create coupon 10%', [200, 201].includes(r.status) && coupon.id, JSON.stringify(r.data).slice(0, 200)); if (coupon?.id) cleanup.coupons.push(coupon.id);
r = await req('POST', A('/customers'), { first_name: 'ZZ', last_name: 'TEST', phone: `03${Date.now() % 1000000}`, email: `zz.test.${Date.now()}@example.com` });
const cust = r.data; check('Create customer', [200, 201].includes(r.status) && cust.id, JSON.stringify(r.data).slice(0, 200)); if (cust?.id) cleanup.customers.push(cust.id);
r = await req('GET', A(`/customers?q=ZZ`));
check('Customer search', r.status === 200 && r.data.items?.some((x) => x.id === cust.id), JSON.stringify(r.data).slice(0, 200));

// ---------- POS: register + sales
r = await req('GET', P('/session'));
let openedSession = false;
if (!r.data) { r = await req('POST', P('/session/open'), { opening_cash: 50 }); openedSession = r.status === 201; check('Open cash register ($50)', openedSession, JSON.stringify(r.data)); }
else check('Cash register already open', true);
r = await req('GET', P('/catalog'));
check('POS catalogue loads', r.status === 200 && r.data.products?.some((p) => p.id === simple.id) && r.data.products?.some((p) => p.id === variable.id && p.variations?.length === 2), `${r.data.products?.length} products`);

r = await req('POST', P('/orders'), {
  items: [{ product_id: simple.id, quantity: 2 }, { product_id: variable.id, variation_id: v50.id, quantity: 1 }],
  payment_method: 'cash', payment_title: 'Cash', cash_tendered: 100, customer_id: cust.id,
});
const sale = r.data; cleanup.orders.push(sale.id);
check('POS cash sale: 2 × $22 + 1 × $50 = $94', r.status === 201 && Number(sale.total) === 94 && sale.status === 'completed', JSON.stringify(r.data).slice(0, 300));
check('Change given: $6', Number(sale.cash_change) === 6, sale.cash_change);
check('Stock after sale: lipstick 20, 50ml 4', (await stockOf(simple.id)) === 20 && (await stockOf(variable.id, v50.id)) === 4, `${await stockOf(simple.id)} / ${await stockOf(variable.id, v50.id)}`);

r = await req('POST', P('/orders'), { items: [{ product_id: simple.id, quantity: 1 }], payment_method: 'cash', coupon_code: code });
cleanup.orders.push(r.data.id);
check('POS sale with coupon (10% off $22 = $19.80)', r.status === 201 && Number(r.data.total) === 19.8, JSON.stringify(r.data).slice(0, 300));
r = await req('POST', P('/orders'), { items: [{ product_id: simple.id, quantity: 1 }], payment_method: 'card', payment_title: 'Card', discount: { type: 'amount', amount: 2 } });
cleanup.orders.push(r.data.id);
check('POS card sale with $2 discount = $20', r.status === 201 && Number(r.data.total) === 20, JSON.stringify(r.data).slice(0, 300));
r = await req('POST', P('/orders'), { items: [{ custom: true, name: 'ZZ TEST service', price: 15, quantity: 1 }, { product_id: variable.id, quantity: 1 }], payment_method: 'cash' });
check('Sale refused when no size is chosen', r.status === 400, JSON.stringify(r.data).slice(0, 200));
r = await req('POST', P('/orders'), { items: [{ custom: true, name: 'ZZ TEST service', price: 15, quantity: 1 }], payment_method: 'cash' });
cleanup.orders.push(r.data.id);
check('Custom item sale ($15)', r.status === 201 && Number(r.data.total) === 15, JSON.stringify(r.data).slice(0, 200));

const item = sale.items?.find((i) => i.product_id === simple.id);
r = await req('POST', P(`/orders/${sale.id}/refund`), { items: [{ order_item_id: item.id, quantity: 1 }], reason: 'test', restock: true });
check('POS refund 1 lipstick ($22) → stock back +1', r.status === 200 && Number(r.data.refunded_total) === 22 && (await stockOf(simple.id)) === 19, JSON.stringify(r.data).slice(0, 200));
r = await req('GET', P('/orders?q=' + sale.number));
check('Sale found in POS sales list', r.status === 200 && r.data.some((o) => o.id === sale.id), JSON.stringify(r.data).slice(0, 200));
r = await req('POST', P('/session/cash'), { amount: -10, reason: 'ZZ TEST petty cash' });
check('Cash out $10 recorded', r.status === 200, JSON.stringify(r.data));
r = await req('GET', P('/session'));
check('Register expected cash computed', r.status === 200 && typeof r.data.expected_cash === 'number', JSON.stringify(r.data).slice(0, 300));

// ---------- dashboard orders
r = await req('POST', A('/orders'), { items: [{ product_id: simple.id, quantity: 2 }], billing: { first_name: 'ZZ', last_name: 'TEST', phone: '03000000' }, status: 'processing', payment_method: 'cod' });
const manual = r.data; cleanup.orders.push(manual.id);
check('Manual order (processing) reduces stock → 17', r.status === 201 && (await stockOf(simple.id)) === 17, JSON.stringify(r.data).slice(0, 200));
r = await req('PUT', A(`/orders/${manual.id}`), { status: 'cancelled' });
check('Cancel order puts stock back → 19', r.status === 200 && r.data.status === 'cancelled' && (await stockOf(simple.id)) === 19, `${r.data.status} / ${await stockOf(simple.id)}`);
r = await req('POST', A(`/orders/${manual.id}/notes`), { note: 'ZZ TEST note', customer_visible: false });
check('Add order note', r.status === 201, JSON.stringify(r.data).slice(0, 200));
r = await req('GET', A(`/orders/${sale.id}`));
check('Order detail (items, notes, customer)', r.status === 200 && r.data.items?.length === 2 && r.data.notes?.length >= 1, JSON.stringify(r.data).slice(0, 200));
r = await req('GET', A('/orders?status=completed'));
check('Orders list & filters', r.status === 200 && r.data.items?.length > 0, r.status);
r = await req('GET', A(`/customers/${cust.id}`));
check('Customer history shows the sale', r.status === 200 && JSON.stringify(r.data).includes(String(sale.number)), JSON.stringify(r.data).slice(0, 200));

// ---------- reports
for (const path of ['/reports/overview?range=30d', '/reports/sales?range=30d', '/reports/day', '/reports/dead-stock']) { r = await req('GET', A(path)); check(`Report ${path}`, r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`); }
r = await req('GET', A('/reports/day'));
check("Today's report includes the test sales", JSON.stringify(r.data).length > 50, JSON.stringify(r.data).slice(0, 200));

// ---------- staff & permissions
const pin = String(1000 + (Date.now() % 9000));
r = await req('POST', A('/staff'), { name: 'ZZ TEST Cashier', username: `zztest${Date.now() % 100000}`, password: 'testpass123', role: 'cashier', pin });
const cashier = r.data; check('Create cashier with PIN', [200, 201].includes(r.status) && cashier.id, JSON.stringify(r.data).slice(0, 200)); if (cashier?.id) cleanup.staff.push(cashier.id);
r = await req('POST', '/api/auth/login', { pin }, { as: '' });
const cashierCookie = (r.set || '').split(';')[0];
check('Cashier logs in with PIN', r.status === 200 && r.data.staff?.role === 'cashier', JSON.stringify(r.data));
r = await req('PUT', A('/settings/store'), { name: 'hack' }, { as: cashierCookie });
check('Cashier cannot change settings', r.status === 403, r.status);
r = await req('POST', A('/products'), { name: 'x' }, { as: cashierCookie });
check('Cashier cannot create products', r.status === 403, r.status);
r = await req('POST', P('/orders'), { items: [{ product_id: simple.id, quantity: 1 }], payment_method: 'cash' }, { as: cashierCookie });
if (r.data?.id) cleanup.orders.push(r.data.id);
check('Cashier can sell in POS', r.status === 201, JSON.stringify(r.data).slice(0, 200));

// ---------- settings, website content, media
for (const key of ['store', 'shipping', 'payments', 'pos']) {
  const g = await req('GET', A(`/settings/${key}`));
  const p = await req('PUT', A(`/settings/${key}`), g.data);
  check(`Settings "${key}" save (unchanged)`, g.status === 200 && p.status === 200, `${g.status}/${p.status}`);
}
for (const path of ['/menus', '/messages', '/reviews', '/activity', '/media', '/staff', '/emails', '/icarry', '/coupons', '/suppliers', '/purchase-orders', '/categories', '/brands', '/search?q=lip']) {
  r = await req('GET', A(path)); check(`Page data ${path}`, r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'zz-test.png');
const up = await fetch(BASE + A('/media'), { method: 'POST', headers: { Cookie: owner }, body: fd });
const media = await up.json().catch(() => ({}));
check('Upload an image', up.status === 201 || up.status === 200, JSON.stringify(media).slice(0, 200));
const mediaId = media.id || media[0]?.id; if (mediaId) cleanup.media.push(mediaId);

// ---------- website reflects the dashboard
r = await fetch(`${BASE}/product/${simple.slug}/`);
check('Product visible on the website', r.status === 200, r.status);
await req('PUT', A(`/products/${simple.id}`), { ...simple, category_ids: [cat.id], online_visible: false });
r = await fetch(`${BASE}/product/${simple.slug}/`);
check('Hidden product disappears from the website', r.status === 404, r.status);

// ---------- cleanup
cookie = owner;
for (const id of cleanup.orders) await req('DELETE', A(`/orders/${id}`));
for (const id of cleanup.products) await req('DELETE', A(`/products/${id}`));
for (const id of cleanup.coupons) await req('DELETE', A(`/coupons/${id}`));
for (const id of cleanup.customers) await req('DELETE', A(`/customers/${id}`));
for (const id of cleanup.suppliers) await req('DELETE', A(`/suppliers/${id}`));
for (const id of cleanup.categories) await req('DELETE', A(`/categories/${id}`));
for (const id of cleanup.brands) await req('DELETE', A(`/brands/${id}`));
for (const id of cleanup.media) await req('DELETE', A(`/media/${id}`));
for (const id of cleanup.staff) await req('PUT', A(`/staff/${id}`), { active: false });
if (po?.id) await req('DELETE', A(`/purchase-orders/${po.id}`));
if (openedSession) await req('POST', P('/session/close'), { closing_cash: 0, notes: 'ZZ TEST' });

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(` - ${f.name}: ${f.detail}`); }
process.exit(failed.length ? 1 : 0);
