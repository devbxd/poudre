import { Hono } from 'hono';
import { query, one, tx } from '../db.js';
import { requireStaff } from '../auth.js';
import { fail, pick, insertRow, updateRow, paging, Where, audit, toCsv } from '../lib.js';
import { createOrder, changeStatus, refundOrder } from '../orders.js';
import { emailsForStatus, sendOrderEmail } from '../mail.js';
import { sendToIcarry } from '../icarry.js';

export const sales = new Hono();

// ---------------- Orders ----------------
function orderFilters(f) {
  const w = new Where();
  if (f.q) {
    const like = w.param(`%${f.q.trim().toLowerCase()}%`);
    const exact = w.param(f.q.trim().replace(/^#/, ''));
    w.parts.push(`(o.number = ${exact} or lower(o.billing->>'first_name' || ' ' || coalesce(o.billing->>'last_name','')) like ${like}
      or lower(o.billing->>'email') like ${like} or o.billing->>'phone' like ${like}
      or exists (select 1 from order_items oi where oi.order_id = o.id and (lower(oi.name) like ${like} or oi.sku = ${exact})))`);
  }
  if (f.status) w.add('o.status = any(?)', f.status.split(','));
  if (f.channel) w.add('o.channel = ?', f.channel);
  if (f.customer) w.add('o.customer_id = ?', Number(f.customer));
  if (f.staff) w.add('o.staff_id = ?', Number(f.staff));
  if (f.payment) w.add('o.payment_method = ?', f.payment);
  if (f.from) w.add('o.created_at >= ?', f.from);
  if (f.to) w.add(`o.created_at < (?::date + interval '1 day')`, f.to);
  if (f.product) w.add('exists (select 1 from order_items oi where oi.order_id = o.id and oi.product_id = ?)', Number(f.product));
  return w;
}

sales.get('/orders', requireStaff(), async (c) => {
  const { page, per, offset } = paging(c);
  const f = c.req.query();
  const w = orderFilters(f);
  const [{ total, amount }] = await query(`select count(*)::int total, coalesce(sum(o.total - o.refunded_total), 0)::float8 amount from orders o ${w.sql}`, w.params);
  const rows = await query(`
    select o.id, o.number, o.status, o.channel, o.total::float8, o.refunded_total::float8, o.payment_method, o.payment_title, o.created_at,
      o.billing->>'first_name' first_name, o.billing->>'last_name' last_name, o.billing->>'phone' phone, o.billing->>'email' email,
      o.customer_id, s.name staff_name,
      (select coalesce(sum(quantity), 0)::int from order_items where order_id = o.id) item_count,
      (select string_agg(name, ', ') from (select name from order_items where order_id = o.id limit 3) x) items_preview
    from orders o left join staff s on s.id = o.staff_id ${w.sql}
    order by o.created_at desc limit ${per} offset ${offset}`, w.params);
  const counts = await query('select status, count(*)::int n from orders group by status');
  return c.json({ items: rows, total, amount, page, per_page: per, counts: Object.fromEntries(counts.map((r) => [r.status, r.n])) });
});

sales.get('/orders/export', requireStaff('manager'), async (c) => {
  const w = orderFilters(c.req.query());
  const rows = await query(`
    select o.number, o.created_at, o.status, o.channel, o.billing->>'first_name' first_name, o.billing->>'last_name' last_name,
      o.billing->>'phone' phone, o.billing->>'email' email, o.billing->>'city' city, o.subtotal, o.discount_total, o.shipping_total, o.total, o.refunded_total,
      o.payment_title, s.name cashier, (select string_agg(quantity || ' x ' || name, ' | ') from order_items where order_id = o.id) items
    from orders o left join staff s on s.id = o.staff_id ${w.sql} order by o.created_at desc`, w.params);
  return c.body(toCsv(rows), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="orders.csv"' });
});

export async function fullOrder(id) {
  const order = await one(`select o.*, s.name staff_name from orders o left join staff s on s.id = o.staff_id where o.id = $1`, [id]);
  if (!order) fail(404, 'Order not found');
  const [items, notes, refunds, customer] = await Promise.all([
    query(`select oi.*, coalesce(v.image->>'url', p.images->0->>'url') image from order_items oi
      left join products p on p.id = oi.product_id left join variations v on v.id = oi.variation_id where oi.order_id = $1 order by oi.id`, [id]),
    query('select * from order_notes where order_id = $1 order by created_at desc', [id]),
    query('select r.*, s.name staff_name from refunds r left join staff s on s.id = r.staff_id where r.order_id = $1 order by r.created_at desc', [id]),
    order.customer_id ? one('select id, first_name, last_name, email, phone from customers where id = $1', [order.customer_id]) : null,
  ]);
  return { ...order, items, notes, refunds, customer };
}

sales.get('/orders/:id', requireStaff(), async (c) => c.json(await fullOrder(Number(c.req.param('id')))));

sales.post('/orders', requireStaff('manager'), async (c) => {
  const body = await c.req.json();
  const staff = c.get('staff');
  const order = await tx((t) => createOrder(t, body, { channel: 'manual', staff, allowOverride: true }));
  await audit(staff, 'create', 'order', order.id);
  return c.json(await fullOrder(order.id), 201);
});

sales.put('/orders/:id', requireStaff('manager'), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const staff = c.get('staff');
  let statusChanged = false;
  await tx(async (t) => {
    if (body.status) {
      const [cur] = await t.query('select status from orders where id = $1', [id]);
      if (cur && cur.status !== body.status) { await changeStatus(t, id, body.status, staff); statusChanged = true; }
    }
    const data = pick(body, ['billing', 'shipping', 'customer_note', 'payment_method', 'payment_title', 'shipping_method', 'customer_id'], ['billing', 'shipping']);
    if (Object.keys(data).length) await updateRow(t, 'orders', id, data);
  });
  await audit(staff, 'update', 'order', id, { status: body.status });
  if (statusChanged) await emailsForStatus(id, body.status);
  return c.json(await fullOrder(id));
});

sales.post('/orders/bulk', requireStaff('manager'), async (c) => {
  const { ids, status } = await c.req.json();
  const staff = c.get('staff');
  await tx(async (t) => { for (const id of ids) await changeStatus(t, Number(id), status, staff); });
  for (const id of ids) await emailsForStatus(Number(id), status);
  return c.json({ ok: true });
});

sales.post('/orders/:id/notes', requireStaff(), async (c) => {
  const { note, customer_visible } = await c.req.json();
  if (!note?.trim()) fail(400, 'Note is empty');
  const row = await tx((t) => insertRow(t, 'order_notes', { order_id: Number(c.req.param('id')), note, customer_visible: !!customer_visible, author: c.get('staff').name }));
  if (customer_visible) await sendOrderEmail('customer_note', row.order_id, { note });
  return c.json(row, 201);
});

sales.post('/orders/:id/icarry', requireStaff('manager'), async (c) => {
  const id = Number(c.req.param('id'));
  const r = await sendToIcarry(id, { force: true });
  if (!r.ok) fail(400, r.error);
  await audit(c.get('staff'), 'icarry', 'order', id);
  return c.json(await fullOrder(id));
});

sales.post('/orders/:id/refund', requireStaff('manager'), async (c) => {
  const id = Number(c.req.param('id'));
  const staff = c.get('staff');
  await tx(async (t) => refundOrder(t, id, await c.req.json(), staff));
  await audit(staff, 'refund', 'order', id);
  const after = await one('select channel, status from orders where id = $1', [id]);
  if (after?.channel === 'online') await sendOrderEmail('customer_refunded', id, { partial: after.status !== 'refunded' });
  return c.json(await fullOrder(id));
});

sales.delete('/orders/:id', requireStaff('owner'), async (c) => {
  const id = Number(c.req.param('id'));
  await tx(async (t) => {
    const [o] = await t.query('select status from orders where id = $1', [id]);
    if (o && !['cancelled', 'refunded', 'failed', 'pending'].includes(o.status)) await changeStatus(t, id, 'cancelled', c.get('staff'));
    await t.query('delete from orders where id = $1', [id]);
  });
  await audit(c.get('staff'), 'delete', 'order', id);
  return c.json({ ok: true });
});

// ---------------- Customers ----------------
sales.get('/customers', requireStaff(), async (c) => {
  const { page, per, offset } = paging(c);
  const f = c.req.query();
  const w = new Where();
  if (f.q) {
    const like = w.param(`%${f.q.trim().toLowerCase()}%`);
    w.parts.push(`(lower(c.first_name || ' ' || c.last_name) like ${like} or lower(c.email) like ${like} or c.phone like ${like})`);
  }
  const sorts = { '-spent': 'spent desc', '-orders': 'order_count desc', '-last': 'last_order desc nulls last', name: 'c.first_name asc' };
  const [{ total }] = await query(`select count(*)::int total from customers c ${w.sql}`, w.params);
  const rows = await query(`
    select c.id, c.first_name, c.last_name, c.email, c.phone, c.billing->>'city' city, c.created_at, c.tags,
      count(o.id)::int order_count, coalesce(sum(o.total - o.refunded_total), 0)::float8 spent, max(o.created_at) last_order
    from customers c left join orders o on o.customer_id = c.id and o.status in ('completed','processing','on-hold')
    ${w.sql} group by c.id order by ${sorts[f.sort] || 'c.created_at desc'} limit ${per} offset ${offset}`, w.params);
  return c.json({ items: rows, total, page, per_page: per });
});

sales.get('/customers/:id', requireStaff(), async (c) => {
  const id = Number(c.req.param('id'));
  const customer = await one('select id, first_name, last_name, email, phone, billing, shipping, notes, tags, created_at, password_hash is not null has_account from customers where id = $1', [id]);
  if (!customer) fail(404, 'Customer not found');
  const orders = await query('select id, number, status, channel, total::float8, created_at from orders where customer_id = $1 order by created_at desc', [id]);
  const [stats] = await query(`select count(*)::int orders, coalesce(sum(total - refunded_total), 0)::float8 spent, coalesce(avg(total), 0)::float8 average
    from orders where customer_id = $1 and status in ('completed','processing','on-hold')`, [id]);
  const top = await query(`select oi.name, sum(oi.quantity)::int qty from order_items oi join orders o on o.id = oi.order_id
    where o.customer_id = $1 group by oi.name order by qty desc limit 5`, [id]);
  return c.json({ ...customer, orders, stats, top_products: top });
});

const CUSTOMER_COLS = ['first_name', 'last_name', 'email', 'phone', 'billing', 'shipping', 'notes', 'tags'];
sales.post('/customers', requireStaff(), async (c) => {
  const body = await c.req.json();
  if (!body.first_name && !body.phone && !body.email) fail(400, 'Add at least a name, phone or email');
  if (body.email) {
    const dup = await one('select id from customers where lower(email) = lower($1)', [body.email]);
    if (dup) fail(400, 'A customer with this email already exists');
  }
  const row = await tx((t) => insertRow(t, 'customers', pick({ billing: {}, shipping: {}, ...body }, CUSTOMER_COLS, ['billing', 'shipping'])));
  return c.json(row, 201);
});
sales.put('/customers/:id', requireStaff(), async (c) => {
  const row = await tx(async (t) => updateRow(t, 'customers', Number(c.req.param('id')), pick(await c.req.json(), CUSTOMER_COLS, ['billing', 'shipping'])));
  return c.json(row);
});
sales.delete('/customers/:id', requireStaff('manager'), async (c) => {
  await query('delete from customers where id = $1', [Number(c.req.param('id'))]);
  return c.json({ ok: true });
});

// ---------------- Coupons ----------------
const COUPON_COLS = ['code', 'type', 'amount', 'description', 'expires_at', 'min_amount', 'max_amount', 'usage_limit', 'usage_limit_per_user', 'individual_use',
  'free_shipping', 'exclude_sale_items', 'product_ids', 'excluded_product_ids', 'category_ids', 'excluded_category_ids', 'active'];
sales.get('/coupons', requireStaff(), async (c) => c.json(await query(`select c.*, (select coalesce(sum(o.discount_total),0)::float8 from orders o where c.code = any(o.coupon_codes)) discount_given from coupons c order by created_at desc`)));
sales.post('/coupons', requireStaff('manager'), async (c) => {
  const body = await c.req.json();
  if (!body.code?.trim()) fail(400, 'Code is required');
  body.code = body.code.trim().toLowerCase();
  if (await one('select id from coupons where code = $1', [body.code])) fail(400, 'This code already exists');
  return c.json(await tx((t) => insertRow(t, 'coupons', pick(body, COUPON_COLS))), 201);
});
sales.put('/coupons/:id', requireStaff('manager'), async (c) => {
  const body = await c.req.json();
  if (body.code) body.code = body.code.trim().toLowerCase();
  return c.json(await tx((t) => updateRow(t, 'coupons', Number(c.req.param('id')), pick(body, COUPON_COLS), { touch: false })));
});
sales.delete('/coupons/:id', requireStaff('manager'), async (c) => {
  await query('delete from coupons where id = $1', [Number(c.req.param('id'))]);
  return c.json({ ok: true });
});

// ---------------- Reviews ----------------
sales.get('/reviews', requireStaff(), async (c) => {
  const status = c.req.query('status');
  return c.json(await query(`select r.*, p.name product_name, p.slug product_slug from reviews r left join products p on p.id = r.product_id
    ${status ? 'where r.status = $1' : ''} order by r.created_at desc limit 500`, status ? [status] : []));
});
sales.put('/reviews/:id', requireStaff('manager'), async (c) => {
  const id = Number(c.req.param('id'));
  const row = await tx(async (t) => updateRow(t, 'reviews', id, pick(await c.req.json(), ['status', 'content', 'rating', 'author']), { touch: false }));
  await refreshRating(row.product_id);
  return c.json(row);
});
sales.delete('/reviews/spam', requireStaff('manager'), async (c) => {
  const rows = await query(`delete from reviews where status = 'spam' returning id`);
  return c.json({ deleted: rows.length });
});
sales.delete('/reviews/:id', requireStaff('manager'), async (c) => {
  const row = await one('delete from reviews where id = $1 returning product_id', [Number(c.req.param('id'))]);
  if (row) await refreshRating(row.product_id);
  return c.json({ ok: true });
});

export async function refreshRating(productId) {
  await query(`update products set average_rating = coalesce((select avg(rating) from reviews where product_id = $1 and status = 'approved'), 0),
    rating_count = (select count(*) from reviews where product_id = $1 and status = 'approved') where id = $1`, [productId]);
}
