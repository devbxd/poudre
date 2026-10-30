import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PackageCheck, PackagePlus, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { money, dateTime } from '../lib/format.js';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useAction, useToast } from '../components/ui.jsx';
import { ProductSearch } from '../components/pickers.jsx';
import { PO_STATUS } from './PurchaseOrders.jsx';

const lineKey = (it) => `${it.product_id}-${it.variation_id || 0}`;

export default function PurchaseOrderEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { confirm, toast } = useToast();
  const { data, setData } = useFetch(isNew ? null : `/admin/purchase-orders/${id}`);
  const { data: suppliers } = useFetch('/admin/suppliers');
  const [po, setPo] = useState(isNew ? { supplier_id: '', items: [], notes: '', expected_at: '', status: 'draft', meta: { vat_rate: 0, extras: [] } } : null);
  const [receive, setReceive] = useState(null);
  const [run, busy] = useAction();
  // current stock of each line, editable on the spot (saved straight to the product, independent of the order)
  const [stock, setStock] = useState({});
  const [stockEdit, setStockEdit] = useState({});
  const [newItem, setNewItem] = useState(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!data) return;
    const meta = typeof data.meta === 'string' ? JSON.parse(data.meta) : data.meta || {};
    setPo({ ...data, expected_at: data.expected_at?.slice(0, 10) || '', meta: { vat_rate: meta.vat_rate || 0, extras: meta.extras || [] } });
  }, [data]);
  useEffect(() => {
    const ids = [...new Set((po?.items || []).filter((i) => i.product_id && stock[lineKey(i)] === undefined).map((i) => i.product_id))];
    if (!ids.length) return;
    api.post('/pos/stock', { ids }).then((rows) => setStock((s) => ({ ...Object.fromEntries(rows.map((r) => [`${r.id}-${r.variation_id || 0}`, r.stock_quantity])), ...s }))).catch(() => {});
  }, [po?.items?.length]); // eslint-disable-line
  if (!po) return <Spinner />;
  const done = ['received', 'cancelled', 'partial'].includes(po.status);
  const locked = done && !editing;
  const meta = po.meta || { vat_rate: 0, extras: [] };
  const subtotal = po.items.reduce((s, i) => s + Number(i.qty) * Number(i.cost || 0), 0);
  const vat = Math.round(subtotal * (Number(meta.vat_rate) || 0)) / 100;
  const total = subtotal + vat + meta.extras.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const setMeta = (patch) => setPo((cur) => ({ ...cur, meta: { ...(cur.meta || { vat_rate: 0, extras: [] }), ...patch } }));
  const setExtra = (i, patch) => setMeta({ extras: meta.extras.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setItem = (i, patch) => setPo({ ...po, items: po.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const addItem = (p) => {
    const key = `${p.id}-${p.variation_id || 0}`;
    if (p.stock_quantity !== undefined) setStock((s) => ({ ...s, [key]: p.stock_quantity }));
    setPo((cur) => {
      // scanning the same product again adds one more instead of a new line
      if (cur.items.some((x) => lineKey(x) === key)) return { ...cur, items: cur.items.map((x) => (lineKey(x) === key ? { ...x, qty: Number(x.qty) + 1 } : x)) };
      return { ...cur, items: [...cur.items, { product_id: p.id, variation_id: p.variation_id, name: p.name, sku: p.sku, qty: p.qty || 1, received_qty: 0, cost: p.purchase_price || '' }] };
    });
  };
  const saveStock = async (it) => {
    const key = lineKey(it);
    const res = await run(() => api.post('/admin/stock/adjust', { lines: [{ product_id: it.product_id, variation_id: it.variation_id || null, set: Number(stockEdit[key]) }], reason: 'count' }), 'Stock saved');
    if (!res) return;
    setStock((s) => ({ ...s, [key]: res[0]?.quantity_after ?? Number(stockEdit[key]) }));
    setStockEdit(({ [key]: _, ...rest }) => rest);
  };
  const openNewItem = (code = '') => setNewItem({ name: '', sku: code, price: '', cost: '', stock: 0, qty: 1, online: false });
  const createItem = async () => {
    const n = newItem;
    if (!n.name.trim()) { toast('Give the new item a name', 'error'); return; }
    const code = n.sku.trim() || null;
    const created = await run(() => api.post('/admin/products', {
      name: n.name.trim(), type: 'simple', status: 'publish', sku: code, barcode: code,
      regular_price: n.price === '' ? null : Number(n.price), purchase_price: n.cost === '' ? null : Number(n.cost),
      manage_stock: true, stock_quantity: Number(n.stock) || 0, pos_visible: true, online_visible: n.online, supplier_id: po.supplier_id || null,
    }), 'Item created');
    if (!created?.id) return;
    addItem({ id: created.id, variation_id: null, name: created.name, sku: created.sku, purchase_price: n.cost, stock_quantity: Number(n.stock) || 0, qty: Number(n.qty) || 1 });
    setNewItem(null);
  };

  const save = async (status) => {
    const body = { supplier_id: po.supplier_id || null, items: po.items, notes: po.notes, expected_at: po.expected_at || null, status: status || po.status, meta };
    const saved = await run(() => (isNew ? api.post('/admin/purchase-orders', body) : api.put(`/admin/purchase-orders/${id}`, body)), 'Purchase order saved');
    if (isNew) navigate(`/purchase-orders/${saved.id}`, { replace: true }); else { setData(saved); setEditing(false); if (po.status === 'received') setStock({}); }
    return saved;
  };
  // the goods are here: save the order and add every quantity to the stock in one go
  const saveAndReceive = async () => {
    if (!po.items.length) { toast('Add the products first', 'error'); return; }
    const body = { supplier_id: po.supplier_id || null, items: po.items, notes: po.notes, expected_at: po.expected_at || null, status: 'ordered', meta };
    const saved = await run(() => (isNew ? api.post('/admin/purchase-orders', body) : api.put(`/admin/purchase-orders/${id}`, body)));
    const received = await run(() => api.post(`/admin/purchase-orders/${saved.id}/receive`, { all: true }), 'Saved — stock added');
    setStock({});
    if (isNew) navigate(`/purchase-orders/${saved.id}`, { replace: true }); else setData(received);
  };
  const doReceive = async (all) => {
    const body = all ? { all: true } : { lines: Object.entries(receive).map(([index, qty]) => ({ index: Number(index), qty: Number(qty) })) };
    const saved = await run(() => api.post(`/admin/purchase-orders/${id}/receive`, body), 'Stock added');
    setData(saved);
    setReceive(null);
    setStock({});
  };

  return (
    <>
      <PageHeader
        back={<Link to="/purchase-orders" className="mb-1 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} /> Purchase orders</Link>}
        title={isNew ? 'New purchase order' : <span className="flex items-center gap-3">{po.number} <Badge tone={PO_STATUS[po.status]?.tone}>{PO_STATUS[po.status]?.label}</Badge></span>}
        subtitle={!isNew && `Created ${dateTime(po.created_at)}${po.received_at ? ` · received ${dateTime(po.received_at)}` : ''}`}
        actions={<>
          {!isNew && <Button icon={Printer} onClick={() => window.print()}>Print</Button>}
          {done && po.status !== 'cancelled' && !editing && <Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
          {editing && <Button onClick={() => { setEditing(false); setData({ ...data }); }}>Cancel</Button>}
          {editing && <Button variant="primary" loading={busy} onClick={() => save()} title={po.status === 'received' ? 'The stock is corrected to the new quantities' : ''}>Save changes</Button>}
          {!isNew && ['draft', 'ordered'].includes(po.status) && <Button variant="danger" icon={Trash2} onClick={async () => {
            if (!(await confirm({ title: 'Delete this purchase order?', danger: true, confirmLabel: 'Delete' }))) return;
            await run(() => api.del(`/admin/purchase-orders/${id}`), 'Deleted');
            navigate('/purchase-orders');
          }} />}
          {!done && <Button loading={busy} onClick={() => save()} title="Keep it for later: the goods have not arrived yet">Save as draft</Button>}
          {po.status === 'draft' && !isNew && <Button loading={busy} onClick={() => save('ordered')}>Mark as ordered</Button>}
          {!isNew && ['draft', 'ordered', 'partial'].includes(po.status) && <Button icon={PackageCheck} onClick={() => setReceive({})}>Receive part</Button>}
          {['draft', 'ordered'].includes(po.status) && <Button variant="primary" icon={PackageCheck} loading={busy} onClick={saveAndReceive} title="Saves the invoice and adds every quantity to the stock">Save &amp; add to stock</Button>}
        </>}
      />
      <div className="print-area grid gap-4 lg:grid-cols-3">
        <Card title="Products" className="lg:col-span-2" padded={false} actions={!locked && <Button size="sm" icon={PackagePlus} onClick={() => openNewItem()}>New item</Button>}>
          {!locked && (
            <div className="border-b border-zinc-200 p-3">
              <ProductSearch autoFocus optionsOnly placeholder="Scan or search products by name or SKU…" onPick={addItem}
                onNoMatch={(code, clear) => { if (/^[\w-]{4,}$/.test(code) && /\d/.test(code)) { clear(); openNewItem(code); } }} />
            </div>
          )}
          <table className="w-full text-left">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr>
              <th className="px-4 py-2 font-medium">Product</th><th className="px-2 py-2 text-right font-medium">Qty</th><th className="px-2 py-2 text-right font-medium">Unit cost</th>
              <th className="px-2 py-2 text-right font-medium">In stock</th><th className="px-2 py-2 text-right font-medium">Received</th><th className="px-4 py-2 text-right font-medium">Total</th><th /></tr></thead>
            <tbody>
              {po.items.map((it, i) => {
                const key = lineKey(it);
                const edited = stockEdit[key] !== undefined && String(stockEdit[key]) !== String(stock[key] ?? '');
                return (
                  <tr key={i} className="border-b border-zinc-100">
                    <td className="px-4 py-2"><div className="max-w-[320px] truncate">{it.name}</div><div className="text-xs text-zinc-500">{it.sku}</div></td>
                    <td className="px-2 py-2 text-right">{locked ? it.qty : <Input type="number" min="1" className="ml-auto h-8 w-20 text-right" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} />}</td>
                    <td className="px-2 py-2 text-right">{locked ? money(it.cost) : <Input type="number" step="0.01" className="ml-auto h-8 w-24 text-right" value={it.cost} onChange={(e) => setItem(i, { cost: e.target.value })} />}</td>
                    <td className="px-2 py-2 text-right">
                      {it.product_id && (
                        <div className="flex items-center justify-end gap-1">
                          <Input type="number" className="h-8 w-20 text-right" value={stockEdit[key] ?? stock[key] ?? ''} placeholder="—" title="Current stock: change it, then Save"
                            onChange={(e) => setStockEdit({ ...stockEdit, [key]: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter' && edited) saveStock(it); }} />
                          {edited && <Button size="sm" variant="primary" loading={busy} onClick={() => saveStock(it)}>Save</Button>}
                        </div>
                      )}
                    </td>
                    <td className="num px-2 py-2 text-right text-zinc-500">{it.received_qty || 0}</td>
                    <td className="num px-4 py-2 text-right">{money(Number(it.qty) * Number(it.cost || 0))}</td>
                    <td className="pr-3">{!locked && <button onClick={() => setPo({ ...po, items: po.items.filter((_, j) => j !== i) })} className="text-zinc-400 hover:text-red-600"><Trash2 size={14} /></button>}</td>
                  </tr>
                );
              })}
              {!po.items.length && <tr><td colSpan={7} className="py-10 text-center text-zinc-400">Scan or search the products you are ordering</td></tr>}
            </tbody>
          </table>
          <div className="space-y-2 px-4 py-3 text-[13px]">
            <div className="flex justify-between text-zinc-600"><span>Products</span><span className="num">{money(subtotal)}</span></div>
            <div className="flex items-center justify-between gap-3 text-zinc-600">
              <span className="flex items-center gap-2">VAT {locked ? `${meta.vat_rate || 0}%` : <><Input type="number" min="0" step="0.01" className="h-8 w-20 text-right" value={meta.vat_rate || ''} placeholder="0" onChange={(e) => setMeta({ vat_rate: e.target.value })} /> %</>}</span>
              <span className="num">{money(vat)}</span>
            </div>
            {meta.extras.map((x, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-zinc-600">
                {locked ? <span>{x.label}</span> : <Input className="h-8 flex-1" value={x.label} placeholder="Description (delivery, tips…)" onChange={(e) => setExtra(i, { label: e.target.value })} />}
                <span className="flex items-center gap-2">
                  {locked ? <span className="num">{money(x.amount)}</span> : <Input type="number" step="0.01" className="h-8 w-24 text-right" value={x.amount} placeholder="0.00" onChange={(e) => setExtra(i, { amount: e.target.value })} />}
                  {!locked && <button onClick={() => setMeta({ extras: meta.extras.filter((_, j) => j !== i) })} className="text-zinc-400 hover:text-red-600"><Trash2 size={14} /></button>}
                </span>
              </div>
            ))}
            {!locked && <Button size="sm" icon={Plus} onClick={() => setMeta({ extras: [...meta.extras, { label: '', amount: '' }] })}>Add other</Button>}
          </div>
          <div className="flex justify-between border-t border-zinc-200 px-4 py-3 text-base font-semibold"><span>Total</span><span className="num">{money(total)}</span></div>
          {['draft', 'ordered'].includes(po.status) && po.items.length > 0 && (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-800"><b>Save &amp; add to stock</b> saves the invoice and adds the stock in one click. Use <b>Save as draft</b> only if the goods have not arrived yet.</div>
          )}
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
      <Modal open={!!newItem} onClose={() => setNewItem(null)} title="New item" width={520}
        footer={<><Button onClick={() => setNewItem(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={createItem}>Create and add to the order</Button></>}>
        {newItem && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2"><Input autoFocus value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} /></Field>
            <Field label="SKU / barcode" className="sm:col-span-2"><Input value={newItem.sku} placeholder="Scan the barcode" onChange={(e) => setNewItem({ ...newItem, sku: e.target.value })} /></Field>
            <Field label="Selling price ($)"><Input type="number" step="0.01" value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} /></Field>
            <Field label="Unit cost ($)"><Input type="number" step="0.01" value={newItem.cost} onChange={(e) => setNewItem({ ...newItem, cost: e.target.value })} /></Field>
            <Field label="Quantity ordered"><Input type="number" min="1" value={newItem.qty} onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })} /></Field>
            <Field label="Current stock"><Input type="number" value={newItem.stock} onChange={(e) => setNewItem({ ...newItem, stock: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" checked={newItem.online} onChange={(e) => setNewItem({ ...newItem, online: e.target.checked })} /> Show on the website (add photos later in Products)</label>
            <p className="text-xs text-zinc-500 sm:col-span-2">The item is created in Products and shows in the POS right away. Photos, category and brand can be added later.</p>
          </div>
        )}
      </Modal>
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
