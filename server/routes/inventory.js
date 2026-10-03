import { Hono } from 'hono';
import { query, one, tx } from '../db.js';
import { requireStaff } from '../auth.js';
import { fail, pick, insertRow, updateRow, paging, Where, moveStock, audit, money, toCsv } from '../lib.js';

export const inventory = new Hono();

// Every stockable line (simple products + variations) in one list
const STOCK_ROWS = `
  select p.id product_id, null::int variation_id, p.name, p.sku, p.manage_stock, p.stock_quantity, p.stock_status, p.low_stock_amount,
    p.purchase_price::float8 cost, coalesce(p.sale_price, p.regular_price)::float8 price, p.supplier_id, p.images->0->>'url' image, p.status
  from products p where p.type <> 'variable' and p.status <> 'archived'
  union all
  select p.id, v.id, p.name || ' - ' || coalesce((select string_agg(a->>'option', ', ') from jsonb_array_elements(v.attributes) a), ''),
    v.sku, v.manage_stock, v.stock_quantity, v.stock_status, coalesce(v.low_stock_amount, p.low_stock_amount),
    coalesce(v.purchase_price, p.purchase_price)::float8, coalesce(v.sale_price, v.regular_price)::float8, coalesce(v.supplier_id, p.supplier_id),
    coalesce(v.image->>'url', p.images->0->>'url'), p.status
  from variations v join products p on p.id = v.product_id where p.status <> 'archived'`;

inventory.get('/stock', requireStaff(), async (c) => {
  const { page, per, offset } = paging(c, { max: 1000 });
  const f = c.req.query();
  const w = new Where();
  if (f.q) {
    const like = w.param(`%${f.q.trim().toLowerCase()}%`);
    const exact = w.param(f.q.trim());
    w.parts.push(`(lower(s.name) like ${like} or s.sku = ${exact})`);
  }
  if (f.filter === 'out') w.parts.push(`s.stock_status = 'outofstock'`);
  if (f.filter === 'low') w.parts.push(`s.manage_stock and s.stock_quantity > 0 and s.stock_quantity <= coalesce(s.low_stock_amount, 3)`);
  if (f.filter === 'negative') w.parts.push('s.stock_quantity < 0');
  if (f.filter === 'untracked') w.parts.push('not s.manage_stock');
  if (f.supplier) w.add('s.supplier_id = ?', Number(f.supplier));
  if (f.category) w.add('exists (select 1 from product_categories pc where pc.product_id = s.product_id and pc.category_id = ?)', Number(f.category));
  const [{ total }] = await query(`select count(*)::int total from (${STOCK_ROWS}) s ${w.sql}`, w.params);
  const rows = await query(`
    select s.*, sp.name supplier_name,
      (select coalesce(sum(oi.quantity), 0)::int from order_items oi join orders o on o.id = oi.order_id
        where o.status in ('completed','processing','on-hold') and o.created_at > now() - interval '30 days'
          and oi.product_id = s.product_id and (s.variation_id is null or oi.variation_id = s.variation_id)) sold_30d
    from (${STOCK_ROWS}) s left join suppliers sp on sp.id = s.supplier_id ${w.sql}
    order by ${f.sort === 'qty' ? 's.stock_quantity asc nulls last' : f.sort === '-sold' ? 'sold_30d desc' : 's.name'} limit ${per} offset ${offset}`, w.params);
  return c.json({ items: rows, total, page, per_page: per });
});

inventory.get('/stock/summary', requireStaff(), async (c) => {
  const [s] = await query(`select
      count(*)::int lines,
      count(*) filter (where stock_status = 'outofstock')::int out_of_stock,
      count(*) filter (where manage_stock and stock_quantity > 0 and stock_quantity <= coalesce(low_stock_amount, 3))::int low_stock,
      count(*) filter (where stock_quantity < 0)::int negative,
      coalesce(sum(greatest(stock_quantity, 0) * cost) filter (where manage_stock), 0)::float8 value_cost,
      coalesce(sum(greatest(stock_quantity, 0) * price) filter (where manage_stock), 0)::float8 value_retail,
      coalesce(sum(greatest(stock_quantity, 0)) filter (where manage_stock), 0)::int units,
      count(*) filter (where manage_stock and cost is null)::int missing_cost
    from (${STOCK_ROWS}) s`);
  return c.json(s);
});

