import { Hono } from 'hono';
import { query, one, tx } from '../db.js';
import { requireStaff, ROLES } from '../auth.js';
import { fail, money, getSetting, audit, insertRow } from '../lib.js';
import { createOrder, refundOrder } from '../orders.js';
import { fullOrder } from './sales.js';

export const pos = new Hono();

/** Whole sellable catalogue in one compact payload — the POS searches it in the browser for instant results. */
pos.get('/catalog', requireStaff(), async (c) => {
  const products = await query(`
    select p.id, p.type, p.name, p.sku, p.barcode, p.regular_price::float8, p.sale_price::float8, p.sale_from, p.sale_to,
      p.manage_stock, p.stock_quantity, p.stock_status, p.images->0->>'url' image, p.total_sales,
      coalesce((select array_agg(category_id) from product_categories where product_id = p.id), '{}') category_ids,
      (select b.name from product_brands pb join brands b on b.id = pb.brand_id where pb.product_id = p.id limit 1) brand
    from products p where p.status in ('publish','private') and p.pos_visible order by p.total_sales desc, p.name`);
  const variations = await query(`
    select v.id, v.product_id, v.sku, v.barcode, v.attributes, coalesce(v.regular_price, p.regular_price)::float8 regular_price, v.sale_price::float8,
      v.sale_from, v.sale_to, v.manage_stock, v.stock_quantity, v.stock_status, v.image->>'url' image
    from variations v join products p on p.id = v.product_id where p.status in ('publish','private') and p.pos_visible and v.status = 'publish' order by v.menu_order, v.id`);
  const categories = await query(`select id, parent_id, name, image, menu_order from categories where pos_visible order by menu_order, name`);
  const byProduct = new Map();
  for (const v of variations) {
    const list = byProduct.get(v.product_id) || [];
    list.push(v);
    byProduct.set(v.product_id, list);
  }
  for (const p of products) if (p.type === 'variable') p.variations = byProduct.get(p.id) || [];
  return c.json({ products, categories, settings: await getSetting('pos', {}), store: await getSetting('store', {}), payments: await getSetting('payments', []) });
});

/** Fresh stock of a few items (after a sale or before checkout) */
pos.post('/stock', requireStaff(), async (c) => {
  const { ids = [] } = await c.req.json();
  const rows = await query(`select id, null::int variation_id, stock_quantity, stock_status from products where id = any($1::int[])
    union all select product_id, id, stock_quantity, stock_status from variations where product_id = any($1::int[])`, [ids.map(Number)]);
  return c.json(rows);
});

pos.post('/orders', requireStaff(), async (c) => {
  const body = await c.req.json();
  const staff = c.get('staff');
  const settings = await getSetting('pos', {});
  const session = await one('select id from cash_sessions where closed_at is null order by opened_at desc limit 1');
  if (settings.require_session && !session) fail(400, 'Open the cash register first');
  // cashiers may change prices / give discounts only if the owner allows it
  const allowOverride = ROLES[staff.role] >= ROLES.manager || settings.cashier_discounts !== false;
  const order = await tx((t) => createOrder(t, { ...body, cash_session_id: session?.id }, {
    channel: 'pos', staff, allowOverride, enforceStock: settings.allow_negative_stock === false,
  }));
  return c.json(await fullOrder(order.id), 201);
});

