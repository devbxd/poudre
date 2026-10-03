import { fail, money, effectivePrice, moveStock, insertRow } from './lib.js';

const REDUCES_STOCK = new Set(['processing', 'on-hold', 'completed']);

/** Validates a coupon against a cart. Returns { coupon, discount } or throws. */
export async function applyCoupon(t, code, lines, customerEmail = null) {
  const [coupon] = await t.query('select * from coupons where lower(code) = lower($1)', [code.trim()]);
  if (!coupon || !coupon.active) fail(400, `Coupon "${code}" does not exist`);
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) fail(400, `Coupon "${code}" has expired`);
  if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) fail(400, `Coupon "${code}" usage limit reached`);
  if (coupon.usage_limit_per_user && customerEmail) {
    const [{ n }] = await t.query(`select count(*)::int n from orders where $1 = any(coupon_codes) and lower(billing->>'email') = lower($2) and status not in ('cancelled','failed')`, [coupon.code, customerEmail]);
    if (n >= coupon.usage_limit_per_user) fail(400, `Coupon "${code}" already used`);
  }
  const productIds = (coupon.product_ids || []).map(Number);
  const excluded = (coupon.excluded_product_ids || []).map(Number);
  const catIds = (coupon.category_ids || []).map(Number);
  const exCatIds = (coupon.excluded_category_ids || []).map(Number);
  const eligible = lines.filter((l) => {
    if (coupon.exclude_sale_items && l.on_sale) return false;
    if (excluded.includes(l.product_id)) return false;
    if (exCatIds.length && l.category_ids.some((c) => exCatIds.includes(c))) return false;
    if (productIds.length && !productIds.includes(l.product_id)) return false;
    if (catIds.length && !l.category_ids.some((c) => catIds.includes(c))) return false;
    return true;
  });
  const base = eligible.reduce((s, l) => s + l.subtotal, 0);
  const cartTotal = lines.reduce((s, l) => s + l.subtotal, 0);
  if (coupon.min_amount && cartTotal < Number(coupon.min_amount)) fail(400, `Minimum spend for "${code}" is ${coupon.min_amount}`);
  if (coupon.max_amount && cartTotal > Number(coupon.max_amount)) fail(400, `Maximum spend for "${code}" is ${coupon.max_amount}`);
  if (!eligible.length) fail(400, `Coupon "${code}" does not apply to these products`);
  let discount = 0;
  if (coupon.type === 'percent') discount = (base * Number(coupon.amount)) / 100;
  else if (coupon.type === 'fixed_cart') discount = Math.min(Number(coupon.amount), base);
  else discount = eligible.reduce((s, l) => s + Math.min(Number(coupon.amount), l.price) * l.quantity, 0);
  return { coupon, discount: money(discount), free_shipping: coupon.free_shipping };
}

/** Loads catalogue data for cart lines and prices them from the database (never trust client prices). */
export async function priceLines(t, items, { allowOverride = false } = {}) {
  const lines = [];
  for (const it of items) {
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
    if (it.custom) {
      // POS custom/quick item without a catalogue product
      if (!allowOverride) fail(400, 'Custom items are not allowed');
      const price = money(it.price) ?? 0;
      lines.push({ product_id: null, variation_id: null, name: it.name || 'Custom item', sku: null, quantity: qty, price, regular: price, on_sale: false, purchase_price: null, subtotal: money(price * qty), category_ids: [], manage_stock: false });
      continue;
    }
    const [p] = await t.query(
      `select p.*, coalesce(array_agg(pc.category_id) filter (where pc.category_id is not null), '{}') category_ids
       from products p left join product_categories pc on pc.product_id = p.id where p.id = $1 group by p.id`, [it.product_id]);
    if (!p) fail(400, `Product ${it.product_id} not found`);
    let src = p;
    let name = p.name;
    if (p.type === 'variable') {
      if (!it.variation_id) fail(400, `Please choose an option for "${p.name}"`);
      const [v] = await t.query('select * from variations where id = $1 and product_id = $2', [it.variation_id, p.id]);
      if (!v) fail(400, `Option not found for "${p.name}"`);
      src = { ...v, regular_price: v.regular_price ?? p.regular_price, purchase_price: v.purchase_price ?? p.purchase_price };
      const opts = (typeof v.attributes === 'string' ? JSON.parse(v.attributes) : v.attributes).map((a) => a.option).filter(Boolean);
      if (opts.length) name = `${p.name} - ${opts.join(', ')}`;
    }
    const { price: dbPrice, regular, on_sale } = effectivePrice(src);
    const price = allowOverride && it.price !== undefined && it.price !== null ? money(it.price) : dbPrice;
    lines.push({
      product_id: p.id, variation_id: p.type === 'variable' ? Number(it.variation_id) : null, name, sku: src.sku || p.sku,
      quantity: qty, price, regular, on_sale: on_sale || price < regular, purchase_price: money(src.purchase_price),
      subtotal: money(price * qty), category_ids: (p.category_ids || []).map(Number),
      manage_stock: src.manage_stock, stock_quantity: src.stock_quantity, stock_status: src.stock_status, backorders: src.backorders,
      line_discount: money(it.discount) || 0,
    });
  }
  return lines;
}