inventory.get('/stock/export', requireStaff('manager'), async (c) => {
  const rows = await query(`select s.product_id, s.variation_id, s.name, s.sku, s.stock_quantity, s.stock_status, s.cost, s.price, sp.name supplier
    from (${STOCK_ROWS}) s left join suppliers sp on sp.id = s.supplier_id order by s.name`);
  return c.body(toCsv(rows), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="stock.csv"' });
});

/** Adjust stock of many lines at once: [{product_id, variation_id, change|set, reason, note}] */
inventory.post('/stock/adjust', requireStaff('manager'), async (c) => {
  const { lines, reason = 'adjustment', note = '' } = await c.req.json();
  if (!Array.isArray(lines) || !lines.length) fail(400, 'Nothing to adjust');
  const staff = c.get('staff');
  const results = await tx(async (t) => {
    const out = [];
    for (const l of lines) {
      const table = l.variation_id ? 'variations' : 'products';
      const id = l.variation_id || l.product_id;
      // turn on stock tracking automatically when someone sets a quantity
      await t.query(`update ${table} set manage_stock = true, stock_quantity = coalesce(stock_quantity, 0) where id = $1 and not manage_stock`, [id]);
      const after = await moveStock(t, {
        product_id: l.product_id, variation_id: l.variation_id || null, change: Number(l.change) || 0,
        set: l.set !== undefined && l.set !== null && l.set !== '' ? Number(l.set) : null, reason: l.reason || reason, note: l.note || note, staff_id: staff.id, ref_type: 'manual',
      });
      out.push({ ...l, quantity_after: after });
    }
    return out;
  });
  await audit(staff, 'stock_adjust', 'stock', lines.length, { reason, note });
  return c.json(results);
});

inventory.get('/stock/movements', requireStaff(), async (c) => {
  const { page, per, offset } = paging(c);
  const f = c.req.query();
  const w = new Where();
  if (f.product) w.add('m.product_id = ?', Number(f.product));
  if (f.reason) w.add('m.reason = ?', f.reason);
  const rows = await query(`select m.*, p.name product_name, s.name staff_name from stock_movements m
    left join products p on p.id = m.product_id left join staff s on s.id = m.staff_id ${w.sql}
    order by m.created_at desc limit ${per} offset ${offset}`, w.params);
  return c.json({ items: rows, page, per_page: per });
});

/** Reorder suggestions: what sells and is running out, grouped by supplier */
inventory.get('/stock/reorder', requireStaff('manager'), async (c) => {
  const days = Number(c.req.query('days')) || 30;
  const rows = await query(`
    select s.*, sp.name supplier_name, sold,
      greatest(0, ceil(sold::numeric / $1::int * 30) - greatest(coalesce(s.stock_quantity, 0), 0))::int suggested
    from (select s.*, (select coalesce(sum(oi.quantity), 0)::int from order_items oi join orders o on o.id = oi.order_id
        where o.status in ('completed','processing','on-hold') and o.created_at > now() - make_interval(days => $1::int)
          and oi.product_id = s.product_id and (s.variation_id is null or oi.variation_id = s.variation_id)) sold
      from (${STOCK_ROWS}) s) s
    left join suppliers sp on sp.id = s.supplier_id
    where s.sold > 0 and s.manage_stock and coalesce(s.stock_quantity, 0) <= greatest(coalesce(s.low_stock_amount, 3), ceil(s.sold::numeric / $1::int * 14))
    order by sp.name nulls last, s.sold desc limit 500`, [days]);
  return c.json(rows);
});

// ---------------- Suppliers ----------------
const SUP_COLS = ['name', 'code', 'email', 'phone', 'website', 'address', 'currency', 'lead_time_days', 'notes', 'active'];
inventory.get('/suppliers', requireStaff(), async (c) => c.json(await query(`
  select s.*, (select count(*)::int from products p where p.supplier_id = s.id and p.status <> 'archived') product_count,
    (select count(*)::int from purchase_orders po where po.supplier_id = s.id) po_count,
    (select coalesce(sum(total), 0)::float8 from purchase_orders po where po.supplier_id = s.id and po.status <> 'cancelled') purchased
  from suppliers s order by s.name`)));
inventory.get('/suppliers/:id', requireStaff(), async (c) => {
  const id = Number(c.req.param('id'));
  const s = await one('select * from suppliers where id = $1', [id]);
  if (!s) fail(404, 'Supplier not found');
  const pos = await query('select id, number, status, total::float8, created_at, received_at from purchase_orders where supplier_id = $1 order by created_at desc', [id]);
  return c.json({ ...s, purchase_orders: pos });
});
inventory.post('/suppliers', requireStaff('manager'), async (c) => {
  const body = await c.req.json();
  if (!body.name?.trim()) fail(400, 'Name is required');
  return c.json(await tx((t) => insertRow(t, 'suppliers', pick(body, SUP_COLS, ['address']))), 201);
});
inventory.put('/suppliers/:id', requireStaff('manager'), async (c) => {
  return c.json(await tx(async (t) => updateRow(t, 'suppliers', Number(c.req.param('id')), pick(await c.req.json(), SUP_COLS, ['address']), { touch: false })));
});
inventory.delete('/suppliers/:id', requireStaff('manager'), async (c) => {
  await query('delete from suppliers where id = $1', [Number(c.req.param('id'))]);
  return c.json({ ok: true });
});

// ---------------- Purchase orders ----------------
inventory.get('/purchase-orders', requireStaff(), async (c) => {
  const { page, per, offset } = paging(c);
  const f = c.req.query();
  const w = new Where();
  if (f.status) w.add('po.status = ?', f.status);
  if (f.supplier) w.add('po.supplier_id = ?', Number(f.supplier));
  if (f.q) w.add(`(po.number ilike ? or exists (select 1 from jsonb_array_elements(po.items) i where i->>'name' ilike ?))`, `%${f.q}%`, `%${f.q}%`);
  const [{ total }] = await query(`select count(*)::int total from purchase_orders po ${w.sql}`, w.params);
  const rows = await query(`select po.id, po.number, po.status, po.total::float8, po.created_at, po.expected_at, po.received_at, s.name supplier_name,
      jsonb_array_length(po.items) line_count, (select coalesce(sum((i->>'qty')::int), 0)::int from jsonb_array_elements(po.items) i) unit_count
    from purchase_orders po left join suppliers s on s.id = po.supplier_id ${w.sql}
    order by po.created_at desc limit ${per} offset ${offset}`, w.params);
  return c.json({ items: rows, total, page, per_page: per });
});
inventory.get('/purchase-orders/:id', requireStaff(), async (c) => {
  const po = await one('select po.*, s.name supplier_name from purchase_orders po left join suppliers s on s.id = po.supplier_id where po.id = $1', [Number(c.req.param('id'))]);
  if (!po) fail(404, 'Purchase order not found');
  return c.json(po);
});

function poTotals(items) {
  const clean = (items || []).map((i) => ({
    product_id: i.product_id ? Number(i.product_id) : null, variation_id: i.variation_id ? Number(i.variation_id) : null,
    name: i.name, sku: i.sku || null, qty: Math.max(0, Number(i.qty) || 0), received_qty: Number(i.received_qty) || 0, cost: money(i.cost) || 0,
  }));
  return { items: clean, total: money(clean.reduce((s, i) => s + i.qty * i.cost, 0)) };
}

inventory.post('/purchase-orders', requireStaff('manager'), async (c) => {
  const body = await c.req.json();
  const { items, total } = poTotals(body.items);
  const row = await tx(async (t) => {
    const po = await insertRow(t, 'purchase_orders', {
      supplier_id: body.supplier_id || null, status: body.status === 'ordered' ? 'ordered' : 'draft', expected_at: body.expected_at || null,
      notes: body.notes || '', items: JSON.stringify(items), total,
    });
    await t.query('update purchase_orders set number = $2 where id = $1', [po.id, `PO-${po.id}`]);
    return po;
  });
  await audit(c.get('staff'), 'create', 'purchase_order', row.id);
  return c.json(row, 201);
});

inventory.put('/purchase-orders/:id', requireStaff('manager'), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const row = await tx(async (t) => {
    const [po] = await t.query('select * from purchase_orders where id = $1', [id]);
    if (!po) fail(404, 'Purchase order not found');
    const data = pick(body, ['supplier_id', 'expected_at', 'notes']);
    if (body.items) {
      if (po.status === 'received') fail(400, 'This purchase order is already received');
      const { items, total } = poTotals(body.items);
      data.items = JSON.stringify(items);
      data.total = total;
    }
    if (body.status && ['draft', 'ordered', 'cancelled'].includes(body.status)) data.status = body.status;
    return updateRow(t, 'purchase_orders', id, data);
  });
  return c.json(row);
});

