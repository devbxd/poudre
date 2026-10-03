import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { money, fullName, ORDER_STATUS } from '../lib/format.js';
import { useSettings } from '../lib/hooks.js';
import { Button, Card, Field, Input, PageHeader, Select, Textarea, Thumb, useAction } from '../components/ui.jsx';
import { ProductSearch, CustomerSearch } from '../components/pickers.jsx';

/** Manual order (phone / WhatsApp / Instagram orders). Prices are re-checked by the server. */
export default function OrderNew() {
  const navigate = useNavigate();
  const settings = useSettings();
  const [lines, setLines] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [billing, setBilling] = useState({ first_name: '', last_name: '', phone: '', email: '', address_1: '', city: '' });
  const [o, setO] = useState({ status: 'processing', payment_method: 'cod', shipping_total: '', discount: '', coupon_code: '', customer_note: '', note: '' });
  const [run, busy] = useAction();

  const add = (p) => setLines((ls) => {
    const key = `${p.id}-${p.variation_id || ''}`;
    const found = ls.find((l) => l.key === key);
    if (found) return ls.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
    return [...ls, { key, product_id: p.id, variation_id: p.variation_id, name: p.name, image: p.image, sku: p.sku, type: p.type, price: Number(p.sale_price ?? p.regular_price) || 0, quantity: 1 }];
  });
  const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const total = Math.max(0, subtotal - (Number(o.discount) || 0)) + (Number(o.shipping_total) || 0);
  const payments = settings?.payments || [];

  const submit = async () => {
    if (lines.some((l) => l.type === 'variable')) return run(() => Promise.reject(new Error('Pick the exact option (shade/size) for products with options')));
    const pay = payments.find((p) => p.id === o.payment_method);
    const order = await run(() => api.post('/admin/orders', {
      items: lines.map((l) => ({ product_id: l.product_id, variation_id: l.variation_id, quantity: l.quantity, price: l.price })),
      customer_id: customer?.id, billing, shipping: billing, status: o.status, payment_method: o.payment_method, payment_title: pay?.title || o.payment_method,
      shipping_total: Number(o.shipping_total) || 0, discount: o.discount ? { type: 'fixed', amount: Number(o.discount) } : null,
      coupon_code: o.coupon_code || null, customer_note: o.customer_note, note: o.note,
    }), 'Order created');
    navigate(`/orders/${order.id}`);
  };

  return (
    <>
      <PageHeader back={<Link to="/orders" className="mb-1 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} /> Orders</Link>}
        title="New order" subtitle="For orders taken by phone, WhatsApp or Instagram" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Products">
            <ProductSearch onPick={add} autoFocus />
            <ul className="mt-3 divide-y divide-zinc-100">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center gap-3 py-2.5">
                  <Thumb src={l.image} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{l.name}</div>
                    {l.type === 'variable' && <div className="text-xs text-red-600">Choose the option: search the exact shade/size instead</div>}
                  </div>
                  <Input type="number" min="1" value={l.quantity} className="w-16" onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))} />
                  <Input prefix="$" type="number" step="0.01" value={l.price} className="w-28" onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, price: Number(e.target.value) } : x)))} />
                  <span className="num w-20 text-right font-medium">{money(l.price * l.quantity)}</span>
                  <button onClick={() => setLines(lines.filter((x) => x.key !== l.key))} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"><Trash2 size={15} /></button>
                </li>
              ))}
              {!lines.length && <li className="py-8 text-center text-zinc-400">Search and add products above</li>}
            </ul>
          </Card>
          <Card title="Customer & delivery address">
            {customer ? (
              <div className="mb-3 flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2">
                <span>{fullName(customer) || customer.email} · {customer.phone}</span>
                <button onClick={() => setCustomer(null)} className="text-zinc-400 hover:text-zinc-900"><X size={15} /></button>
              </div>
            ) : (
              <CustomerSearch className="mb-3" onPick={(c) => {
                setCustomer(c);
                setBilling({ ...billing, first_name: c.first_name, last_name: c.last_name, phone: c.phone || '', email: c.email || '', city: c.city || billing.city });
              }} />
            )}
            <div className="grid grid-cols-2 gap-3">
              {[['first_name', 'First name'], ['last_name', 'Last name'], ['phone', 'Phone'], ['email', 'Email'], ['address_1', 'Address'], ['city', 'City / area']].map(([k, label]) => (
                <Field key={k} label={label}><Input value={billing[k] || ''} onChange={(e) => setBilling({ ...billing, [k]: e.target.value })} /></Field>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">A new customer is created automatically if the phone or email is new.</p>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Summary">
            <div className="space-y-3">
              <Field label="Status">
                <Select value={o.status} onChange={(e) => setO({ ...o, status: e.target.value })}>
                  {['pending', 'processing', 'on-hold', 'completed'].map((k) => <option key={k} value={k}>{ORDER_STATUS[k].label}</option>)}
                </Select>
              </Field>
              <Field label="Payment">
                <Select value={o.payment_method} onChange={(e) => setO({ ...o, payment_method: e.target.value })}>
                  {payments.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  {!payments.some((p) => p.id === 'cod') && <option value="cod">Cash on delivery</option>}
                  <option value="whish">Whish</option><option value="omt">OMT</option><option value="card">Card</option><option value="cash">Cash</option>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Delivery fee"><Input prefix="$" type="number" step="0.01" value={o.shipping_total} onChange={(e) => setO({ ...o, shipping_total: e.target.value })} /></Field>
                <Field label="Discount"><Input prefix="$" type="number" step="0.01" value={o.discount} onChange={(e) => setO({ ...o, discount: e.target.value })} /></Field>
              </div>
              <Field label="Coupon code"><Input value={o.coupon_code} onChange={(e) => setO({ ...o, coupon_code: e.target.value })} /></Field>
              <Field label="Customer note"><Textarea rows={2} value={o.customer_note} onChange={(e) => setO({ ...o, customer_note: e.target.value })} /></Field>
              <Field label="Private note"><Textarea rows={2} value={o.note} onChange={(e) => setO({ ...o, note: e.target.value })} /></Field>
            </div>
            <div className="mt-4 space-y-1 border-t border-zinc-200 pt-3">
              <div className="flex justify-between text-zinc-600"><span>Subtotal</span><span className="num">{money(subtotal)}</span></div>
              <div className="flex justify-between text-base font-semibold"><span>Total</span><span className="num">{money(total)}</span></div>
            </div>
            <Button variant="primary" className="mt-4 w-full" disabled={!lines.length} loading={busy} onClick={submit}>Create order</Button>
          </Card>
        </div>
      </div>
    </>
  );
}
