import { Hono } from 'hono';
import { query } from '../db.js';
import { requireStaff } from '../auth.js';
import { fail, toCsv } from '../lib.js';

export const reports = new Hono();

const PAID = `o.status in ('completed','processing','on-hold')`;

function range(c) {
  const to = c.req.query('to') || new Date().toISOString().slice(0, 10);
  const from = c.req.query('from') || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const prevTo = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(from).getTime() - days * 86400000).toISOString().slice(0, 10);
  const channel = c.req.query('channel') || null;
  return { from, to, days, prevFrom, prevTo, channel };
}

// Dates are compared in the shop's timezone (Beirut) so "today" means the shop's day
const TZ = `'Asia/Beirut'`;
const inRange = (a, b) => `(o.created_at at time zone ${TZ})::date between ${a}::date and ${b}::date`;

async function totals(from, to, channel) {
  const [r] = await query(`
    select count(*)::int orders, coalesce(sum(o.total - o.refunded_total), 0)::float8 revenue,
      coalesce(avg(o.total), 0)::float8 average, coalesce(sum(o.discount_total), 0)::float8 discounts,
      coalesce((select sum(oi.quantity - oi.refunded_qty) from order_items oi join orders o on o.id = oi.order_id
        where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3)), 0)::int items,
      coalesce((select sum(oi.total - coalesce(oi.purchase_price, 0) * (oi.quantity - oi.refunded_qty)) from order_items oi join orders o on o.id = oi.order_id
        where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3) and oi.purchase_price is not null), 0)::float8 profit,
      coalesce((select sum(oi.total) from order_items oi join orders o on o.id = oi.order_id
        where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3) and oi.purchase_price is not null), 0)::float8 revenue_with_cost
    from orders o where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3)`, [from, to, channel]);
  return r;
}

reports.get('/overview', requireStaff(), async (c) => {
  const { from, to, prevFrom, prevTo, channel, days } = range(c);
  const p = [from, to, channel];
  const [current, previous, series, channels, payments, topProducts, topCategories, topBrands, hours, staff, recent, stock, pending, today] = await Promise.all([
    totals(from, to, channel),
    totals(prevFrom, prevTo, channel),
    query(`select d::date as day, coalesce(x.revenue, 0)::float8 revenue, coalesce(x.orders, 0)::int orders
      from generate_series($1::date, $2::date, '1 day') d
      left join (select (o.created_at at time zone ${TZ})::date as day, sum(o.total - o.refunded_total) as revenue, count(*) as orders from orders o
        where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3) group by 1) x on x.day = d::date order by d`, p),
    query(`select o.channel, count(*)::int orders, sum(o.total - o.refunded_total)::float8 revenue from orders o
      where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3) group by 1 order by 3 desc`, p),
    query(`select coalesce(o.payment_title, o.payment_method, 'Other') method, count(*)::int orders, sum(o.total - o.refunded_total)::float8 revenue from orders o
      where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3) group by 1 order by 3 desc`, p),
    query(`select oi.product_id id, max(oi.name) name, sum(oi.quantity - oi.refunded_qty)::int qty, sum(oi.total)::float8 revenue,
        (select images->0->>'url' from products where id = oi.product_id) image
      from order_items oi join orders o on o.id = oi.order_id where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3)
      group by oi.product_id order by revenue desc limit 10`, p),
    query(`select c.id, c.name, sum(oi.quantity)::int qty, sum(oi.total)::float8 revenue
      from order_items oi join orders o on o.id = oi.order_id join product_categories pc on pc.product_id = oi.product_id join categories c on c.id = pc.category_id
      where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3) and c.parent_id is null group by c.id order by revenue desc limit 8`, p),
    query(`select b.id, b.name, sum(oi.quantity)::int qty, sum(oi.total)::float8 revenue
      from order_items oi join orders o on o.id = oi.order_id join product_brands pb on pb.product_id = oi.product_id join brands b on b.id = pb.brand_id
      where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3) group by b.id order by revenue desc limit 8`, p),
    query(`select extract(dow from o.created_at at time zone ${TZ})::int as dow, extract(hour from o.created_at at time zone ${TZ})::int as hour, count(*)::int as orders
      from orders o where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3) group by 1, 2`, p),
    query(`select s.id, s.name, count(*)::int orders, sum(o.total - o.refunded_total)::float8 revenue from orders o join staff s on s.id = o.staff_id
      where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3) group by s.id order by revenue desc`, p),
    query(`select o.id, o.number, o.status, o.channel, o.total::float8, o.created_at, o.billing->>'first_name' first_name, o.billing->>'last_name' last_name
      from orders o order by o.created_at desc limit 8`),
    query(`select count(*) filter (where p.stock_status = 'outofstock' and p.status = 'publish')::int out_of_stock,
      count(*) filter (where p.manage_stock and p.stock_quantity > 0 and p.stock_quantity <= coalesce(p.low_stock_amount, 3) and p.status = 'publish')::int low_stock
      from products p`),
    query(`select count(*)::int n from orders where status in ('processing','on-hold','pending') and channel = 'online'`),
    totals(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Beirut' }), new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Beirut' }), channel),
  ]);
  return c.json({ range: { from, to, days, prevFrom, prevTo }, current, previous, today, series, channels, payments, topProducts, topCategories, topBrands, hours, staff, recent, stock: stock[0], pending_online: pending[0].n });
});

