import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Banknote, Clock, Lock, Minus, PauseCircle, Plus, Printer, ReceiptText, RotateCcw, Search, Trash2, User, UserPlus, X, Percent, PackagePlus, Wallet, LayoutGrid, List, AppWindow,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { money, dateTime, time, fullName } from '../lib/format.js';
import { useAuth } from '../lib/auth.jsx';
import { Button, Field, Input, Modal, Spinner, Thumb, cx, sized, useAction, useToast } from '../components/ui.jsx';
import { CustomerSearch } from '../components/pickers.jsx';
import { printOrder } from '../components/Receipt.jsx';

const priceOf = (x) => {
  const now = Date.now();
  const sale = x.sale_price != null && x.sale_price < x.regular_price
    && (!x.sale_from || new Date(x.sale_from).getTime() <= now) && (!x.sale_to || new Date(x.sale_to).getTime() >= now);
  return { price: sale ? x.sale_price : x.regular_price ?? 0, regular: x.regular_price ?? 0, on_sale: sale };
};
const initials = (name) => (name || '').split(/\s+/).filter((w) => /^[a-z0-9]/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
// code shown on a product: its own SKU / barcode, or the one shared by its options
const code = (p) => p.barcode || p.sku || (p.variations?.length && p.variations.every((v) => (v.barcode || v.sku) && (v.barcode || v.sku) === (p.variations[0].barcode || p.variations[0].sku)) ? p.variations[0].barcode || p.variations[0].sku : '');
const optionLabel = (v) => (typeof v.attributes === 'string' ? JSON.parse(v.attributes) : v.attributes).map((a) => a.option).filter(Boolean).join(' / ');
const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

import { newTillUrl, newRef, readCart, saveCart, readCachedCatalog, cacheCatalog, readQueue, queueSale, postSale, syncQueue, offlineReceipt } from './offline.js';

const HELD_KEY = 'poudre_pos_held';
const readHeld = () => { try { return JSON.parse(localStorage.getItem(HELD_KEY)) || []; } catch { return []; } };
const writeHeld = (v) => { try { localStorage.setItem(HELD_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } };

// ---------------------------------------------------------------- Variation picker
function VariationPicker({ product, highlight, onPick, onClose }) {
  useEffect(() => {
    if (!highlight) return undefined;
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); onPick(highlight); } };
    // listen only after the scanner's own "Enter" (the one that opened this window) has finished
    const t = setTimeout(() => window.addEventListener('keydown', onKey), 0);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [highlight, onPick]);
  return (
    <Modal open onClose={onClose} title={product.name} width={640}>
      {highlight && <p className="mb-3 text-[13px] text-zinc-500">Scanned option highlighted — press Enter or tap it to add, or choose another one.</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {product.variations.map((v) => {
          const { price } = priceOf(v);
          const out = v.manage_stock ? v.stock_quantity <= 0 : v.stock_status === 'outofstock';
          return (
            <button key={v.id} onClick={() => onPick(v)}
              className={cx('flex items-center gap-2 rounded-md border p-2 text-left hover:border-zinc-900', highlight?.id === v.id ? 'border-2 border-zinc-900 bg-zinc-50' : out ? 'border-zinc-200 opacity-60' : 'border-zinc-300')}>
              <Thumb src={v.image || product.image} size={40} />
              <div className="min-w-0">
                <div className="truncate font-medium">{optionLabel(v) || "Option"}</div>
                {(v.barcode || v.sku) && <div className="num truncate text-[11px] text-zinc-400">{v.barcode || v.sku}</div>}
                <div className="num text-[13px]">{money(price)} · <span className={out ? 'text-red-600' : 'text-zinc-500'}>{v.manage_stock ? `${v.stock_quantity} left` : out ? 'Out' : 'In stock'}</span></div>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Payment
function PaymentModal({ total, payments, lbpRate, onClose, onPay, busy }) {
  const [method, setMethod] = useState(payments[0]?.id || 'cash');
  const [given, setGiven] = useState('');
  const isCash = /cash/i.test(method);
  const change = Number(given) - total;
  const quick = [...new Set([Math.ceil(total), Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 20) * 20, 50, 100].filter((v) => v >= total))].slice(0, 5);
  const submit = () => {
    if (busy) return; // one sale at a time (Enter key + button)
    if (isCash && given !== '' && Number(given) < total - 0.001) return;
    const p = payments.find((x) => x.id === method);
    onPay({ payment_method: method, payment_title: p?.title || method, cash_tendered: isCash ? (given === '' ? total : Number(given)) : null });
  };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Modal open onClose={onClose} title="Payment" width={520}
      footer={<Button variant="primary" size="lg" className="w-full" loading={busy} disabled={isCash && given !== '' && Number(given) < total - 0.001} onClick={submit}>Complete sale · {money(total)}</Button>}>
      <div className="text-center">
        <div className="text-[13px] text-zinc-500">Amount due</div>
        <div className="num text-4xl font-semibold tracking-tight">{money(total)}</div>
        {lbpRate > 0 && <div className="num text-zinc-500">{Math.round(total * lbpRate).toLocaleString('en-US')} LBP</div>}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {payments.map((p) => (
          <button key={p.id} onClick={() => setMethod(p.id)}
            className={cx('rounded-md border px-3 py-3 font-medium', method === p.id ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 hover:border-zinc-400')}>{p.title}</button>
        ))}
      </div>
      {isCash && (
        <div className="mt-5">
          <Field label="Cash received"><Input autoFocus prefix="$" type="number" step="0.01" value={given} onChange={(e) => setGiven(e.target.value)} placeholder={total.toFixed(2)} className="h-12 text-lg" /></Field>
          <div className="mt-2 flex flex-wrap gap-2">
            {quick.map((v) => <Button key={v} onClick={() => setGiven(String(v))}>{money(v)}</Button>)}
          </div>
          {given !== '' && (
            <div className={cx('mt-4 rounded-md p-3 text-center', change >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>
              {change >= 0 ? <>Change to give: <b className="num text-xl">{money(change)}</b>{lbpRate > 0 && <span className="num"> · {Math.round(change * lbpRate).toLocaleString('en-US')} LBP</span>}</> : <>Missing {money(-change)}</>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- Orders drawer (reprint / refund)
function OrdersDrawer({ onClose, settings }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [order, setOrder] = useState(null);
  const [refund, setRefund] = useState({});
  const [run, busy] = useAction();
  useEffect(() => {
    const t = setTimeout(() => api.get(`/pos/orders?q=${encodeURIComponent(q)}`).then(setList), 200);
    return () => clearTimeout(t);
  }, [q]);
  const open = async (id) => { setOrder(await api.get(`/pos/orders/${id}`)); setRefund({}); };
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const doRefund = async () => {
    const items = Object.entries(refund).filter(([, n]) => n > 0).map(([order_item_id, quantity]) => ({ order_item_id: Number(order_item_id), quantity }));
    if (!items.length) return;
    setOrder(await run(() => api.post(`/pos/orders/${order.id}/refund`, { items, restock: true, reason: 'Returned in store' }), 'Refund done — give the money back to the customer'));
    setRefund({});
  };
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Sales" className="flex h-full w-full max-w-3xl bg-white shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex w-72 shrink-0 flex-col border-r border-zinc-200">
          <div className="border-b border-zinc-200 p-3"><Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order #, phone, name…" /></div>
          <div className="flex-1 overflow-y-auto">
            {!list ? <Spinner /> : list.map((o) => (
              <button key={o.id} onClick={() => open(o.id)} className={cx('block w-full border-b border-zinc-100 px-3 py-2 text-left hover:bg-zinc-50', order?.id === o.id && 'bg-zinc-100')}>
                <div className="flex justify-between"><span className="font-medium">#{o.number}</span><span className="num">{money(o.total)}</span></div>
                <div className="flex justify-between text-xs text-zinc-500"><span>{dateTime(o.created_at)}</span><span>{o.item_count} items</span></div>
                {o.refunded_total > 0 && <div className="text-xs text-red-600">Refunded {money(o.refunded_total)}</div>}
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <h3 className="font-semibold">{order ? `Order #${order.number}` : 'Recent sales'}</h3>
            <button onClick={onClose} className="rounded p-1 hover:bg-zinc-100"><X size={18} /></button>
          </div>
          {!order ? <p className="p-6 text-zinc-400">Select a sale to reprint the receipt or refund items.</p> : (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-3 text-[13px] text-zinc-500">{dateTime(order.created_at)} · {order.staff_name} · {order.payment_title}</div>
              <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
                {order.items.map((i) => {
                  const left = i.quantity - i.refunded_qty;
                  return (
                    <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1"><div className="truncate">{i.name}</div><div className="num text-xs text-zinc-500">{i.quantity} × {money(i.unit_price)}{i.refunded_qty > 0 && <span className="text-red-600"> · {i.refunded_qty} returned</span>}</div></div>
                      {left > 0 && (
                        <div className="flex items-center gap-1">
                          <button className="rounded border border-zinc-300 p-1" onClick={() => setRefund({ ...refund, [i.id]: Math.max(0, (refund[i.id] || 0) - 1) })}><Minus size={12} /></button>
                          <span className="num w-6 text-center">{refund[i.id] || 0}</span>
                          <button className="rounded border border-zinc-300 p-1" onClick={() => setRefund({ ...refund, [i.id]: Math.min(left, (refund[i.id] || 0) + 1) })}><Plus size={12} /></button>
                        </div>
                      )}
                      <span className="num w-20 text-right">{money(i.total)}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex justify-between text-base font-semibold"><span>Total</span><span className="num">{money(order.total)}</span></div>
              {order.refunded_total > 0 && <div className="flex justify-between text-red-600"><span>Refunded</span><span className="num">-{money(order.refunded_total)}</span></div>}
              <div className="mt-4 flex gap-2">
                <Button icon={Printer} onClick={() => printOrder(order, { store: settings.store, pos: settings.settings })}>Reprint receipt</Button>
                <Button icon={RotateCcw} loading={busy} disabled={!Object.values(refund).some((n) => n > 0)} onClick={doRefund}>Refund selected items</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Register (open/close)
function RegisterModal({ session, onClose, onChange }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  if (result) {
    const diff = Number(result.closing_cash) - Number(result.expected_cash);
    return (
      <Modal open onClose={() => { onClose(); onChange(); }} title="Register closed" width={440}>
        <dl className="space-y-1.5">
          <div className="flex justify-between"><dt>Cash sales</dt><dd className="num">{money(result.cash_sales)}</dd></div>
          {result.by_method.map((m) => <div key={m.method} className="flex justify-between text-zinc-500"><dt>{m.method} ({m.orders})</dt><dd className="num">{money(m.total)}</dd></div>)}
          <div className="flex justify-between border-t border-zinc-200 pt-2"><dt>Expected in drawer</dt><dd className="num">{money(result.expected_cash)}</dd></div>
          <div className="flex justify-between"><dt>Counted</dt><dd className="num">{money(result.closing_cash)}</dd></div>
          <div className={cx('flex justify-between font-semibold', Math.abs(diff) > 0.5 ? 'text-red-600' : 'text-emerald-700')}><dt>Difference</dt><dd className="num">{money(diff)}</dd></div>
        </dl>
      </Modal>
    );
  }
  if (!session) {
    return (
      <Modal open onClose={onClose} title="Open the register" width={400}
        footer={<Button variant="primary" loading={busy} onClick={async () => { await run(() => api.post('/pos/session/open', { opening_cash: Number(amount) || 0 }), 'Register opened'); onClose(); onChange(); }}>Open register</Button>}>
        <Field label="Cash in the drawer now"><Input autoFocus prefix="$" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title="Cash register" width={460}>
      <dl className="mb-4 space-y-1.5 text-[13px]">
        <div className="flex justify-between"><dt className="text-zinc-500">Opened</dt><dd>{dateTime(session.opened_at)} by {session.staff_name}</dd></div>
        <div className="flex justify-between"><dt className="text-zinc-500">Opening cash</dt><dd className="num">{money(session.opening_cash)}</dd></div>
        <div className="flex justify-between"><dt className="text-zinc-500">Cash sales</dt><dd className="num">{money(session.cash_sales)}</dd></div>
        <div className="flex justify-between"><dt className="text-zinc-500">Cash in / out</dt><dd className="num">{money(session.cash_moves)}</dd></div>
        <div className="flex justify-between font-medium"><dt>Expected in drawer</dt><dd className="num">{money(session.expected_cash)}</dd></div>
      </dl>
      <div className="space-y-2 rounded-md border border-zinc-200 p-3">
        <div className="text-[13px] font-medium">Cash in / out (e.g. paid a delivery, took money out)</div>
        <div className="flex gap-2">
          <Input prefix="$" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="-20 or 50" className="w-32" />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
          <Button loading={busy} onClick={async () => { await run(() => api.post('/pos/session/cash', { amount: Number(amount), reason }), 'Saved'); setAmount(''); setReason(''); onChange(); }}>Add</Button>
        </div>
      </div>
      <div className="mt-4 space-y-2 rounded-md border border-zinc-200 p-3">
        <div className="text-[13px] font-medium">Close the register</div>
        <div className="flex gap-2">
          <Input id="count" prefix="$" type="number" placeholder="Cash counted" className="flex-1" />
          <Button variant="primary" loading={busy} onClick={async () => setResult(await run(() => api.post('/pos/session/close', { closing_cash: Number(document.getElementById('count').value) || 0 })))}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Main POS
export default function Pos() {
  const { staff, can, login, logout } = useAuth();
  const { toast } = useToast();
  const [catalog, setCatalog] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(null);
  // phones: one panel at a time (products or cart)
  const [mobileView, setMobileView] = useState('products');
  // the sale in progress survives a reload or a restart of the device
  const saved = useMemo(readCart, []);
  const [cart, setCart] = useState(saved?.cart || []);
  const [customer, setCustomer] = useState(saved?.customer || null);
  const [discount, setDiscount] = useState(saved?.discount || null); // {type, amount}
  const [note, setNote] = useState(saved?.note || '');
  const [sending, setSending] = useState(false);
  const [view, setViewState] = useState(() => { try { return localStorage.getItem('poudre_pos_view') || 'grid'; } catch { return 'grid'; } });
  const setView = (v) => { setViewState(v); try { localStorage.setItem('poudre_pos_view', v); } catch { /* storage unavailable */ } };
  const [queued, setQueued] = useState(() => readQueue().length);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const saleRef = useRef(null);
  const sendingRef = useRef(false);
  const [picker, setPicker] = useState(null);
  const [pickerHighlight, setPickerHighlight] = useState(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [held, setHeld] = useState(readHeld);
  const [heldOpen, setHeldOpen] = useState(false);
  const [session, setSession] = useState(undefined);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState(null);
  const [locked, setLocked] = useState(false);
  const [limit, setLimit] = useState(60);
  const search = useRef();
  const [run, busy] = useAction();

  const loadCatalog = useCallback(() => api.get('/pos/catalog').then((c) => { setCatalog(c); cacheCatalog(c); }).catch(async (e) => {
    const cached = await readCachedCatalog();
    if (cached) { setCatalog((cur) => cur || cached); if (!navigator.onLine || !(e.status >= 400 && e.status < 500)) toast('No connection — using the products saved on this device', 'error'); }
    else toast(e.message, 'error');
  }), [toast]);
  useEffect(() => { saveCart({ cart, customer, discount, note }); }, [cart, customer, discount, note]);
  // sales kept on the device are sent as soon as the connection is back
  const sync = useCallback(async () => {
    if (!readQueue().length) { setQueued(0); return; }
    const r = await syncQueue();
    setQueued(r.left);
    if (r.sent) { toast(`${r.sent} offline sale${r.sent > 1 ? 's' : ''} sent to the server`); loadCatalog(); }
    if (r.failed.length) toast(`A saved sale was refused: ${r.failed[0].error}`, 'error');
  }, [toast, loadCatalog]);
  useEffect(() => {
    const up = () => { setOnline(true); sync(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    sync();
    const t = setInterval(sync, 20000);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); clearInterval(t); };
  }, [sync]);
  const loadSession = useCallback(() => api.get('/pos/session').then(setSession).catch(() => setSession(null)), []);
  useEffect(() => { loadCatalog(); loadSession(); }, [loadCatalog, loadSession]);
  useEffect(() => { setLimit(60); }, [q, cat]);

  // Barcode index: SKU / barcode -> every product / option carrying it
  const index = useMemo(() => {
    const m = new Map();
    const add = (code, hit) => {
      if (!code) return;
      const k = String(code).trim().toLowerCase();
      const list = m.get(k) || [];
      if (!list.some((x) => x.product.id === hit.product.id && x.variation?.id === hit.variation?.id)) list.push(hit);
      m.set(k, list);
    };
    for (const p of catalog?.products || []) {
      for (const code of [p.sku, p.barcode]) add(code, { product: p });
      for (const v of p.variations || []) for (const code of [v.sku, v.barcode]) add(code, { product: p, variation: v });
    }
    return m;
  }, [catalog]);

  const results = useMemo(() => {
    if (!catalog) return [];
    let list = catalog.products;
    if (cat) {
      const ids = new Set([cat, ...catalog.categories.filter((c) => c.parent_id === cat).map((c) => c.id)]);
      list = list.filter((p) => p.category_ids.some((id) => ids.has(id)));
    }
    if (q.trim()) {
      const words = norm(q).split(/\s+/).filter(Boolean);
      list = list.filter((p) => {
        const hay = norm(`${p.name} ${p.sku || ''} ${p.brand || ''}`);
        return words.every((w) => hay.includes(w));
      });
    }
    return list;
  }, [catalog, q, cat]);

  const addLine = useCallback((product, variation = null, qty = 1) => {
    if (product.type === 'variable' && !variation) { setPicker(product); return; }
    const src = variation || product;
    const { price, regular } = priceOf(src);
    const key = `${product.id}-${variation?.id || 0}`;
    setCart((c) => {
      const found = c.find((l) => l.key === key);
      if (found) return c.map((l) => (l.key === key ? { ...l, quantity: l.quantity + qty } : l));
      return [...c, {
        key, product_id: product.id, variation_id: variation?.id || null, name: variation ? `${product.name} – ${optionLabel(variation)}` : product.name,
        image: variation?.image || product.image, price, regular, quantity: qty,
        stock: src.manage_stock ? src.stock_quantity : null,
      }];
    });
    setDone(null);
  }, []);

  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    const code = q.trim().toLowerCase();
    const hits = index.get(code);
    if (hits?.length) {
      // the product's own barcode, or one barcode shared by several options → choose the option in the small window
      const first = hits[0];
      if (first.product.type !== 'variable') addLine(first.product);
      else { setPicker(first.product); setPickerHighlight(hits.length === 1 ? first.variation || null : null); }
      setQ('');
      return;
    }
    if (results.length === 1) { addLine(results[0]); setQ(''); return; }
    if (code && !results.length) toast(`No product with code "${q}"`, 'error');
  };

  // Global keyboard: scanners type fast then Enter; keep focus in the search box
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F2') { e.preventDefault(); search.current?.focus(); }
      if (e.key === 'F9' && cart.length) { e.preventDefault(); setPaying(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart.length]);

  const subtotal = cart.reduce((s, l) => s + l.price * l.quantity, 0);
  const discountValue = discount ? Math.min(subtotal, discount.type === 'percent' ? (subtotal * discount.amount) / 100 : discount.amount) : 0;
  const total = Math.max(0, Math.round((subtotal - discountValue) * 100) / 100);
  const lbpRate = catalog?.store?.secondary_currency?.rate || 0;
  const payments = (catalog?.payments || []).filter((p) => p.enabled !== false && p.pos !== false && p.id !== 'cod');
  const posPayments = payments.length ? payments : [{ id: 'cash', title: 'Cash' }, { id: 'card', title: 'Card' }];
  const settings = catalog?.settings || {};

  const reset = () => { setCart([]); setCustomer(null); setDiscount(null); setNote(''); };

  const finishSale = (order, offline) => {
    saleRef.current = null;
    setPaying(false);
    setDone(order);
    setMobileView('products');
    reset();
    if (settings.auto_print !== false) printOrder(order, { store: catalog.store, pos: settings });
    if (!offline) { loadCatalog(); loadSession(); }
    search.current?.focus();
  };

  const pay = async (payment) => {
    if (sendingRef.current) return; // never two submissions of the same sale
    sendingRef.current = true;
    setSending(true);
    saleRef.current ??= newRef();
    const payload = {
      client_ref: saleRef.current,
      items: cart.map((l) => ({ product_id: l.product_id, variation_id: l.variation_id, quantity: l.quantity, price: l.price, custom: l.custom, name: l.name })),
      customer_id: customer?.id || null,
      billing: customer ? { first_name: customer.first_name, last_name: customer.last_name, phone: customer.phone, email: customer.email } : {},
      discount: discountValue ? { type: 'fixed', amount: discountValue } : null,
      note, ...payment,
    };
    try {
      const r = await postSale(payload);
      if (r.ok) { finishSale(r.order, false); return; }
      if (!r.network) { toast(r.error, 'error'); return; } // refused: nothing saved, the sale stays on screen
      // no connection: keep the sale on this device, print the receipt, send it automatically later
      const offline = { ...payload, offline_at: new Date().toISOString() };
      setQueued(queueSale({ payload: offline }));
      finishSale(offlineReceipt(offline, cart, { subtotal: Math.round(subtotal * 100) / 100, discount: Math.round(discountValue * 100) / 100, total }, staff.name), true);
      toast('No connection — sale saved on this device, it will be sent automatically', 'error');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const hold = () => {
    if (!cart.length) return;
    const next = [{ id: Date.now(), at: new Date().toISOString(), cart, customer, discount, note }, ...held];
    setHeld(next); writeHeld(next); reset();
    toast('Sale put on hold');
  };
  const resume = (h) => {
    const next = held.filter((x) => x.id !== h.id);
    setHeld(next); writeHeld(next);
    setCart(h.cart); setCustomer(h.customer); setDiscount(h.discount); setNote(h.note || '');
    setHeldOpen(false);
  };

  if (locked) return <LockScreen staff={staff} onUnlock={async (pin) => { await login({ pin }); setLocked(false); }} onLogout={logout} />;
  if (!catalog) return <Spinner className="h-screen items-center" />;
  const topCats = catalog.categories.filter((c) => !c.parent_id);

  return (
    <div className="flex h-screen flex-col bg-zinc-100">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-3">
        <Link to="/" title="Back to dashboard" className="rounded-md p-2 hover:bg-zinc-100"><ArrowLeft size={18} /></Link>
        <div className="relative max-w-xl flex-1">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input ref={search} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey}
            placeholder="Search or scan…"
            className="h-10 w-full rounded-md border border-zinc-300 bg-white pl-10 pr-8 text-[15px] outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900" />
          {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-900"><X size={15} /></button>}
        </div>
        <div className="hidden flex-1 sm:block" />
        {(!online || queued > 0) && (
          <button type="button" onClick={sync} title="Send the sales saved on this device"
            className={cx('flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium', online ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700')}>
            <span className={cx('h-2 w-2 rounded-full', online ? 'bg-amber-500' : 'bg-red-500')} />
            {!online ? 'Offline' : ''}{!online && queued > 0 ? ' · ' : ''}{queued > 0 ? `${queued} to send` : ''}
          </button>
        )}
        <div className="hidden items-center rounded-md border border-zinc-200 p-0.5 sm:flex" role="group" aria-label="View">
          <button type="button" title="Grid view" onClick={() => setView('grid')} className={cx('rounded p-1.5', view === 'grid' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100')}><LayoutGrid size={16} /></button>
          <button type="button" title="Table view" onClick={() => setView('table')} className={cx('rounded p-1.5', view === 'table' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100')}><List size={16} /></button>
        </div>
        <Button variant="ghost" icon={AppWindow} title="Open another till in a new tab" onClick={() => window.open(newTillUrl(), '_blank')}><span className="hidden xl:inline">New tab</span></Button>
        <Button variant="ghost" icon={ReceiptText} title="Sales" onClick={() => setDrawer(true)}><span className="hidden sm:inline">Sales</span></Button>
        {held.length > 0 && <Button variant="ghost" icon={Clock} onClick={() => setHeldOpen(true)}>On hold ({held.length})</Button>}
        <Button variant="ghost" icon={Wallet} onClick={() => setRegisterOpen(true)}>
          {session ? <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="hidden sm:inline">Register</span></span> : <span className="hidden sm:inline">Open register</span>}
        </Button>
        <button onClick={() => setLocked(true)} title="Lock / switch cashier" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-100">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">{staff.name.slice(0, 1)}</span>
          <span className="hidden text-[13px] sm:inline">{staff.name.split(' ')[0]}</span><Lock size={14} className="text-zinc-400" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Catalogue */}
        <section className={cx('min-w-0 flex-1 flex-col', mobileView === 'cart' ? 'hidden md:flex' : 'flex')}>
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-zinc-200 bg-white px-3 py-2">
            <button onClick={() => setCat(null)} className={cx('whitespace-nowrap rounded-full px-3 py-1 text-[13px]', !cat ? 'bg-zinc-900 text-white' : 'bg-zinc-100 hover:bg-zinc-200')}>All</button>
            {topCats.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} className={cx('whitespace-nowrap rounded-full px-3 py-1 text-[13px]', cat === c.id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 hover:bg-zinc-200')}>{c.name}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3" onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) setLimit((l) => l + 60); }}>
            {done && (
              <div className="mb-3 flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
                <span>Sale <b>#{done.number}</b> {done.offline ? 'saved on this device (no connection)' : 'completed'} · {money(done.total)}{done.cash_change > 0 && <> · change <b>{money(done.cash_change)}</b></>}</span>
                <div className="flex gap-2"><Button size="sm" icon={Printer} onClick={() => printOrder(done, { store: catalog.store, pos: settings })}>Receipt</Button><Button size="sm" variant="ghost" onClick={() => setDone(null)}><X size={14} /></Button></div>
              </div>
            )}
            {view === 'table' ? (
              <table className="w-full border-collapse bg-white text-left text-[14px]">
                <thead className="sticky top-0 z-10 bg-zinc-50 text-xs font-medium text-zinc-500">
                  <tr><th className="w-12 px-2 py-2" /><th className="px-2 py-2">Product</th><th className="px-2 py-2">SKU / barcode</th><th className="px-2 py-2 text-right">Stock</th><th className="px-2 py-2 text-right">Price</th></tr>
                </thead>
                <tbody>
                  {results.slice(0, limit).map((p) => {
                    const pr = p.type === 'variable' ? Math.min(...(p.variations || []).filter((v) => v.regular_price != null).map((v) => priceOf(v).price), Infinity) : priceOf(p).price;
                    const stock = p.type === 'variable' ? (p.variations || []).reduce((s, v) => s + (v.manage_stock ? Math.max(0, v.stock_quantity) : 0), 0) : p.manage_stock ? p.stock_quantity : null;
                    return (
                      <tr key={p.id} onClick={() => addLine(p)} className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50">
                        <td className="px-2 py-1.5">{p.image ? <img src={sized(p.image, 150)} alt="" loading="lazy" className="h-10 w-10 rounded border border-zinc-200 object-contain" /> : <span className="flex h-10 w-10 items-center justify-center rounded border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-400">{initials(p.name)}</span>}</td>
                        <td className="px-2 py-1.5"><div className="font-medium leading-snug">{p.name}</div>{p.type === 'variable' && <div className="text-xs text-zinc-500">{p.variations?.length} options</div>}</td>
                        <td className="num px-2 py-1.5 text-[13px] text-zinc-600">{code(p) || '—'}</td>
                        <td className={cx('num px-2 py-1.5 text-right', stock !== null && stock <= 0 ? 'text-red-600' : 'text-zinc-500')}>{stock ?? '—'}</td>
                        <td className="num px-2 py-1.5 text-right font-semibold">{Number.isFinite(pr) ? money(pr) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {results.slice(0, limit).map((p) => {
                const pr = p.type === 'variable' ? Math.min(...(p.variations || []).filter((v) => v.regular_price != null).map((v) => priceOf(v).price), Infinity) : priceOf(p).price;
                const stock = p.type === 'variable' ? (p.variations || []).reduce((s, v) => s + (v.manage_stock ? Math.max(0, v.stock_quantity) : 0), 0) : p.manage_stock ? p.stock_quantity : null;
                const out = p.type === 'variable' ? !(p.variations || []).some((v) => (v.manage_stock ? v.stock_quantity > 0 : v.stock_status !== 'outofstock')) : p.manage_stock ? p.stock_quantity <= 0 : p.stock_status === 'outofstock';
                return (
                  <button key={p.id} onClick={() => addLine(p)} className="flex flex-col overflow-hidden rounded-md border border-zinc-200 bg-white text-left transition hover:border-zinc-900">
                    <div className="relative aspect-[4/3] w-full bg-zinc-50">
                      {p.image ? <img src={sized(p.image, 500)} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
                        : <span className="flex h-full w-full items-center justify-center text-2xl font-semibold tracking-wide text-zinc-300">{initials(p.name)}</span>}
                      {out && <span className="absolute left-1.5 top-1.5 rounded bg-white/90 px-1.5 text-[11px] font-medium text-red-600">Out of stock</span>}
                      {p.type === 'variable' && <span className="absolute right-1.5 top-1.5 rounded bg-white/90 px-1.5 text-[11px] text-zinc-600">{p.variations?.length} options</span>}
                    </div>
                    <div className="flex flex-1 flex-col p-2">
                      <div className="line-clamp-2 text-[13px] leading-snug">{p.name}</div>
                      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="num shrink-0 font-semibold">{Number.isFinite(pr) ? money(pr) : '—'}</span>
                          {code(p) && <span className="num truncate text-[11px] text-zinc-500" title="SKU / barcode">{code(p)}</span>}
                        </span>
                        {stock !== null && <span className={cx('num text-[11px]', stock <= 0 ? 'text-red-600' : 'text-zinc-400')}>{stock}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            )}
            {!results.length && <p className="py-16 text-center text-zinc-400">No products found</p>}
          </div>
          {cart.length > 0 && (
            <button onClick={() => setMobileView('cart')} className="m-3 mt-0 flex shrink-0 items-center justify-between rounded-md bg-zinc-900 px-4 py-3 font-medium text-white md:hidden">
              <span>View cart · {cart.reduce((n, l) => n + l.quantity, 0)} items</span><span className="num">{money(total)}</span>
            </button>
          )}
        </section>

        {/* Cart */}
        <aside className={cx('w-full shrink-0 flex-col border-l border-zinc-200 bg-white md:w-[380px] lg:w-[440px] xl:w-[500px] 2xl:w-[560px]', mobileView === 'products' ? 'hidden md:flex' : 'flex')}>
          <div className="border-b border-zinc-200 p-3">
            <button onClick={() => setMobileView('products')} className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-zinc-600 md:hidden"><ArrowLeft size={14} />Add more products</button>
            {customer ? (
              <div className="flex items-center justify-between rounded-md bg-zinc-100 px-3 py-2">
                <span className="flex items-center gap-2"><User size={15} />{fullName(customer) || customer.phone}<span className="text-zinc-500">{customer.phone}</span></span>
                <button onClick={() => setCustomer(null)} className="text-zinc-400 hover:text-zinc-900"><X size={15} /></button>
              </div>
            ) : (
              <div className="flex gap-2">
                <CustomerSearch className="flex-1" onPick={setCustomer} />
                <Button icon={UserPlus} title="New customer" onClick={() => setNewCustomer({ first_name: '', last_name: '', phone: '' })} />
              </div>
            )}
          </div>
          <ul className="flex-1 divide-y divide-zinc-100 overflow-y-auto">
            {cart.map((l) => (
              <li key={l.key} className="flex gap-2 px-3 py-2">
                <Thumb src={l.image} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[13px] leading-snug">{l.name}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex items-center rounded-md border border-zinc-300">
                      <button className="px-2 py-1 hover:bg-zinc-100" onClick={() => setCart(cart.map((x) => (x.key === l.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))}><Minus size={12} /></button>
                      <input value={l.quantity} onChange={(e) => setCart(cart.map((x) => (x.key === l.key ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} className="num w-8 text-center outline-none" />
                      <button className="px-2 py-1 hover:bg-zinc-100" onClick={() => setCart(cart.map((x) => (x.key === l.key ? { ...x, quantity: x.quantity + 1 } : x)))}><Plus size={12} /></button>
                    </div>
                    {can('manager') || settings.cashier_discounts !== false ? (
                      <input type="number" step="0.01" value={l.price} title="Unit price"
                        onChange={(e) => setCart(cart.map((x) => (x.key === l.key ? { ...x, price: Number(e.target.value) } : x)))}
                        className={cx('num h-7 w-20 rounded border px-1.5 text-right text-[13px] outline-none focus:border-zinc-900', l.price < l.regular ? 'border-amber-300 bg-amber-50' : 'border-zinc-200')} />
                    ) : <span className="num text-[13px] text-zinc-500">{money(l.price)}</span>}
                    {l.stock !== null && l.quantity > l.stock && <span className="text-[11px] text-red-600">only {l.stock}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end justify-between">
                  <span className="num font-medium">{money(l.price * l.quantity)}</span>
                  <button onClick={() => setCart(cart.filter((x) => x.key !== l.key))} className="rounded p-1 text-zinc-400 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
            {!cart.length && <li className="flex h-full flex-col items-center justify-center p-8 text-center text-zinc-400"><Banknote size={28} className="mb-2 text-zinc-300" />Scan or tap products to start a sale</li>}
          </ul>
          <div className="border-t border-zinc-200 p-3">
            <div className="mb-2 flex gap-1.5">
              <Button size="sm" icon={Percent} disabled={!cart.length || !(can('manager') || settings.cashier_discounts !== false)} onClick={() => setDiscountOpen(true)}>Discount</Button>
              <Button size="sm" icon={PackagePlus} onClick={() => setCustomOpen(true)}>Custom item</Button>
              <Button size="sm" icon={PauseCircle} disabled={!cart.length} onClick={hold}>Hold</Button>
              <Button size="sm" variant="ghost" icon={Trash2} disabled={!cart.length} onClick={reset} title="Clear sale" />
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note on this sale (optional)" className="mb-2 h-8 w-full rounded border border-zinc-200 px-2 text-[13px] outline-none focus:border-zinc-900" />
            <div className="space-y-1 text-[13px]">
              <div className="flex justify-between text-zinc-600"><span>Subtotal · {cart.reduce((s, l) => s + l.quantity, 0)} items</span><span className="num">{money(subtotal)}</span></div>
              {discountValue > 0 && <div className="flex justify-between text-zinc-600"><span>Discount{discount.type === 'percent' ? ` (${discount.amount}%)` : ''} <button className="text-red-600 hover:underline" onClick={() => setDiscount(null)}>remove</button></span><span className="num">-{money(discountValue)}</span></div>}
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-base font-semibold">Total</span>
              <span className="text-right"><span className="num block text-2xl font-semibold">{money(total)}</span>{lbpRate > 0 && total > 0 && <span className="num text-xs text-zinc-500">{Math.round(total * lbpRate).toLocaleString('en-US')} LBP</span>}</span>
            </div>
            <Button variant="primary" size="lg" className="mt-3 w-full" disabled={!cart.length} onClick={() => setPaying(true)}>Charge {money(total)} <span className="ml-1 text-xs opacity-60">F9</span></Button>
          </div>
        </aside>
      </div>

      {picker && <VariationPicker product={picker} highlight={pickerHighlight} onClose={() => { setPicker(null); setPickerHighlight(null); }} onPick={(v) => { addLine(picker, v); setPicker(null); setPickerHighlight(null); search.current?.focus(); }} />}
      {paying && <PaymentModal total={total} payments={posPayments} lbpRate={lbpRate} busy={sending} onClose={() => !sending && setPaying(false)} onPay={pay} />}
      {drawer && <OrdersDrawer settings={catalog} onClose={() => { setDrawer(false); loadCatalog(); }} />}
      {registerOpen && <RegisterModal session={session} onClose={() => setRegisterOpen(false)} onChange={loadSession} />}

      <Modal open={heldOpen} onClose={() => setHeldOpen(false)} title="Sales on hold" width={480}>
        <ul className="divide-y divide-zinc-100">
          {held.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-2">
              <div><div>{h.cart.length} items · {money(h.cart.reduce((s, l) => s + l.price * l.quantity, 0))}</div><div className="text-xs text-zinc-500">{time(h.at)}{h.customer ? ` · ${fullName(h.customer)}` : ''}</div></div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => resume(h)}>Resume</Button>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => { const n = held.filter((x) => x.id !== h.id); setHeld(n); writeHeld(n); }} />
              </div>
            </li>
          ))}
        </ul>
      </Modal>

      {customOpen && <CustomItem onClose={() => setCustomOpen(false)} onAdd={(it) => { setCart([...cart, { ...it, key: `custom-${Date.now()}`, custom: true, regular: it.price, stock: null }]); setCustomOpen(false); }} />}
      {discountOpen && <DiscountModal subtotal={subtotal} value={discount} onClose={() => setDiscountOpen(false)} onApply={(d) => { setDiscount(d); setDiscountOpen(false); }} />}
      {newCustomer && (
        <Modal open onClose={() => setNewCustomer(null)} title="New customer" width={420}
          footer={<Button variant="primary" loading={busy} onClick={async () => { const c = await run(() => api.post('/admin/customers', { ...newCustomer, billing: { first_name: newCustomer.first_name, last_name: newCustomer.last_name, phone: newCustomer.phone } }), 'Customer added'); setCustomer(c); setNewCustomer(null); }}>Add customer</Button>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name"><Input autoFocus value={newCustomer.first_name} onChange={(e) => setNewCustomer({ ...newCustomer, first_name: e.target.value })} /></Field>
            <Field label="Last name"><Input value={newCustomer.last_name} onChange={(e) => setNewCustomer({ ...newCustomer, last_name: e.target.value })} /></Field>
            <Field label="Phone" className="col-span-2"><Input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CustomItem({ onClose, onAdd }) {
  const [it, setIt] = useState({ name: '', price: '', quantity: 1 });
  return (
    <Modal open onClose={onClose} title="Custom item" width={400}
      footer={<Button variant="primary" disabled={!it.name || it.price === ''} onClick={() => onAdd({ ...it, price: Number(it.price), product_id: null, variation_id: null })}>Add to sale</Button>}>
      <p className="mb-3 text-[13px] text-zinc-500">For a service or an item that is not in the catalogue. It is not counted in stock.</p>
      <div className="space-y-3">
        <Field label="Name"><Input autoFocus value={it.name} onChange={(e) => setIt({ ...it, name: e.target.value })} /></Field>
        <Field label="Price"><Input prefix="$" type="number" step="0.01" value={it.price} onChange={(e) => setIt({ ...it, price: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function DiscountModal({ subtotal, value, onClose, onApply }) {
  const [d, setD] = useState(value || { type: 'percent', amount: '' });
  return (
    <Modal open onClose={onClose} title="Discount on this sale" width={400}
      footer={<Button variant="primary" disabled={!Number(d.amount)} onClick={() => onApply({ ...d, amount: Number(d.amount) })}>Apply</Button>}>
      <div className="mb-3 flex gap-2">
        {[['percent', '%'], ['fixed', '$']].map(([k, l]) => <button key={k} onClick={() => setD({ ...d, type: k })} className={cx('flex-1 rounded-md border py-2 font-medium', d.type === k ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300')}>{l}</button>)}
      </div>
      <Input autoFocus type="number" step="0.01" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} className="h-12 text-lg" />
      <div className="mt-2 flex gap-2">{(d.type === 'percent' ? [5, 10, 15, 20] : [1, 2, 5, 10]).map((v) => <Button key={v} size="sm" onClick={() => setD({ ...d, amount: v })}>{d.type === 'percent' ? `${v}%` : money(v)}</Button>)}</div>
      {Number(d.amount) > 0 && <p className="mt-3 text-[13px] text-zinc-500">Customer pays {money(Math.max(0, subtotal - (d.type === 'percent' ? (subtotal * d.amount) / 100 : Number(d.amount))))}</p>}
    </Modal>
  );
}

function LockScreen({ staff, onUnlock, onLogout }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const press = async (k) => {
    if (k === 'del') return setPin(pin.slice(0, -1));
    const next = pin + k;
    setPin(next);
    setErr('');
    if (next.length >= 4) {
      try { await onUnlock(next); } catch (e) { if (next.length >= 6) { setErr(e.message); setPin(''); } }
    }
  };
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-zinc-900 text-white">
      <Lock size={28} className="mb-3 text-zinc-400" />
      <div className="mb-1 text-lg font-semibold">POS locked</div>
      <div className="mb-6 text-sm text-zinc-400">Enter your PIN to continue{staff ? ` (last: ${staff.name})` : ''}</div>
      <div className="mb-6 flex gap-2">{Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <span key={i} className={cx('h-3 w-3 rounded-full', i < pin.length ? 'bg-white' : 'bg-zinc-700')} />)}</div>
      {err && <div className="mb-4 text-sm text-red-400">{err}</div>}
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) => k === '' ? <span key="x" /> : (
          <button key={k} onClick={() => press(k)} className="h-16 w-16 rounded-full bg-zinc-800 text-xl hover:bg-zinc-700">{k === 'del' ? '⌫' : k}</button>
        ))}
      </div>
      <button onClick={onLogout} className="mt-8 text-sm text-zinc-400 hover:text-white">Sign in with password instead</button>
    </div>
  );
}
