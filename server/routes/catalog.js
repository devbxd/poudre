import { Hono } from 'hono';
import { query, one, tx } from '../db.js';
import { requireStaff } from '../auth.js';
import { fail, pick, insertRow, updateRow, uniqueSlug, paging, Where, moveStock, audit, effectivePrice, slugify } from '../lib.js';

export const catalog = new Hono();

const PRODUCT_COLS = ['type', 'status', 'name', 'slug', 'sku', 'barcode', 'description', 'short_description', 'regular_price', 'sale_price', 'sale_from', 'sale_to',
  'purchase_price', 'manage_stock', 'stock_status', 'backorders', 'low_stock_amount', 'weight', 'dimensions', 'featured', 'catalog_visibility',
  'online_visible', 'pos_visible', 'supplier_id', 'supplier_sku', 'tax_status', 'menu_order', 'reviews_allowed', 'images', 'attributes',
  'default_attributes', 'upsell_ids', 'cross_sell_ids', 'bundle_items', 'seo', 'meta'];
const PRODUCT_JSON = ['dimensions', 'images', 'attributes', 'default_attributes', 'bundle_items', 'seo', 'meta'];
const VARIATION_COLS = ['status', 'sku', 'barcode', 'attributes', 'regular_price', 'sale_price', 'sale_from', 'sale_to', 'purchase_price', 'manage_stock',
  'stock_status', 'backorders', 'low_stock_amount', 'image', 'weight', 'description', 'supplier_id', 'supplier_sku', 'menu_order'];
const VARIATION_JSON = ['attributes', 'image'];

// ---------------- Products ----------------
catalog.get('/products', requireStaff(), async (c) => {
  const { page, per, offset } = paging(c);
  const f = c.req.query();
  const w = new Where();
  if (f.q) {
    const p = w.param(`%${f.q.trim().toLowerCase()}%`);
    const exact = w.param(f.q.trim());
    w.parts.push(`(lower(p.name) like ${p} or p.sku = ${exact} or p.barcode = ${exact} or lower(p.sku) like ${p}
      or exists (select 1 from variations v where v.product_id = p.id and (v.sku = ${exact} or v.barcode = ${exact})))`);
  }
  if (f.status) w.add('p.status = ?', f.status); else w.parts.push(`p.status <> 'archived'`);
  if (f.type) w.add('p.type = ?', f.type);
  if (f.category) w.add('exists (select 1 from product_categories pc where pc.product_id = p.id and pc.category_id = ?)', Number(f.category));
  if (f.no_category) w.parts.push('not exists (select 1 from product_categories pc where pc.product_id = p.id)');
  if (f.brand) w.add('exists (select 1 from product_brands pb where pb.product_id = p.id and pb.brand_id = ?)', Number(f.brand));
  if (f.supplier) w.add('p.supplier_id = ?', Number(f.supplier));
  if (f.stock === 'out') w.parts.push(`p.stock_status = 'outofstock'`);
  if (f.stock === 'in') w.parts.push(`p.stock_status = 'instock'`);
  if (f.stock === 'low') w.parts.push(`p.manage_stock and p.stock_quantity > 0 and p.stock_quantity <= coalesce(p.low_stock_amount, 3)`);
  if (f.stock === 'negative') w.parts.push(`(p.stock_quantity < 0 or exists (select 1 from variations v where v.product_id = p.id and v.stock_quantity < 0))`);
  if (f.online === 'hidden') w.parts.push('not p.online_visible');
  if (f.featured) w.parts.push('p.featured');
  if (f.on_sale) w.parts.push('p.sale_price is not null');
  if (f.issue === 'no_image') w.parts.push(`jsonb_array_length(p.images) = 0`);
  if (f.issue === 'no_sku') w.parts.push(`(p.sku is null or p.sku = '')`);
  if (f.issue === 'no_price') w.parts.push(`p.type <> 'variable' and coalesce(p.regular_price, 0) = 0`);
  if (f.issue === 'no_cost') w.parts.push(`p.purchase_price is null`);
  const sorts = { name: 'p.name asc', '-name': 'p.name desc', price: 'p.regular_price asc nulls last', '-price': 'p.regular_price desc nulls last',
    stock: 'p.stock_quantity asc nulls last', '-stock': 'p.stock_quantity desc nulls last', '-sales': 'p.total_sales desc', '-created': 'p.created_at desc', '-updated': 'p.updated_at desc', menu: 'p.menu_order asc, p.name asc' };
  const order = sorts[f.sort] || 'p.created_at desc';
  const [{ total }] = await query(`select count(*)::int total from products p ${w.sql}`, w.params);
  const rows = await query(`
    select p.id, p.type, p.status, p.name, p.slug, p.sku, p.barcode, p.regular_price, p.sale_price, p.sale_from, p.sale_to, p.purchase_price,
      p.manage_stock, p.stock_quantity, p.stock_status, p.featured, p.online_visible, p.pos_visible, p.total_sales, p.created_at, p.updated_at,
      p.images->0->>'url' image,
      (select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name)), '[]') from product_categories pc join categories c on c.id = pc.category_id where pc.product_id = p.id) categories,
      (select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name)), '[]') from product_brands pb join brands b on b.id = pb.brand_id where pb.product_id = p.id) brands,
      (select json_build_object('count', count(*)::int, 'stock', sum(v.stock_quantity)::int, 'min', min(coalesce(v.sale_price, v.regular_price))::float8, 'max', max(coalesce(v.sale_price, v.regular_price))::float8)
         from variations v where v.product_id = p.id) variations
    from products p ${w.sql} order by ${order} limit ${per} offset ${offset}`, w.params);
  return c.json({ items: rows, total, page, per_page: per });
});