pos.get('/orders', requireStaff(), async (c) => {
  const q = (c.req.query('q') || '').trim();
  const rows = await query(`
    select o.id, o.number, o.status, o.total::float8, o.refunded_total::float8, o.payment_title, o.payment_method, o.created_at, o.billing->>'first_name' first_name,
      o.billing->>'last_name' last_name, s.name staff_name, (select sum(quantity)::int from order_items where order_id = o.id) item_count
    from orders o left join staff s on s.id = o.staff_id
    where ($1 = '' or o.number = $1 or o.billing->>'phone' like '%' || $1 || '%' or lower(o.billing->>'first_name') like lower($1) || '%')
    order by o.created_at desc limit 60`, [q.replace(/^#/, '')]);
  return c.json(rows);
});

pos.get('/orders/:id', requireStaff(), async (c) => c.json(await fullOrder(Number(c.req.param('id')))));

pos.post('/orders/:id/refund', requireStaff(), async (c) => {
  const staff = c.get('staff');
  const settings = await getSetting('pos', {});
  if (ROLES[staff.role] < ROLES.manager && settings.cashier_refunds === false) fail(403, 'Ask a manager to make this refund');
  const id = Number(c.req.param('id'));
  await tx(async (t) => refundOrder(t, id, await c.req.json(), staff));
  await audit(staff, 'refund', 'order', id, { via: 'pos' });
  return c.json(await fullOrder(id));
});

// ---------------- Cash register sessions ----------------
async function sessionTotals(session) {
  const [cash] = await query(`select coalesce(sum(total - refunded_total), 0)::float8 cash from orders
    where cash_session_id = $1 and payment_method = 'cash' and status in ('completed','processing','on-hold')`, [session.id]);
  const byMethod = await query(`select coalesce(payment_title, payment_method) method, count(*)::int orders, sum(total - refunded_total)::float8 total
    from orders where cash_session_id = $1 and status in ('completed','processing','on-hold') group by 1`, [session.id]);
  const moves = typeof session.cash_in_out === 'string' ? JSON.parse(session.cash_in_out) : session.cash_in_out || [];
  const movesTotal = moves.reduce((s, m) => s + Number(m.amount), 0);
  return { cash_sales: cash.cash, by_method: byMethod, cash_moves: movesTotal, expected_cash: money(Number(session.opening_cash) + cash.cash + movesTotal) };
}

pos.get('/session', requireStaff(), async (c) => {
  const s = await one('select cs.*, st.name staff_name from cash_sessions cs left join staff st on st.id = cs.staff_id where closed_at is null order by opened_at desc limit 1');
  return c.json(s ? { ...s, ...(await sessionTotals(s)) } : null);
});

pos.post('/session/open', requireStaff(), async (c) => {
  if (await one('select id from cash_sessions where closed_at is null')) fail(400, 'The register is already open');
  const { opening_cash = 0, notes = '' } = await c.req.json();
  const row = await tx((t) => insertRow(t, 'cash_sessions', { staff_id: c.get('staff').id, opening_cash: money(opening_cash) || 0, notes }));
  await audit(c.get('staff'), 'open', 'cash_session', row.id);
  return c.json(row, 201);
});

pos.post('/session/cash', requireStaff(), async (c) => {
  const { amount, reason = '' } = await c.req.json();
  if (!Number(amount)) fail(400, 'Enter an amount');
  const s = await one('select * from cash_sessions where closed_at is null limit 1');
  if (!s) fail(400, 'The register is closed');
  const moves = typeof s.cash_in_out === 'string' ? JSON.parse(s.cash_in_out) : s.cash_in_out || [];
  moves.push({ amount: money(amount), reason, at: new Date().toISOString(), by: c.get('staff').name });
  await query('update cash_sessions set cash_in_out = $2 where id = $1', [s.id, JSON.stringify(moves)]);
  return c.json({ ok: true });
});

pos.post('/session/close', requireStaff(), async (c) => {
  const { closing_cash, notes = '' } = await c.req.json();
  const s = await one('select * from cash_sessions where closed_at is null limit 1');
  if (!s) fail(400, 'The register is already closed');
  const totals = await sessionTotals(s);
  const row = await one(`update cash_sessions set closed_at = now(), closing_cash = $2, expected_cash = $3, notes = trim(notes || ' ' || $4) where id = $1 returning *`,
    [s.id, money(closing_cash) || 0, totals.expected_cash, notes]);
  await audit(c.get('staff'), 'close', 'cash_session', s.id, { closing_cash, expected: totals.expected_cash });
  return c.json({ ...row, ...totals });
});

pos.get('/sessions', requireStaff('manager'), async (c) => c.json(await query(`
  select cs.*, st.name staff_name, (select count(*)::int from orders o where o.cash_session_id = cs.id) orders,
    (select coalesce(sum(total - refunded_total), 0)::float8 from orders o where o.cash_session_id = cs.id and status in ('completed','processing','on-hold')) revenue
  from cash_sessions cs left join staff st on st.id = cs.staff_id order by opened_at desc limit 100`)));