/** Receive goods: adds stock and updates cost prices. body: { lines: [{index, qty}] } or { all: true } */
inventory.post('/purchase-orders/:id/receive', requireStaff('manager'), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const staff = c.get('staff');
  const row = await tx(async (t) => {
    const [po] = await t.query('select * from purchase_orders where id = $1 for update', [id]);
    if (!po) fail(404, 'Purchase order not found');
    if (['received', 'cancelled'].includes(po.status)) fail(400, `This purchase order is ${po.status}`);
    const items = typeof po.items === 'string' ? JSON.parse(po.items) : po.items;
    for (const [index, item] of items.entries()) {
      const remaining = item.qty - (item.received_qty || 0);
      const qty = body.all ? remaining : Math.min(remaining, Number(body.lines?.find((l) => l.index === index)?.qty) || 0);
      if (qty <= 0) continue;
      item.received_qty = (item.received_qty || 0) + qty;
      if (!item.product_id) continue;
      const table = item.variation_id ? 'variations' : 'products';
      const rid = item.variation_id || item.product_id;
      await t.query(`update ${table} set manage_stock = true, stock_quantity = coalesce(stock_quantity, 0) where id = $1 and not manage_stock`, [rid]);
      await moveStock(t, { product_id: item.product_id, variation_id: item.variation_id, change: qty, reason: 'purchase', ref_type: 'purchase_order', ref_id: id, staff_id: staff.id });
      if (item.cost) await t.query(`update ${table} set purchase_price = $2 where id = $1`, [rid, item.cost]);
    }
    const complete = items.every((i) => (i.received_qty || 0) >= i.qty);
    const [updated] = await t.query(`update purchase_orders set items = $2, status = $3, received_at = case when $3 = 'received' then now() else received_at end, updated_at = now()
      where id = $1 returning *`, [id, JSON.stringify(items), complete ? 'received' : 'partial']);
    return updated;
  });
  await audit(staff, 'receive', 'purchase_order', id);
  return c.json(row);
});

inventory.delete('/purchase-orders/:id', requireStaff('manager'), async (c) => {
  const po = await one('select status from purchase_orders where id = $1', [Number(c.req.param('id'))]);
  if (po && ['received', 'partial'].includes(po.status)) fail(400, 'Received purchase orders cannot be deleted (stock was already added)');
  await query('delete from purchase_orders where id = $1', [Number(c.req.param('id'))]);
  return c.json({ ok: true });
});