async function fullProduct(id) {
  const p = await one('select * from products where id = $1', [id]);
  if (!p) fail(404, 'Product not found');
  const [categories, brands, tags, variations] = await Promise.all([
    query('select c.id, c.name from product_categories pc join categories c on c.id = pc.category_id where pc.product_id = $1 order by c.name', [id]),
    query('select b.id, b.name from product_brands pb join brands b on b.id = pb.brand_id where pb.product_id = $1', [id]),
    query('select t.id, t.name from product_tags pt join tags t on t.id = pt.tag_id where pt.product_id = $1', [id]),
    query('select * from variations where product_id = $1 order by menu_order, id', [id]),
  ]);
  return { ...p, categories, brands, tags, variations };
}

catalog.get('/products/:id', requireStaff(), async (c) => {
  const id = Number(c.req.param('id'));
  const product = await fullProduct(id);
  const [stats] = await query(`select coalesce(sum(oi.quantity - oi.refunded_qty), 0)::int sold, coalesce(sum(oi.total), 0)::float8 revenue,
      max(o.created_at) last_sold from order_items oi join orders o on o.id = oi.order_id where oi.product_id = $1 and o.status in ('completed','processing','on-hold')`, [id]);
  const movements = await query('select * from stock_movements where product_id = $1 order by created_at desc limit 50', [id]);
  return c.json({ ...product, stats, movements });
});

async function saveTerms(t, productId, body) {
  if (Array.isArray(body.category_ids)) {
    await t.query('delete from product_categories where product_id = $1', [productId]);
    for (const cid of new Set(body.category_ids.map(Number))) await t.query('insert into product_categories values ($1,$2) on conflict do nothing', [productId, cid]);
  }
  if (Array.isArray(body.brand_ids)) {
    await t.query('delete from product_brands where product_id = $1', [productId]);
    for (const bid of new Set(body.brand_ids.map(Number))) await t.query('insert into product_brands values ($1,$2) on conflict do nothing', [productId, bid]);
  }
  if (Array.isArray(body.tags)) {
    await t.query('delete from product_tags where product_id = $1', [productId]);
    for (const tag of body.tags) {
      const name = typeof tag === 'string' ? tag.trim() : tag.name;
      if (!name) continue;
      let [row] = await t.query('select id from tags where lower(name) = lower($1)', [name]);
      if (!row) [row] = await t.query('insert into tags (name, slug) values ($1, $2) on conflict (slug) do update set name = excluded.name returning id', [name, slugify(name)]);
      await t.query('insert into product_tags values ($1,$2) on conflict do nothing', [productId, row.id]);
    }
  }
}

async function saveVariations(t, productId, variations, staff) {
  const existing = await t.query('select id, stock_quantity, manage_stock from variations where product_id = $1', [productId]);
  const keep = new Set();
  for (const [i, v] of variations.entries()) {
    const data = pick({ ...v, menu_order: v.menu_order ?? i }, VARIATION_COLS, VARIATION_JSON);
    let row;
    const old = v.id && existing.find((e) => e.id === Number(v.id));
    if (old) row = await updateRow(t, 'variations', old.id, data);
    else row = await insertRow(t, 'variations', { ...data, product_id: productId });
    keep.add(row.id);
    if (v.manage_stock && v.stock_quantity !== undefined && v.stock_quantity !== null && v.stock_quantity !== '') {
      const prev = old?.manage_stock ? Number(old.stock_quantity) : null;
      if (prev !== Number(v.stock_quantity)) {
        await t.query('update variations set manage_stock = true, stock_quantity = coalesce(stock_quantity, 0) where id = $1', [row.id]);
        await moveStock(t, { variation_id: row.id, change: 0, set: Number(v.stock_quantity), reason: old ? 'adjustment' : 'import', note: 'Edited in product form', staff_id: staff.id });
      }
    }
  }
  for (const e of existing) if (!keep.has(e.id)) await t.query('delete from variations where id = $1', [e.id]);
}