const GROUPS = {
  product: { select: `oi.product_id id, max(oi.name) label, max(oi.sku) sku`, join: '', group: 'oi.product_id' },
  variation: { select: `coalesce(oi.variation_id, oi.product_id) id, max(oi.name) label, max(oi.sku) sku`, join: '', group: 'coalesce(oi.variation_id, oi.product_id)' },
  category: { select: `c.id, c.name label`, join: 'join product_categories pc on pc.product_id = oi.product_id join categories c on c.id = pc.category_id', group: 'c.id' },
  brand: { select: `b.id, b.name label`, join: 'join product_brands pb on pb.product_id = oi.product_id join brands b on b.id = pb.brand_id', group: 'b.id' },
  supplier: { select: `sp.id, sp.name label`, join: 'join products pp on pp.id = oi.product_id join suppliers sp on sp.id = pp.supplier_id', group: 'sp.id' },
  staff: { select: `s.id, s.name label`, join: 'join staff s on s.id = o.staff_id', group: 's.id' },
  payment: { select: `coalesce(o.payment_title, o.payment_method) id, coalesce(o.payment_title, o.payment_method) label`, join: '', group: '1' },
  channel: { select: `o.channel id, o.channel label`, join: '', group: 'o.channel' },
  day: { select: `to_char(o.created_at at time zone ${TZ}, 'YYYY-MM-DD') id, to_char(o.created_at at time zone ${TZ}, 'YYYY-MM-DD') label`, join: '', group: '1' },
  month: { select: `to_char(o.created_at at time zone ${TZ}, 'YYYY-MM') id, to_char(o.created_at at time zone ${TZ}, 'YYYY-MM') label`, join: '', group: '1' },
  hour: { select: `extract(hour from o.created_at at time zone ${TZ})::int id, lpad(extract(hour from o.created_at at time zone ${TZ})::text, 2, '0') || ':00' label`, join: '', group: '1' },
  customer: { select: `o.customer_id id, max(coalesce(nullif(trim(o.billing->>'first_name' || ' ' || coalesce(o.billing->>'last_name', '')), ''), 'Walk-in')) label`, join: '', group: 'o.customer_id' },
};

async function salesReport(c) {
  const { from, to, channel } = range(c);
  const g = GROUPS[c.req.query('group') || 'product'];
  if (!g) fail(400, 'Unknown report');
  return query(`
    select ${g.select}, count(distinct o.id)::int orders, sum(oi.quantity - oi.refunded_qty)::int qty,
      sum(oi.total)::float8 revenue, sum(oi.subtotal - oi.total)::float8 discounts,
      sum(coalesce(oi.purchase_price, 0) * (oi.quantity - oi.refunded_qty)) filter (where oi.purchase_price is not null)::float8 cost,
      sum(oi.total - coalesce(oi.purchase_price, 0) * (oi.quantity - oi.refunded_qty)) filter (where oi.purchase_price is not null)::float8 profit
    from order_items oi join orders o on o.id = oi.order_id ${g.join}
    where ${PAID} and ${inRange('$1', '$2')} and ($3::text is null or o.channel = $3)
    group by ${g.group} order by ${['day', 'month', 'hour'].includes(c.req.query('group')) ? '1' : 'revenue desc'} limit 2000`, [from, to, channel]);
}

reports.get('/sales', requireStaff('manager'), async (c) => c.json(await salesReport(c)));
reports.get('/sales/export', requireStaff('manager'), async (c) => {
  const rows = await salesReport(c);
  return c.body(toCsv(rows), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sales-${c.req.query('group') || 'product'}.csv"` });
});

/** Products that did not sell in the period (dead stock) */
reports.get('/dead-stock', requireStaff('manager'), async (c) => {
  const days = Number(c.req.query('days')) || 90;
  return c.json(await query(`
    select p.id, p.name, p.sku, p.stock_quantity, p.purchase_price::float8 cost, (p.stock_quantity * p.purchase_price)::float8 value,
      (select max(o.created_at) from order_items oi join orders o on o.id = oi.order_id where oi.product_id = p.id) last_sold
    from products p where p.status = 'publish' and p.manage_stock and p.stock_quantity > 0
      and not exists (select 1 from order_items oi join orders o on o.id = oi.order_id where oi.product_id = p.id and o.created_at > now() - make_interval(days => $1::int))
    order by value desc nulls last limit 500`, [days]));
});

/** End-of-day report (Z report) for the POS */
reports.get('/day', requireStaff(), async (c) => {
  const day = c.req.query('date') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Beirut' });
  const [summary] = await query(`
    select count(*)::int orders, coalesce(sum(o.total), 0)::float8 gross, coalesce(sum(o.refunded_total), 0)::float8 refunds,
      coalesce(sum(o.discount_total), 0)::float8 discounts, coalesce(sum(o.total - o.refunded_total), 0)::float8 net
    from orders o where ${PAID} and ${inRange('$1', '$1')}`, [day]);
  const byPayment = await query(`select coalesce(o.payment_title, o.payment_method) method, count(*)::int orders, sum(o.total - o.refunded_total)::float8 total
    from orders o where ${PAID} and ${inRange('$1', '$1')} group by 1 order by 3 desc`, [day]);
  const byStaff = await query(`select coalesce(s.name, 'Online') name, count(*)::int orders, sum(o.total - o.refunded_total)::float8 total
    from orders o left join staff s on s.id = o.staff_id where ${PAID} and ${inRange('$1', '$1')} group by 1 order by 3 desc`, [day]);
  const items = await query(`select max(oi.name) name, sum(oi.quantity - oi.refunded_qty)::int qty, sum(oi.total)::float8 total
    from order_items oi join orders o on o.id = oi.order_id where ${PAID} and ${inRange('$1', '$1')} group by coalesce(oi.variation_id, oi.product_id), oi.name order by qty desc`, [day]);
  return c.json({ day, summary, byPayment, byStaff, items });
});
