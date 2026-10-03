import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PackageCheck, Printer, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { money, dateTime } from '../lib/format.js';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useAction, useToast } from '../components/ui.jsx';
import { ProductSearch } from '../components/pickers.jsx';
import { PO_STATUS } from './PurchaseOrders.jsx';

export default function PurchaseOrderEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { confirm } = useToast();
  const { data, setData } = useFetch(isNew ? null : `/admin/purchase-orders/${id}`);
  const { data: suppliers } = useFetch('/admin/suppliers');
  const [po, setPo] = useState(isNew ? { supplier_id: '', items: [], notes: '', expected_at: '', status: 'draft' } : null);
  const [receive, setReceive] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setPo({ ...data, expected_at: data.expected_at?.slice(0, 10) || '' }); }, [data]);
  if (!po) return <Spinner />;
  const locked = ['received', 'cancelled', 'partial'].includes(po.status);
  const total = po.items.reduce((s, i) => s + Number(i.qty) * Number(i.cost || 0), 0);
  const setItem = (i, patch) => setPo({ ...po, items: po.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const save = async (status) => {
    const body = { supplier_id: po.supplier_id || null, items: po.items, notes: po.notes, expected_at: po.expected_at || null, status: status || po.status };
    const saved = await run(() => (isNew ? api.post('/admin/purchase-orders', body) : api.put(`/admin/purchase-orders/${id}`, body)), 'Purchase order saved');
    if (isNew) navigate(`/purchase-orders/${saved.id}`, { replace: true }); else setData(saved);
  };
  const doReceive = async (all) => {
    const body = all ? { all: true } : { lines: Object.entries(receive).map(([index, qty]) => ({ index: Number(index), qty: Number(qty) })) };
    const saved = await run(() => api.post(`/admin/purchase-orders/${id}/receive`, body), 'Stock added');
    setData(saved);
    setReceive(null);
  };

  return (
    <>
      <PageHeader
        back={<Link to="/purchase-orders" className="mb-1 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} /> Purchase orders</Link>}
        title={isNew ? 'New purchase order' : <span className="flex items-center gap-3">{po.number} <Badge tone={PO_STATUS[po.status]?.tone}>{PO_STATUS[po.status]?.label}</Badge></span>}
        subtitle={!isNew && `Created ${dateTime(po.created_at)}${po.received_at ? ` · received ${dateTime(po.received_at)}` : ''}`}
        actions={<>
          {!isNew && <Button icon={Printer} onClick={() => window.print()}>Print</Button>}
          {!isNew && ['draft', 'ordered'].includes(po.status) && <Button variant="danger" icon={Trash2} onClick={async () => {
            if (!(await confirm({ title: 'Delete this purchase order?', danger: true, confirmLabel: 'Delete' }))) return;
            await run(() => api.del(`/admin/purchase-orders/${id}`), 'Deleted');
            navigate('/purchase-orders');
          }} />}
          {!locked && <Button loading={busy} onClick={() => save()}>Save</Button>}
          {po.status === 'draft' && !isNew && <Button loading={busy} onClick={() => save('ordered')}>Mark as ordered</Button>}
          {!isNew && ['draft', 'ordered', 'partial'].includes(po.status) && <Button variant="primary" icon={PackageCheck} onClick={() => setReceive({})}>Receive goods</Button>}
        </>}
      />
      <div className="print-area grid gap-4 lg:grid-cols-3">
        <Card title="Products" className="lg:col-span-2" padded={false}>
          {!locked && <div className="border-b border-zinc-200 p-3"><ProductSearch onPick={(p) => setPo({ ...po, items: [...po.items, { product_id: p.id, variation_id: p.variation_id, name: p.name, sku: p.sku, qty: 1, received_qty: 0, cost: p.purchase_price || '' }] })} /></div>}
          <table className="w-full text-left">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr>
              <th className="px-4 py-2 font-medium">Product</th><th className="px-2 py-2 text-right font-medium">Qty</th><th className="px-2 py-2 text-right font-medium">Unit cost</th>
              <th className="px-2 py-2 text-right font-medium">Received</th><th className="px-4 py-2 text-right font-medium">Total</th><th /></tr></thead>
            <tbody>
              {po.items.map((it, i) => (
                <tr key={i} className="border-b border-zinc-100">
                  <td className="px-4 py-2"><div className="max-w-[320px] truncate">{it.name}</div><div className="text-xs text-zinc-500">{it.sku}</div></td>
                  <td className="px-2 py-2 text-right">{locked ? it.qty : <Input type="number" min="1" className="ml-auto h-8 w-20 text-right" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} />}</td>
                  <td className="px-2 py-2 text-right">{locked ? money(it.cost) : <Input type="number" step="0.01" className="ml-auto h-8 w-24 text-right" value={it.cost} onChange={(e) => setItem(i, { cost: e.target.value })} />}</td>
                  <td className="num px-2 py-2 text-right text-zinc-500">{it.received_qty || 0}</td>
                  <td className="num px-4 py-2 text-right">{money(Number(it.qty) * Number(it.cost || 0))}</td>
                  <td className="pr-3">{!locked && <button onClick={() => setPo({ ...po, items: po.items.filter((_, j) => j !== i) })} className="text-zinc-400 hover:text-red-600"><Trash2 size={14} /></button>}</td>
                </tr>
              ))}
              {!po.items.length && <tr><td colSpan={6} className="py-10 text-center text-zinc-400">Search and add the products you are ordering</td></tr>}
            </tbody>
          </table>
          <div className="flex justify-between px-4 py-3 text-base font-semibold"><span>Total</span><span className="num">{money(total)}</span></div>
        </Card>
        <Card title="Details">
          <div className="space-y-3">
            <Field label="Supplier">
              <Select disabled={locked} value={po.supplier_id || ''} onChange={(e) => setPo({ ...po, supplier_id: e.target.value })}>
                <option value="">Choose a supplier…</option>{(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Expected delivery"><Input type="date" disabled={locked} value={po.expected_at || ''} onChange={(e) => setPo({ ...po, expected_at: e.target.value })} /></Field>
            <Field label="Notes"><Textarea rows={3} value={po.notes || ''} onChange={(e) => setPo({ ...po, notes: e.target.value })} /></Field>
          </div>
        </Card>
      </div>
      <Modal open={!!receive} onClose={() => setReceive(null)} title="Receive goods" width={560}
        footer={<><Button onClick={() => setReceive(null)}>Cancel</Button><Button onClick={() => doReceive(false)} loading={busy}>Receive these quantities</Button><Button variant="primary" loading={busy} onClick={() => doReceive(true)}>Receive everything</Button></>}>
        <p className="mb-3 text-[13px] text-zinc-500">Enter what actually arrived. Stock and cost prices are updated right away.</p>
        <div className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
          {po.items.map((it, i) => {
            const left = it.qty - (it.received_qty || 0);
            return (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 truncate">{it.name}</span>
                <Input type="number" min="0" max={left} disabled={!left} placeholder="0" className="h-8 w-20" value={receive?.[i] ?? ''} onChange={(e) => setReceive({ ...receive, [i]: e.target.value })} />
                <span className="w-14 text-xs text-zinc-400">of {left}</span>
              </div>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