async function saveProduct(body, staff, id = null) {
  return tx(async (t) => {
    const data = pick(body, PRODUCT_COLS, PRODUCT_JSON);
    if (data.name !== undefined && !String(data.name).trim()) fail(400, 'Product name is required');
    if (data.sku) {
      const [dup] = await t.query('select id, name from products where sku = $1 and ($2::int is null or id <> $2) union all select product_id, sku from variations where sku = $1 limit 1', [data.sku, id]);
      if (dup && dup.id !== id) fail(400, `SKU ${data.sku} is already used by "${dup.name}"`);
    }
    if (body.slug !== undefined || !id) data.slug = await uniqueSlug('products', body.slug || body.name, id);
    let row;
    if (id) {
      const old = await one('select * from products where id = $1', [id]);
      if (!old) fail(404, 'Product not found');
      row = await updateRow(t, 'products', id, data);
      if (body.manage_stock && body.stock_quantity !== undefined && body.stock_quantity !== null && body.stock_quantity !== '' && Number(body.stock_quantity) !== Number(old.stock_quantity)) {
        await t.query('update products set stock_quantity = coalesce(stock_quantity, 0) where id = $1', [id]);
        await moveStock(t, { product_id: id, change: 0, set: Number(body.stock_quantity), reason: 'adjustment', note: body.stock_note || 'Edited in product form', staff_id: staff.id });
      }
    } else {
      row = await insertRow(t, 'products', { ...data, name: data.name || 'New product', stock_quantity: body.manage_stock ? Number(body.stock_quantity) || 0 : null });
      if (body.manage_stock && Number(body.stock_quantity)) {
        await t.query(`insert into stock_movements (product_id, change, quantity_after, reason, note, staff_id) values ($1,$2,$2,'adjustment','Initial stock',$3)`, [row.id, Number(body.stock_quantity), staff.id]);
      }
      if (!body.manage_stock || Number(body.stock_quantity) > 0) await t.query(`update products set stock_status = coalesce($2, 'instock') where id = $1`, [row.id, body.stock_status || null]);
      else await t.query(`update products set stock_status = 'outofstock' where id = $1`, [row.id]);
    }
    await saveTerms(t, row.id, body);
    if (Array.isArray(body.variations)) await saveVariations(t, row.id, body.variations, staff);
    return row.id;
  });
}

catalog.post('/products', requireStaff('manager'), async (c) => {
  const staff = c.get('staff');
  const id = await saveProduct(await c.req.json(), staff);
  await audit(staff, 'create', 'product', id);
  return c.json(await fullProduct(id), 201);
});

catalog.put('/products/:id', requireStaff('manager'), async (c) => {
  const staff = c.get('staff');
  const id = await saveProduct(await c.req.json(), staff, Number(c.req.param('id')));
  await audit(staff, 'update', 'product', id);
  return c.json(await fullProduct(id));
});

catalog.post('/products/:id/duplicate', requireStaff('manager'), async (c) => {
  const src = await fullProduct(Number(c.req.param('id')));
  const body = {
    ...src, name: `${src.name} (copy)`, slug: undefined, sku: null, barcode: null, status: 'draft',
    category_ids: src.categories.map((x) => x.id), brand_ids: src.brands.map((x) => x.id), tags: src.tags.map((x) => x.name),
    variations: src.variations.map((v) => ({ ...v, id: undefined, sku: null, barcode: null })),
  };
  const id = await saveProduct(body, c.get('staff'));
  return c.json(await fullProduct(id), 201);
});

catalog.delete('/products/:id', requireStaff('manager'), async (c) => {
  const id = Number(c.req.param('id'));
  const [{ n }] = await query('select count(*)::int n from order_items where product_id = $1', [id]);
  // products with sales history are archived to keep reports intact
  if (n > 0 || c.req.query('archive')) await query(`update products set status = 'archived', updated_at = now() where id = $1`, [id]);
  else await query('delete from products where id = $1', [id]);
  await audit(c.get('staff'), n > 0 ? 'archive' : 'delete', 'product', id);
  return c.json({ ok: true, archived: n > 0 });
});

