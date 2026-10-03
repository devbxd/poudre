import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, FileText, RotateCcw, Trash2, Pencil } from 'lucide-react';
import { useFetch, useSettings } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { money, dateTime, fullName, ORDER_STATUS, CHANNEL } from '../lib/format.js';
import { Badge, Button, Card, Checkbox, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, Thumb, useAction, useToast } from '../components/ui.jsx';
import { printOrder } from '../components/Receipt.jsx';
import { useAuth } from '../lib/auth.jsx';

const ADDRESS_FIELDS = [
  ['first_name', 'First name'], ['last_name', 'Last name'], ['phone', 'Phone'], ['email', 'Email'],
  ['address_1', 'Address'], ['address_2', 'Address line 2'], ['city', 'City'], ['state', 'Area'],
];

function Address({ title, value, onSave, canEdit }) {
  const [edit, setEdit] = useState(null);
  const lines = [fullName(value), value?.company, value?.address_1, value?.address_2, [value?.city, value?.state].filter(Boolean).join(', '), value?.phone, value?.email].filter(Boolean);
  return (
    <Card title={title} actions={canEdit && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit({ ...value })}>Edit</Button>}>
      {lines.length ? <div className="space-y-0.5 text-zinc-700">{lines.map((l, i) => <div key={i}>{l}</div>)}</div> : <p className="text-zinc-400">No details</p>}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Edit ${title.toLowerCase()}`}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => { await onSave(edit); setEdit(null); }}>Save</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          {ADDRESS_FIELDS.map(([k, label]) => (
            <Field key={k} label={label} className={k.startsWith('address') ? 'col-span-2' : ''}>
              <Input value={edit?.[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </Modal>
    </Card>
  );
}

function RefundModal({ order, open, onClose, onDone }) {
  const [qty, setQty] = useState({});
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [run, busy] = useAction();
  const computed = order.items.reduce((s, i) => s + (Number(qty[i.id]) || 0) * (Number(i.total) / i.quantity), 0);
  const left = Number(order.total) - Number(order.refunded_total);
  const submit = async () => {
    const items = Object.entries(qty).filter(([, q]) => Number(q) > 0).map(([id, q]) => ({ order_item_id: Number(id), quantity: Number(q) }));
    await run(() => api.post(`/admin/orders/${order.id}/refund`, { items, amount: amount ? Number(amount) : null, reason, restock }), 'Refund recorded');
    onDone();
  };
  return (
    <Modal open={open} onClose={onClose} title={`Refund order #${order.number}`} width={600}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Refund {money(amount ? Number(amount) : computed)}</Button></>}>
      <p className="mb-3 text-[13px] text-zinc-500">Choose the items coming back. You can also type a custom amount. Left to refund: {money(left)}</p>
      <div className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
        {order.items.map((i) => {
          const max = i.quantity - i.refunded_qty;
          return (
            <div key={i.id} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1 truncate">{i.name}</span>
              <span className="num text-zinc-500">{money(Number(i.total) / i.quantity)}</span>
              <Input type="number" min="0" max={max} disabled={!max} value={qty[i.id] || ''} placeholder="0" className="w-20"
                onChange={(e) => setQty({ ...qty, [i.id]: Math.min(max, Math.max(0, Number(e.target.value))) })} />
              <span className="w-10 text-xs text-zinc-400">/ {max}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Refund amount" hint="Leave empty to use the items above"><Input prefix="$" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={computed.toFixed(2)} /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" /></Field>
      </div>
      <Checkbox className="mt-3" checked={restock} onChange={setRestock} label="Put refunded items back in stock" />
    </Modal>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const settings = useSettings();
  const { data: order, reload, setData } = useFetch(`/admin/orders/${id}`);
  const [note, setNote] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [run, busy] = useAction();
  if (!order) return <Spinner />;

  const update = async (patch, msg = 'Order updated') => setData(await run(() => api.put(`/admin/orders/${id}`, patch), msg));
  const addNote = async () => {
    if (!note.trim()) return;
    await run(() => api.post(`/admin/orders/${id}/notes`, { note }), 'Note added');
    setNote('');
    reload();
  };
  const print = (format) => printOrder(order, { store: settings?.store, pos: settings?.pos, format });
  const profit = order.items.reduce((s, i) => (i.purchase_price != null ? s + Number(i.total) - Number(i.purchase_price) * i.quantity : s), 0);
  const hasCost = order.items.some((i) => i.purchase_price != null);

  return (
    <>
      <PageHeader
        back={<Link to="/orders" className="mb-1 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} /> Orders</Link>}
        title={<span className="flex items-center gap-3">Order #{order.number} <Badge tone={ORDER_STATUS[order.status]?.tone}>{ORDER_STATUS[order.status]?.label}</Badge></span>}
        subtitle={`${dateTime(order.created_at)} · ${CHANNEL[order.channel]}${order.staff_name ? ` · by ${order.staff_name}` : ''}`}
        actions={<>
          <Button icon={Printer} onClick={() => print('receipt')}>Receipt</Button>
          <Button icon={FileText} onClick={() => print('invoice')}>Invoice</Button>
          {can('manager') && Number(order.refunded_total) < Number(order.total) && order.status !== 'cancelled' && <Button icon={RotateCcw} onClick={() => setRefundOpen(true)}>Refund</Button>}
          {can('owner') && <Button variant="danger" icon={Trash2} onClick={async () => {
            if (await confirm({ title: 'Delete this order?', message: 'The order is removed for good and its items go back into stock. Prefer "Cancelled" if you want to keep a trace.', danger: true, confirmLabel: 'Delete' })) {
              await run(() => api.del(`/admin/orders/${id}`), 'Order deleted');
              navigate('/orders');
            }
          }} />}
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Items" padded={false}>
            <ul className="divide-y divide-zinc-100">
              {order.items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                  <Thumb src={i.image} size={40} />
                  <div className="min-w-0 flex-1">
                    {i.product_id ? <Link to={`/products/${i.product_id}`} className="font-medium hover:underline">{i.name}</Link> : <span className="font-medium">{i.name}</span>}
                    <div className="text-xs text-zinc-500">{i.sku && `SKU ${i.sku}`}{i.refunded_qty > 0 && <span className="ml-2 text-red-600">{i.refunded_qty} refunded</span>}</div>
                  </div>
                  <span className="num text-zinc-500">{money(i.unit_price)} × {i.quantity}</span>
                  <span className="num w-24 text-right font-medium">{money(i.total)}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5 border-t border-zinc-200 px-4 py-3">
              {[['Subtotal', order.subtotal], ['Discount', -order.discount_total], ['Delivery', order.shipping_total], ['Fees', order.fee_total]]
                .filter(([k, v]) => k === 'Subtotal' || Number(v) !== 0)
                .map(([k, v]) => <div key={k} className="flex justify-between text-zinc-600"><span>{k}{k === 'Discount' && order.coupon_codes?.length ? ` (${order.coupon_codes.join(', ')})` : ''}</span><span className="num">{money(v)}</span></div>)}
              <div className="flex justify-between text-base font-semibold"><span>Total</span><span className="num">{money(order.total)}</span></div>
              {Number(order.refunded_total) > 0 && <div className="flex justify-between text-red-600"><span>Refunded</span><span className="num">-{money(order.refunded_total)}</span></div>}
              {order.cash_tendered != null && <div className="flex justify-between text-zinc-500"><span>Cash given · change</span><span className="num">{money(order.cash_tendered)} · {money(order.cash_change)}</span></div>}
              {can('manager') && hasCost && <div className="flex justify-between text-zinc-500"><span>Gross profit</span><span className="num">{money(profit)}</span></div>}
            </div>
          </Card>

          {order.refunds.length > 0 && (
            <Card title="Refunds" padded={false}>
              <ul className="divide-y divide-zinc-100">
                {order.refunds.map((r) => (
                  <li key={r.id} className="flex justify-between px-4 py-2.5">
                    <span>{dateTime(r.created_at)}{r.reason && ` · ${r.reason}`}{r.staff_name && <span className="text-zinc-500"> · {r.staff_name}</span>}</span>
                    <span className="num font-medium text-red-600">-{money(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Notes & history">
            <div className="mb-4 flex gap-2">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a private note…" className="min-h-[38px]" rows={1} />
              <Button onClick={addNote} disabled={!note.trim()} loading={busy}>Add</Button>
            </div>
            <ul className="space-y-3">
              {order.customer_note && <li className="rounded-md bg-amber-50 p-3 text-amber-900"><div className="text-xs font-medium">Customer note</div>{order.customer_note}</li>}
              {order.notes.map((n) => (
                <li key={n.id} className="border-l-2 border-zinc-200 pl-3">
                  <div>{n.note}</div>
                  <div className="text-xs text-zinc-400">{dateTime(n.created_at)}{n.author && ` · ${n.author}`}</div>
                </li>
              ))}
              {!order.notes.length && !order.customer_note && <li className="text-zinc-400">No notes yet</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Status">
            <Select value={order.status} disabled={!can('manager') || busy} onChange={(e) => update({ status: e.target.value }, 'Status updated')}>
              {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <p className="mt-2 text-xs text-zinc-500">Cancelling puts the items back in stock automatically.</p>
            <dl className="mt-4 space-y-1.5 text-[13px]">
              <div className="flex justify-between"><dt className="text-zinc-500">Payment</dt><dd>{order.payment_title || order.payment_method || '—'}</dd></div>
              {order.shipping_method && <div className="flex justify-between"><dt className="text-zinc-500">Delivery</dt><dd>{order.shipping_method}</dd></div>}
              {order.paid_at && <div className="flex justify-between"><dt className="text-zinc-500">Paid</dt><dd>{dateTime(order.paid_at)}</dd></div>}
              {order.invoice_number && <div className="flex justify-between"><dt className="text-zinc-500">Invoice no.</dt><dd>{order.invoice_number}</dd></div>}
            </dl>
          </Card>
          <Card title="Customer">
            {order.customer ? (
              <Link to={`/customers/${order.customer.id}`} className="block hover:underline">
                <div className="font-medium">{fullName(order.customer) || order.customer.email}</div>
                <div className="text-zinc-500">{order.customer.phone}</div>
                <div className="text-zinc-500">{order.customer.email}</div>
              </Link>
            ) : <p className="text-zinc-400">Walk-in customer</p>}
          </Card>
          <Address title="Billing" value={order.billing} canEdit={can('manager')} onSave={(billing) => update({ billing })} />
          {order.channel !== 'pos' && <Address title="Shipping" value={order.shipping} canEdit={can('manager')} onSave={(shipping) => update({ shipping })} />}
        </div>
      </div>
      {refundOpen && <RefundModal order={order} open onClose={() => setRefundOpen(false)} onDone={() => { setRefundOpen(false); reload(); }} />}
    </>
  );
}