/**
 * Creates an order (online, POS or manual) inside a transaction.
 * input: { items, customer_id, billing, shipping, coupon_code, discount:{type,amount}, shipping_total, shipping_method,
 *          fee_total, payment_method, payment_title, cash_tendered, status, customer_note, cash_session_id, meta }
 */
export async function createOrder(t, input, { channel, staff = null, allowOverride = false, enforceStock = false }) {
  if (!Array.isArray(input.items) || !input.items.length) fail(400, 'The order has no items');
  const lines = await priceLines(t, input.items, { allowOverride });

  if (enforceStock) {
    for (const l of lines) {
      if (l.manage_stock && l.backorders === 'no' && Number(l.stock_quantity) < l.quantity) fail(400, `Only ${Math.max(0, l.stock_quantity)} left in stock for "${l.name}"`);
      if (!l.manage_stock && l.stock_status === 'outofstock') fail(400, `"${l.name}" is out of stock`);
    }
  }

  const subtotal = money(lines.reduce((s, l) => s + l.subtotal, 0));
  let discount = money(lines.reduce((s, l) => s + l.line_discount, 0));
  const couponCodes = [];
  let freeShipping = false;
  if (input.coupon_code) {
    const r = await applyCoupon(t, input.coupon_code, lines, input.billing?.email);
    discount += r.discount;
    freeShipping = r.free_shipping;
    couponCodes.push(r.coupon.code);
    await t.query('update coupons set usage_count = usage_count + 1 where id = $1', [r.coupon.id]);
  }
  if (input.discount && allowOverride) {
    const d = input.discount.type === 'percent' ? ((subtotal - discount) * Number(input.discount.amount)) / 100 : Number(input.discount.amount);
    discount += money(Math.max(0, d));
  }
  discount = Math.min(discount, subtotal);
  const shippingTotal = freeShipping ? 0 : money(input.shipping_total) || 0;
  const feeTotal = money(input.fee_total) || 0;
  const total = money(subtotal - discount + shippingTotal + feeTotal);

  // spread the order-level discount over the lines so per-product reports stay correct
  const lineDiscountBase = subtotal || 1;
  const status = input.status || (channel === 'pos' ? 'completed' : 'processing');
  const now = new Date().toISOString();

  let customerId = input.customer_id || null;
  if (!customerId && (input.billing?.email || input.billing?.phone)) {
    const [existing] = await t.query(
      `select id from customers where ($1::text is not null and lower(email) = lower($1)) or ($2::text is not null and phone = $2) limit 1`,
      [input.billing.email || null, input.billing.phone || null]);
    customerId = existing?.id || (await insertRow(t, 'customers', {
      first_name: input.billing.first_name || '', last_name: input.billing.last_name || '', email: input.billing.email || null,
      phone: input.billing.phone || null, billing: JSON.stringify(input.billing || {}), shipping: JSON.stringify(input.shipping || input.billing || {}),
    })).id;
  }

  const order = await insertRow(t, 'orders', {
    status, channel, customer_id: customerId,
    billing: JSON.stringify(input.billing || {}), shipping: JSON.stringify(input.shipping || input.billing || {}),
    subtotal, discount_total: discount, shipping_total: shippingTotal, fee_total: feeTotal, tax_total: 0, total,
    payment_method: input.payment_method || (channel === 'pos' ? 'cash' : 'cod'), payment_title: input.payment_title || null,
    shipping_method: input.shipping_method || null, coupon_codes: couponCodes,
    cash_tendered: money(input.cash_tendered), cash_change: input.cash_tendered != null ? money(Number(input.cash_tendered) - total) : null,
    staff_id: staff?.id || null, cash_session_id: input.cash_session_id || null, customer_note: input.customer_note || '',
    meta: JSON.stringify({ ...(input.meta || {}), stock_reduced: REDUCES_STOCK.has(status) }),
    paid_at: status === 'completed' || channel === 'pos' ? now : null, completed_at: status === 'completed' ? now : null,
  });
  await t.query('update orders set number = $2 where id = $1', [order.id, String(order.id)]);
  order.number = String(order.id);

  for (const l of lines) {
    const share = l.subtotal - l.line_discount - ((discount - lines.reduce((s, x) => s + x.line_discount, 0)) * l.subtotal) / lineDiscountBase;
    await insertRow(t, 'order_items', {
      order_id: order.id, product_id: l.product_id, variation_id: l.variation_id, name: l.name, sku: l.sku,
      quantity: l.quantity, unit_price: l.price, purchase_price: l.purchase_price, subtotal: l.subtotal, total: money(share),
      meta: JSON.stringify(l.regular > l.price ? { regular_price: l.regular } : {}),
    });
    if (REDUCES_STOCK.has(status) && l.product_id) {
      await moveStock(t, { product_id: l.product_id, variation_id: l.variation_id, change: -l.quantity, reason: 'sale', ref_type: 'order', ref_id: order.id, staff_id: staff?.id });
    }
    if (l.product_id) await t.query('update products set total_sales = total_sales + $2 where id = $1', [l.product_id, l.quantity]);
  }
  if (input.note) await insertRow(t, 'order_notes', { order_id: order.id, note: input.note, author: staff?.name || 'System' });
  return { ...order, total, lines };
}