/** Bulk edit: { ids, action, value } */
catalog.post('/products/bulk', requireStaff('manager'), async (c) => {
  const { ids, action, value } = await c.req.json();
  if (!Array.isArray(ids) || !ids.length) fail(400, 'No products selected');
  const staff = c.get('staff');
  await tx(async (t) => {
    const idList = ids.map(Number);
    switch (action) {
      case 'status': await t.query('update products set status = $2, updated_at = now() where id = any($1)', [idList, value]); break;
      case 'online_visible': case 'pos_visible': case 'featured':
        await t.query(`update products set ${action} = $2, updated_at = now() where id = any($1)`, [idList, !!value]); break;
      case 'add_category': for (const id of idList) await t.query('insert into product_categories values ($1,$2) on conflict do nothing', [id, Number(value)]); break;
      case 'remove_category': await t.query('delete from product_categories where product_id = any($1) and category_id = $2', [idList, Number(value)]); break;
      case 'set_brand':
        await t.query('delete from product_brands where product_id = any($1)', [idList]);
        if (value) for (const id of idList) await t.query('insert into product_brands values ($1,$2) on conflict do nothing', [id, Number(value)]);
        break;
      case 'supplier': await t.query('update products set supplier_id = $2, updated_at = now() where id = any($1)', [idList, value ? Number(value) : null]); break;
      case 'price_percent': // value: { percent, target: 'regular'|'sale' }
        await t.query(`update products set regular_price = round(regular_price * (1 + $2::numeric / 100), 2), updated_at = now() where id = any($1) and regular_price is not null`, [idList, Number(value)]);
        await t.query(`update variations set regular_price = round(regular_price * (1 + $2::numeric / 100), 2), updated_at = now() where product_id = any($1) and regular_price is not null`, [idList, Number(value)]);
        break;
      case 'sale_percent': // put products on sale at X% off (null = remove sale)
        if (value === null || value === '' || Number(value) === 0) {
          await t.query('update products set sale_price = null, sale_from = null, sale_to = null, updated_at = now() where id = any($1)', [idList]);
          await t.query('update variations set sale_price = null, sale_from = null, sale_to = null, updated_at = now() where product_id = any($1)', [idList]);
        } else {
          await t.query('update products set sale_price = round(regular_price * (1 - $2::numeric / 100), 2), updated_at = now() where id = any($1) and regular_price is not null', [idList, Number(value)]);
          await t.query('update variations set sale_price = round(regular_price * (1 - $2::numeric / 100), 2), updated_at = now() where product_id = any($1) and regular_price is not null', [idList, Number(value)]);
        }
        break;
      case 'stock_status': await t.query('update products set stock_status = $2, updated_at = now() where id = any($1) and not manage_stock', [idList, value]); break;
      case 'delete':
        for (const id of idList) {
          const [{ n }] = await t.query('select count(*)::int n from order_items where product_id = $1', [id]);
          if (n > 0) await t.query(`update products set status = 'archived' where id = $1`, [id]);
          else await t.query('delete from products where id = $1', [id]);
        }
        break;
      default: fail(400, 'Unknown bulk action');
    }
  });
  await audit(staff, `bulk:${action}`, 'product', ids.join(','), { value });
  return c.json({ ok: true, count: ids.length });
});

// Quick inline edits from the product table (price / stock)
catalog.patch('/products/:id', requireStaff('manager'), async (c) => {
  const id = await saveProduct(await c.req.json(), c.get('staff'), Number(c.req.param('id')));
  return c.json(await fullProduct(id));
});

catalog.get('/lookup', requireStaff(), async (c) => {
  // search used by pickers (upsells, coupons, purchase orders…)
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json([]);
  const rows = await query(`
    select p.id, null::int variation_id, p.name, p.sku, p.type, p.regular_price, p.sale_price, p.purchase_price, p.stock_quantity, p.images->0->>'url' image
      from products p where p.status <> 'archived' and (lower(p.name) like $1 or p.sku = $2 or p.barcode = $2)
    union all
    select p.id, v.id, p.name || ' - ' || coalesce((select string_agg(a->>'option', ', ') from jsonb_array_elements(v.attributes) a), ''), v.sku, 'variation',
      coalesce(v.regular_price, p.regular_price), v.sale_price, coalesce(v.purchase_price, p.purchase_price), v.stock_quantity, coalesce(v.image->>'url', p.images->0->>'url')
      from variations v join products p on p.id = v.product_id where p.status <> 'archived' and (v.sku = $2 or v.barcode = $2 or (lower(p.name) like $1 and $3))
    limit 30`, [`%${q.toLowerCase()}%`, q, c.req.query('variations') === '1']);
  return c.json(rows);
});

