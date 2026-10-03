import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Save, ClipboardList } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useFetch, useFilters } from '../lib/hooks.js';
import { money, int, dateTime } from '../lib/format.js';
import { Button, Card, Input, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Tabs, Thumb, cx, useAction } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';

const REASONS = { adjustment: 'Correction', count: 'Stock count', damage: 'Damaged / expired', return: 'Customer return', purchase: 'Received from supplier' };

function StockList({ f, setF }) {
  const { can } = useAuth();
  const { data, loading, reload } = useFetch(`/admin/stock${qs({ q: f.q, filter: f.filter, supplier: f.supplier, sort: f.sort, page: f.page, per_page: 100 })}`);
  const { data: suppliers } = useFetch('/admin/suppliers');
  const [edits, setEdits] = useState({});
  const [reason, setReason] = useState('count');
  const [run, busy] = useAction();
  const key = (r) => `${r.product_id}-${r.variation_id || 0}`;
  const changed = Object.keys(edits).length;

  const save = async () => {
    const lines = Object.entries(edits).map(([k, v]) => {
      const [product_id, variation_id] = k.split('-').map(Number);
      return { product_id, variation_id: variation_id || null, set: Number(v) };
    });
    await run(() => api.post('/admin/stock/adjust', { lines, reason }), `${lines.length} stock levels saved`);
    setEdits({});
    reload();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3">
        <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Name or SKU — scan a barcode here" className="w-full sm:w-72" autoFocus />
        <Select value={f.supplier || ''} onChange={(e) => setF({ supplier: e.target.value })} className="w-44">
          <option value="">All suppliers</option>{(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select value={f.sort || ''} onChange={(e) => setF({ sort: e.target.value })} className="w-44">
          <option value="">Name A–Z</option><option value="qty">Lowest stock first</option><option value="-sold">Best sellers (30 days)</option>
        </Select>
        {can('manager') && <Button icon={Download} className="ml-auto" onClick={() => { window.location.href = '/api/admin/stock/export'; }}>Export</Button>}
      </div>
      {changed > 0 && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2">
          <span className="font-medium">{changed} change{changed > 1 ? 's' : ''} not saved</span>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 w-48">
            {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Button size="sm" variant="primary" icon={Save} loading={busy} onClick={save}>Save changes</Button>
          <Button size="sm" variant="ghost" onClick={() => setEdits({})}>Discard</Button>
        </div>
      )}
      {!data ? <Spinner /> : (
        <div className={loading ? 'opacity-60' : ''}>
          <Table rowKey="_key" dense
            columns={[
              { key: 'name', label: 'Product', render: (r) => (
                <Link to={`/products/${r.product_id}`} className="flex items-center gap-3 hover:underline">
                  <Thumb src={r.image} size={32} />
                  <div className="min-w-0 max-w-[360px]"><div className="truncate">{r.name}</div><div className="text-xs text-zinc-500">{r.sku || 'No SKU'}{r.supplier_name && ` · ${r.supplier_name}`}</div></div>
                </Link>
              ) },
              { key: 'sold_30d', label: 'Sold 30d', align: 'right', render: (r) => r.sold_30d || <span className="text-zinc-300">0</span> },
              { key: 'cost', label: 'Cost', align: 'right', render: (r) => (r.cost != null ? money(r.cost) : <span className="text-zinc-300">—</span>) },
              { key: 'price', label: 'Price', align: 'right', render: (r) => money(r.price) },
              { key: 'qty', label: 'In stock', align: 'right', width: 120, render: (r) => {
                const k = key(r);
                const v = edits[k] ?? (r.manage_stock ? r.stock_quantity : '');
                const low = r.manage_stock && r.stock_quantity <= (r.low_stock_amount ?? 3);
                return can('manager') ? (
                  <Input type="number" value={v} placeholder={r.manage_stock ? '' : 'untracked'}
                    className={cx('ml-auto h-8 w-24 text-right', edits[k] !== undefined && 'border-amber-400 bg-amber-50', !edits[k] && low && 'text-red-600')}
                    onChange={(e) => setEdits((x) => {
                      const n = { ...x };
                      if (e.target.value === '' || Number(e.target.value) === r.stock_quantity) delete n[k]; else n[k] = e.target.value;
                      return n;
                    })} />
                ) : <span className={low ? 'text-red-600' : ''}>{r.manage_stock ? r.stock_quantity : '—'}</span>;
              } },
            ]}
            rows={data.items.map((r) => ({ ...r, _key: key(r) }))}
          />
          <Pagination page={data.page} perPage={data.per_page} total={data.total} onChange={(page) => setF({ page: String(page) })} />
        </div>
      )}
    </>
  );
}

function Reorder() {
  const { data } = useFetch('/admin/stock/reorder?days=30');
  const navigate = useNavigate();
  const [run, busy] = useAction();
  if (!data) return <Spinner />;
  const groups = data.reduce((m, r) => { const k = r.supplier_id || 0; (m[k] ||= { name: r.supplier_name || 'No supplier', id: r.supplier_id, rows: [] }).rows.push(r); return m; }, {});
  const createPo = async (g) => {
    const po = await run(() => api.post('/admin/purchase-orders', {
      supplier_id: g.id, items: g.rows.map((r) => ({ product_id: r.product_id, variation_id: r.variation_id, name: r.name, sku: r.sku, qty: Math.max(1, r.suggested), cost: r.cost || 0 })),
    }), 'Draft purchase order created');
    navigate(`/purchase-orders/${po.id}`);
  };
  return (
    <div className="space-y-4 p-4">
      <p className="text-zinc-500">Products that sold in the last 30 days and will run out within about 2 weeks. The suggested quantity covers the next month of sales.</p>
      {Object.values(groups).map((g) => (
        <div key={g.name} className="rounded-md border border-zinc-200">
          <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2">
            <span className="font-medium">{g.name} <span className="font-normal text-zinc-500">· {g.rows.length} products</span></span>
            <Button size="sm" icon={ClipboardList} loading={busy} onClick={() => createPo(g)}>Create purchase order</Button>
          </div>
          <Table dense rows={g.rows.map((r) => ({ ...r, _key: `${r.product_id}-${r.variation_id}` }))} rowKey="_key" columns={[
            { key: 'name', label: 'Product', render: (r) => <Link to={`/products/${r.product_id}`} className="hover:underline">{r.name}</Link> },
            { key: 'sold', label: 'Sold 30d', align: 'right' },
            { key: 'stock_quantity', label: 'In stock', align: 'right', render: (r) => <span className={r.stock_quantity <= 0 ? 'text-red-600' : ''}>{r.stock_quantity ?? 0}</span> },
            { key: 'suggested', label: 'Suggested', align: 'right', render: (r) => <span className="font-medium">{r.suggested}</span> },
          ]} />
        </div>
      ))}
      {!data.length && <p className="py-8 text-center text-zinc-400">Nothing urgent to reorder</p>}
    </div>
  );
}

function Movements() {
  const [page, setPage] = useState(1);
  const [reason, setReason] = useState('');
  const { data } = useFetch(`/admin/stock/movements${qs({ page, reason, per_page: 50 })}`);
  return (
    <>
      <div className="border-b border-zinc-200 p-3">
        <Select value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }} className="w-52">
          <option value="">All movements</option><option value="sale">Sales</option><option value="refund">Refunds</option><option value="cancel">Cancelled orders</option>
          <option value="purchase">Received from suppliers</option><option value="adjustment">Corrections</option><option value="count">Stock counts</option><option value="damage">Damaged</option>
        </Select>
      </div>
      {!data ? <Spinner /> : (
        <>
          <Table dense rows={data.items} columns={[
            { key: 'created_at', label: 'Date', render: (m) => <span className="whitespace-nowrap text-zinc-600">{dateTime(m.created_at)}</span> },
            { key: 'product_name', label: 'Product', render: (m) => <Link to={`/products/${m.product_id}`} className="hover:underline">{m.product_name || `#${m.product_id}`}</Link> },
            { key: 'reason', label: 'Reason', render: (m) => <span className="capitalize">{m.reason}{m.ref_type === 'order' && m.ref_id ? <Link to={`/orders/${m.ref_id}`} className="ml-1 text-zinc-500 hover:underline">#{m.ref_id}</Link> : ''}{m.ref_type === 'purchase_order' ? <Link to={`/purchase-orders/${m.ref_id}`} className="ml-1 text-zinc-500 hover:underline">PO-{m.ref_id}</Link> : ''}</span> },
            { key: 'staff_name', label: 'By', render: (m) => m.staff_name || '—' },
            { key: 'change', label: 'Change', align: 'right', render: (m) => <span className={m.change > 0 ? 'text-emerald-700' : ''}>{m.change > 0 ? '+' : ''}{m.change}</span> },
            { key: 'quantity_after', label: 'After', align: 'right' },
          ]} />
          <div className="flex justify-end gap-2 p-3">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" disabled={data.items.length < 50} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </>
      )}
    </>
  );
}

export default function Stock() {
  const [f, setF] = useFilters({ page: '1', tab: 'stock' });
  const { can } = useAuth();
  const { data: s } = useFetch('/admin/stock/summary');
  return (
    <>
      <PageHeader title="Stock" subtitle="Type new quantities directly in the list, then save. Every change is logged." />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ['Units in stock', int(s.units)],
            can('manager') && ['Stock value (cost)', money(s.value_cost), s.missing_cost ? `${int(s.missing_cost)} items without cost` : null],
            ['Stock value (retail)', money(s.value_retail)],
            ['Running low', int(s.low_stock), null, 'low'],
            ['Out of stock', int(s.out_of_stock), s.negative ? `${s.negative} negative` : null, 'out'],
          ].filter(Boolean).map(([label, value, sub, filter]) => (
            <button key={label} disabled={!filter} onClick={() => setF({ tab: 'stock', filter })} className="rounded-lg border border-zinc-200 bg-white p-4 text-left enabled:hover:border-zinc-300">
              <div className="text-[13px] text-zinc-500">{label}</div>
              <div className="num mt-1 text-xl font-semibold">{value}</div>
              {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
            </button>
          ))}
        </div>
      )}
      <Card padded={false}>
        <Tabs className="px-2" value={f.tab === 'stock' ? (f.filter || 'all') : f.tab} onChange={(v) => (['reorder', 'movements'].includes(v) ? setF({ tab: v, filter: '' }) : setF({ tab: 'stock', filter: v === 'all' ? '' : v }))}
          tabs={[
            { value: 'all', label: 'All' }, { value: 'low', label: 'Running low' }, { value: 'out', label: 'Out of stock' }, { value: 'negative', label: 'Negative' }, { value: 'untracked', label: 'Not tracked' },
            ...(can('manager') ? [{ value: 'reorder', label: 'What to reorder' }] : []), { value: 'movements', label: 'History' },
          ]} />
        {f.tab === 'reorder' ? <Reorder /> : f.tab === 'movements' ? <Movements /> : <StockList f={f} setF={setF} />}
      </Card>
    </>
  );
}