/** Moves an order to a new status, restocking or reducing stock when needed. */
export async function changeStatus(t, orderId, status, staff = null) {
  const [order] = await t.query('select * from orders where id = $1 for update', [orderId]);
  if (!order) fail(404, 'Order not found');
  const meta = typeof order.meta === 'string' ? JSON.parse(order.meta) : order.meta || {};
  const items = await t.query('select * from order_items where order_id = $1', [orderId]);
  const wantsStock = REDUCES_STOCK.has(status);
  if (wantsStock && !meta.stock_reduced) {
    for (const i of items) await moveStock(t, { product_id: i.product_id, variation_id: i.variation_id, change: -(i.quantity - i.refunded_qty), reason: 'sale', ref_type: 'order', ref_id: orderId, staff_id: staff?.id });
    meta.stock_reduced = true;
  } else if (!wantsStock && meta.stock_reduced && ['cancelled', 'refunded', 'failed', 'pending'].includes(status)) {
    for (const i of items) await moveStock(t, { product_id: i.product_id, variation_id: i.variation_id, change: i.quantity - i.refunded_qty, reason: 'cancel', ref_type: 'order', ref_id: orderId, staff_id: staff?.id });
    meta.stock_reduced = false;
  }
  const [updated] = await t.query(
    `update orders set status = $2, meta = $3, updated_at = now(),
       completed_at = case when $2 = 'completed' then coalesce(completed_at, now()) else completed_at end,
       paid_at = case when $2 in ('completed','processing') and payment_method <> 'cod' then coalesce(paid_at, now()) when $2 = 'completed' then coalesce(paid_at, now()) else paid_at end
     where id = $1 returning *`, [orderId, status, JSON.stringify(meta)]);
  await insertRow(t, 'order_notes', { order_id: orderId, note: `Status changed from ${order.status} to ${status}.`, author: staff?.name || 'System' });
  return updated;
}

/** Refunds some or all items of an order. items: [{order_item_id, quantity}] or amount only. */
export async function refundOrder(t, orderId, { items = [], amount = null, reason = '', restock = true }, staff = null) {
  const [order] = await t.query('select * from orders where id = $1 for update', [orderId]);
  if (!order) fail(404, 'Order not found');
  let computed = 0;
  const done = [];
  for (const r of items) {
    const qty = Math.floor(Number(r.quantity) || 0);
    if (qty <= 0) continue;
    const [it] = await t.query('select * from order_items where id = $1 and order_id = $2', [r.order_item_id, orderId]);
    if (!it) fail(400, 'Item not in this order');
    if (qty > it.quantity - it.refunded_qty) fail(400, `Cannot refund more than ${it.quantity - it.refunded_qty} × ${it.name}`);
    const unit = Number(it.total) / it.quantity;
    computed += unit * qty;
    await t.query('update order_items set refunded_qty = refunded_qty + $2 where id = $1', [it.id, qty]);
    if (restock) await moveStock(t, { product_id: it.product_id, variation_id: it.variation_id, change: qty, reason: 'refund', ref_type: 'order', ref_id: orderId, staff_id: staff?.id });
    done.push({ order_item_id: it.id, name: it.name, quantity: qty, amount: money(unit * qty) });
  }
  const refundAmount = money(amount ?? computed);
  if (!refundAmount || refundAmount <= 0) fail(400, 'Nothing to refund');
  if (refundAmount > Number(order.total) - Number(order.refunded_total) + 0.001) fail(400, 'Refund is larger than the amount left on the order');
  const refund = await insertRow(t, 'refunds', { order_id: orderId, amount: refundAmount, reason, items: JSON.stringify(done), restock, staff_id: staff?.id || null });
  const refundedTotal = money(Number(order.refunded_total) + refundAmount);
  const fully = refundedTotal >= Number(order.total) - 0.001;
  await t.query(`update orders set refunded_total = $2, status = case when $3 then 'refunded' else status end, updated_at = now() where id = $1`, [orderId, refundedTotal, fully]);
  await insertRow(t, 'order_notes', { order_id: orderId, note: `Refunded ${refundAmount}${reason ? ` — ${reason}` : ''}.`, author: staff?.name || 'System' });
  return refund;
}