// ---------------- Categories ----------------
catalog.get('/categories', requireStaff(), async (c) => {
  const rows = await query(`select c.*, (select count(*)::int from product_categories pc join products p on p.id = pc.product_id where pc.category_id = c.id and p.status <> 'archived') product_count
    from categories c order by c.menu_order, c.name`);
  return c.json(rows);
});

const CAT_COLS = ['parent_id', 'name', 'slug', 'description', 'image', 'menu_order', 'visible', 'pos_visible'];
catalog.post('/categories', requireStaff('manager'), async (c) => {
  const body = await c.req.json();
  if (!body.name?.trim()) fail(400, 'Name is required');
  const data = pick(body, CAT_COLS);
  data.slug = await uniqueSlug('categories', body.slug || body.name);
  const row = await tx((t) => insertRow(t, 'categories', data));
  await audit(c.get('staff'), 'create', 'category', row.id);
  return c.json(row, 201);
});
catalog.put('/categories/:id', requireStaff('manager'), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const data = pick(body, CAT_COLS);
  if (body.parent_id && Number(body.parent_id) === id) fail(400, 'A category cannot be its own parent');
  if (body.slug !== undefined) data.slug = await uniqueSlug('categories', body.slug || body.name, id);
  const row = await tx((t) => updateRow(t, 'categories', id, data, { touch: false }));
  await audit(c.get('staff'), 'update', 'category', id);
  return c.json(row);
});
catalog.post('/categories/reorder', requireStaff('manager'), async (c) => {
  // [{id, parent_id, menu_order}]
  const items = await c.req.json();
  await tx(async (t) => { for (const i of items) await t.query('update categories set parent_id = $2, menu_order = $3 where id = $1', [i.id, i.parent_id || null, i.menu_order]); });
  return c.json({ ok: true });
});
catalog.delete('/categories/:id', requireStaff('manager'), async (c) => {
  const id = Number(c.req.param('id'));
  await tx(async (t) => {
    const [cat] = await t.query('select * from categories where id = $1', [id]);
    if (!cat) fail(404, 'Category not found');
    // children move up to the deleted category's parent
    await t.query('update categories set parent_id = $2 where parent_id = $1', [id, cat.parent_id]);
    await t.query('delete from categories where id = $1', [id]);
  });
  await audit(c.get('staff'), 'delete', 'category', id);
  return c.json({ ok: true });
});

// ---------------- Brands / tags / attributes ----------------
for (const [path, table, cols, extra] of [
  ['brands', 'brands', ['name', 'slug', 'description', 'image', 'visible', 'menu_order'], 'product_brands pb where pb.brand_id'],
  ['tags', 'tags', ['name', 'slug'], 'product_tags pb where pb.tag_id'],
  ['attributes', 'attributes', ['name', 'slug', 'terms'], null],
]) {
  catalog.get(`/${path}`, requireStaff(), async (c) => {
    const q = c.req.query('q');
    const rows = await query(`select x.*${extra ? `, (select count(*)::int from ${extra} = x.id) product_count` : ''} from ${table} x
      ${q ? 'where lower(x.name) like $1' : ''} order by x.name ${path === 'tags' && !q ? 'limit 500' : ''}`, q ? [`%${q.toLowerCase()}%`] : []);
    return c.json(rows);
  });
  catalog.post(`/${path}`, requireStaff('manager'), async (c) => {
    const body = await c.req.json();
    if (!body.name?.trim()) fail(400, 'Name is required');
    const data = pick(body, cols, ['terms']);
    data.slug = await uniqueSlug(table, body.slug || body.name);
    return c.json(await tx((t) => insertRow(t, table, data)), 201);
  });
  catalog.put(`/${path}/:id`, requireStaff('manager'), async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json();
    const data = pick(body, cols, ['terms']);
    if (body.slug !== undefined) data.slug = await uniqueSlug(table, body.slug || body.name, id);
    return c.json(await tx((t) => updateRow(t, table, id, data, { touch: false })));
  });
  catalog.delete(`/${path}/:id`, requireStaff('manager'), async (c) => {
    await query(`delete from ${table} where id = $1`, [Number(c.req.param('id'))]);
    return c.json({ ok: true });
  });
}

// price helper used by other modules
export const displayPrice = effectivePrice;
