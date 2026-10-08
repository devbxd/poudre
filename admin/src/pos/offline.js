// POS reliability: a sale is never lost and never counted twice.
// - every sale carries a unique client_ref; the server ignores a sale it already has (safe retries)
// - network trouble: automatic retries, then the sale is kept on this device and sent when the connection is back
// - the sale in progress and the catalogue are kept on the device (reload / restart / offline start)
const QUEUE_KEY = 'poudre_pos_queue';
const CART_KEY = 'poudre_pos_cart';
const CATALOG_KEY = 'poudre_pos_catalog';

const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const TILL = (() => { try { return new URLSearchParams(location.search).get('till') || 'main'; } catch { return 'main'; } })();
const cartKey = TILL === 'main' ? CART_KEY : `${CART_KEY}_${TILL}`;
export const readCart = () => read(cartKey, null);
export const saveCart = (state) => write(cartKey, state);
export const newTillUrl = () => `${location.origin}/dashboard/pos?till=${Math.random().toString(36).slice(2, 8)}`;
// the catalogue (~2 MB and growing) goes to IndexedDB: localStorage is limited to about 5 MB
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('poudre-pos', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function readCachedCatalog() {
  try {
    const db = await idb();
    return await new Promise((resolve) => { const r = db.transaction('kv').objectStore('kv').get(CATALOG_KEY); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });
  } catch { return null; }
}
export async function cacheCatalog(catalog) {
  try { const db = await idb(); db.transaction('kv', 'readwrite').objectStore('kv').put(catalog, CATALOG_KEY); } catch { /* private mode: no offline copy */ }
}

export const readQueue = () => read(QUEUE_KEY, []);
const saveQueue = (q) => write(QUEUE_KEY, q);
export function queueSale(entry) { const q = readQueue().filter((x) => x.payload.client_ref !== entry.payload.client_ref); q.push(entry); saveQueue(q); return q.length; }

/**
 * Sends a sale. Returns { ok, order } — or { ok: false, network: true } when the server could not be reached
 * (safe to retry or queue), or { ok: false, error, status } when the server refused it (fix and try again).
 */
export async function postSale(payload, { attempts = 3, timeout = 15000 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((r) => setTimeout(r, i === 1 ? 1000 : 3000));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch('/api/pos/orders', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal,
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.id) return { ok: true, order: data };
      if (res.status >= 400 && res.status < 500) return { ok: false, status: res.status, error: data?.error || `The sale was refused (${res.status})` };
      last = { ok: false, network: true, error: data?.error || `Server error (${res.status})` };
    } catch (e) {
      last = { ok: false, network: true, error: e.name === 'AbortError' ? 'The server did not answer in time' : 'No connection' };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

let syncing = null;
/** Sends the sales kept on this device. Returns { sent, left, failed: [{ref, error}] } */
export function syncQueue() {
  syncing ??= (async () => {
    let sent = 0;
    const failed = [];
    for (const entry of readQueue()) {
      const r = await postSale(entry.payload, { attempts: 1, timeout: 20000 });
      if (r.ok) { saveQueue(readQueue().filter((x) => x.payload.client_ref !== entry.payload.client_ref)); sent++; continue; }
      if (r.network) break; // still offline: try again later, in order
      // refused by the server (should not happen): keep it, flagged, so the shop can see it
      saveQueue(readQueue().map((x) => (x.payload.client_ref === entry.payload.client_ref ? { ...x, error: r.error } : x)));
      failed.push({ ref: entry.payload.client_ref, error: r.error });
    }
    return { sent, left: readQueue().length, failed };
  })().finally(() => { syncing = null; });
  return syncing;
}

/** Receipt for a sale saved on the device (same shape as a server order, so it prints the same way) */
export function offlineReceipt(payload, lines, totals, staffName) {
  return {
    id: null, number: `OFF-${payload.client_ref.slice(0, 6).toUpperCase()}`, offline: true, created_at: payload.offline_at,
    items: lines.map((l) => ({ name: l.name, sku: l.sku || null, quantity: l.quantity, unit_price: l.price, subtotal: Math.round(l.price * l.quantity * 100) / 100 })),
    subtotal: totals.subtotal, discount_total: totals.discount, shipping_total: 0, fee_total: 0, refunded_total: 0, total: totals.total,
    payment_method: payload.payment_method, payment_title: payload.payment_title, cash_tendered: payload.cash_tendered,
    cash_change: payload.cash_tendered != null ? Math.round((payload.cash_tendered - totals.total) * 100) / 100 : null,
    staff_name: staffName, billing: payload.billing || {}, shipping: {},
  };
}
