// iCARRY delivery (Lebanon): website orders are created in the shop's iCARRY account, like the WordPress plugin did.
// API: https://lb.icarry.com/api-frontend (Swagger: /api-frontend/index.html). Settings: Dashboard → Settings → Delivery.
// Sending never blocks or breaks an order: the result is written on the order (notes + meta.icarry).
import { query, one } from './db.js';
import { getSetting, audit } from './lib.js';

const API = process.env.ICARRY_API || 'https://lb.icarry.com/api-frontend';
const json = (v) => (typeof v === 'string' ? JSON.parse(v || '{}') : v || {});

export async function icarrySettings() {
  const s = await getSetting('icarry', {});
  return { enabled: false, auto_send: true, email: '', password: '', pickup_location: '', default_weight: 1, ...s };
}

let cached = null; // { key, token, at }
async function token(cfg) {
  const key = `${cfg.email}:${cfg.password}`;
  if (cached?.key === key && Date.now() - cached.at < 30 * 60 * 1000) return cached.token;
  const res = await fetch(`${API}/Authenticate/GetTokenForCustomerApi`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ Email: cfg.email, Password: cfg.password }), signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok || !body?.token) throw new Error(`iCARRY login failed: ${typeof body === 'string' ? body.slice(0, 200) : body?.title || body?.message || res.status}`);
  cached = { key, token: body.token, at: Date.now() };
  return body.token;
}

/** Checks the account; returns what iCARRY knows about it */
export async function testIcarry(cfg) {
  cached = null;
  await token(cfg);
  return { ok: true };
}

async function api(cfg, path, payload) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${await token(cfg)}` },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`iCARRY ${res.status}: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/** The shipment iCARRY receives for an order (cash on delivery = what is left to pay) */
export function shipmentFor(order, items, cfg) {
  const b = json(order.billing);
  const s = { ...b, ...Object.fromEntries(Object.entries(json(order.shipping)).filter(([, v]) => v)) };
  const total = Number(order.total) - Number(order.refunded_total || 0);
  const cod = order.paid_at && order.payment_method !== 'cod' ? 0 : total;
  const lines = items.map((i) => `${i.quantity} × ${i.name}${i.sku ? ` (${i.sku})` : ''}`).join('\n');
  return {
    ExternalId: String(order.number || order.id),
    ProcessOrder: true,
    pickupLocation: cfg.pickup_location || '',
    dropOffAddress: {
      FirstName: s.first_name || '', LastName: s.last_name || '', Email: b.email || '', PhoneNumber: s.phone || b.phone || '',
      Country: s.country || 'LB', City: s.city || '', Address1: s.address_1 || '', Address2: s.address_2 || '', ZipPostalCode: s.postcode || '',
    },
    CODAmount: Math.round(cod * 100) / 100, COdCurrency: 'USD',
    ActualWeight: Number(cfg.default_weight) || 1, PackageType: 'Parcel', Length: 0, Width: 0, Height: 0,
    ParcelQuantity: 1, ParcelPackageValue: Math.round(total * 100) / 100, ParcelPackageCurrency: 'USD',
    ParcelDescription: lines.slice(0, 500),
    Notes: [order.customer_note, `Order #${order.number || order.id}`, lines].filter(Boolean).join('\n').slice(0, 1000),
    MethodName: order.shipping_method || 'Delivery', MethodDescription: order.shipping_method || '', Price: Number(order.shipping_total) || 0,
    ParcelDimensionsList: [], productDtos: [],
  };
}

async function note(orderId, text) {
  await query('insert into order_notes (order_id, note, author) values ($1, $2, $3)', [orderId, text, 'iCARRY']);
}

/** Creates the delivery in iCARRY. Returns { ok, error }. Never throws. */
export async function sendToIcarry(orderId, { force = false } = {}) {
  try {
    const cfg = await icarrySettings();
    if (!cfg.email || !cfg.password) throw new Error('iCARRY is not set up yet (Settings → Delivery)');
    const order = await one('select * from orders where id = $1', [orderId]);
    if (!order) throw new Error('Order not found');
    const meta = json(order.meta);
    if (meta.icarry?.sent_at && !force) return { ok: true, already: true };
    const items = await query('select * from order_items where order_id = $1 order by id', [orderId]);
    const res = await api(cfg, '/SmartwareShipment/CreateOrder', shipmentFor(order, items, cfg));
    const info = { sent_at: new Date().toISOString(), id: res?.ShipmentId ?? res?.shipmentId ?? res?.Id ?? res?.id ?? null, tracking: res?.TrackingNumber ?? res?.trackingNumber ?? null };
    await query(`update orders set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('icarry', $2::jsonb) where id = $1`, [orderId, JSON.stringify(info)]);
    await note(orderId, `Sent to iCARRY for delivery${info.id ? ` (shipment ${info.id})` : ''}.`);
    return { ok: true, ...info };
  } catch (e) {
    console.error('icarry', orderId, e.message);
    await note(orderId, `iCARRY: not sent — ${e.message}`).catch(() => {});
    await audit(null, 'icarry_failed', 'order', orderId, { error: e.message });
    return { ok: false, error: e.message };
  }
}

/** New website order: sent automatically when enabled (delivery orders only, not store pickup) */
export async function autoSendToIcarry(orderId) {
  const cfg = await icarrySettings();
  if (!cfg.enabled || !cfg.auto_send) return;
  const order = await one('select shipping_method from orders where id = $1', [orderId]);
  if (/pickup/i.test(order?.shipping_method || '')) return;
  await sendToIcarry(orderId);
}
