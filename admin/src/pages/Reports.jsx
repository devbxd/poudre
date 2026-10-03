import { useState } from 'react';
import { Download } from 'lucide-react';
import { qs } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { money, int, date } from '../lib/format.js';
import { Button, Card, Input, PageHeader, Select, Spinner, Table, Tabs } from '../components/ui.jsx';
import { RANGES } from './Overview.jsx';

const GROUPS = [
  { value: 'product', label: 'Products' }, { value: 'variation', label: 'Product options' }, { value: 'category', label: 'Categories' }, { value: 'brand', label: 'Brands' },
  { value: 'supplier', label: 'Suppliers' }, { value: 'customer', label: 'Customers' }, { value: 'staff', label: 'Cashiers' }, { value: 'payment', label: 'Payment methods' },
  { value: 'day', label: 'By day' }, { value: 'month', label: 'By month' }, { value: 'hour', label: 'By hour' },
];

function DeadStock() {
  const [days, setDays] = useState(90);
  const { data } = useFetch(`/admin/reports/dead-stock?days=${days}`);
  const total = (data || []).reduce((s, r) => s + (r.value || 0), 0);
  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-200 p-3">
        <span className="text-zinc-600">In stock but not sold for</span>
        <Select value={days} onChange={(e) => setDays(e.target.value)} className="w-32"><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option><option value={180}>6 months</option><option value={365}>1 year</option></Select>
        {data && <span className="ml-auto text-zinc-600">{data.length} products · {money(total)} at cost</span>}
      </div>
      {!data ? <Spinner /> : <Table dense rows={data} columns={[
        { key: 'name', label: 'Product', render: (r) => <a href={`/admin/products/${r.id}`} className="hover:underline">{r.name}</a> },
        { key: 'stock_quantity', label: 'In stock', align: 'right' },
        { key: 'value', label: 'Value at cost', align: 'right', render: (r) => money(r.value) },
        { key: 'last_sold', label: 'Last sold', align: 'right', render: (r) => (r.last_sold ? date(r.last_sold) : 'Never') },
      ]} />}
    </>
  );
}

function DayReport() {
  const [day, setDay] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Beirut' }));
  const { data } = useFetch(`/admin/reports/day?date=${day}`);
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-2 print:hidden">
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      {!data ? <Spinner /> : (
        <div className="print-area max-w-2xl space-y-5">
          <h2 className="text-lg font-semibold">End of day — {date(data.day)}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Orders', int(data.summary.orders)], ['Gross sales', money(data.summary.gross)], ['Refunds', money(data.summary.refunds)], ['Net sales', money(data.summary.net)]].map(([k, v]) => (
              <div key={k} className="rounded-md border border-zinc-200 p-3"><div className="text-xs text-zinc-500">{k}</div><div className="num text-lg font-semibold">{v}</div></div>
            ))}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div><h3 className="mb-2 font-medium">By payment</h3>{data.byPayment.map((p) => <div key={p.method} className="flex justify-between border-b border-zinc-100 py-1"><span>{p.method} ({p.orders})</span><span className="num">{money(p.total)}</span></div>)}</div>
            <div><h3 className="mb-2 font-medium">By cashier</h3>{data.byStaff.map((p) => <div key={p.name} className="flex justify-between border-b border-zinc-100 py-1"><span>{p.name} ({p.orders})</span><span className="num">{money(p.total)}</span></div>)}</div>
          </div>
          <div><h3 className="mb-2 font-medium">Items sold</h3>{data.items.map((p, i) => <div key={i} className="flex justify-between border-b border-zinc-100 py-1"><span className="truncate pr-4">{p.qty} × {p.name}</span><span className="num">{money(p.total)}</span></div>)}</div>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('sales');
  const [group, setGroup] = useState('product');
  const [range, setRange] = useState('30d');
  const [channel, setChannel] = useState('');
  const r = RANGES.find((x) => x.value === range);
  const params = qs({ group, from: r.from(), to: r.to(), channel });
  const { data, loading } = useFetch(tab === 'sales' ? `/admin/reports/sales${params}` : null);
  const totals = (data || []).reduce((s, x) => ({ qty: s.qty + (x.qty || 0), revenue: s.revenue + (x.revenue || 0), profit: s.profit + (x.profit || 0) }), { qty: 0, revenue: 0, profit: 0 });
  return (
    <>
      <PageHeader title="Reports" />
      <Card padded={false}>
        <Tabs className="px-2" value={tab} onChange={setTab} tabs={[{ value: 'sales', label: 'Sales' }, { value: 'day', label: 'End of day' }, { value: 'dead', label: 'Slow movers' }]} />
        {tab === 'day' && <DayReport />}
        {tab === 'dead' && <DeadStock />}
        {tab === 'sales' && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3">
              <Select value={group} onChange={(e) => setGroup(e.target.value)} className="w-48">{GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</Select>
              <Select value={range} onChange={(e) => setRange(e.target.value)} className="w-40">{RANGES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select>
              <Select value={channel} onChange={(e) => setChannel(e.target.value)} className="w-36"><option value="">All channels</option><option value="pos">In store</option><option value="online">Website</option></Select>
              <Button icon={Download} className="ml-auto" onClick={() => { window.location.href = `/api/admin/reports/sales/export${params}`; }}>Export CSV</Button>
            </div>
            {data && (
              <div className="grid grid-cols-3 border-b border-zinc-200 text-center">
                {[['Units', int(totals.qty)], ['Revenue', money(totals.revenue)], ['Gross profit*', money(totals.profit)]].map(([k, v]) => (
                  <div key={k} className="border-r border-zinc-200 py-3 last:border-0"><div className="text-xs text-zinc-500">{k}</div><div className="num font-semibold">{v}</div></div>
                ))}
              </div>
            )}
            {!data ? <Spinner /> : (
              <div className={loading ? 'opacity-60' : ''}>
                <Table dense rows={data.map((x, i) => ({ ...x, _k: `${x.id}-${i}` }))} rowKey="_k" columns={[
                  { key: 'label', label: GROUPS.find((g) => g.value === group).label, render: (x) => <span className="block max-w-[380px] truncate">{x.label || '—'}</span> },
                  { key: 'orders', label: 'Orders', align: 'right', render: (x) => int(x.orders) },
                  { key: 'qty', label: 'Units', align: 'right', render: (x) => int(x.qty) },
                  { key: 'discounts', label: 'Discounts', align: 'right', render: (x) => money(x.discounts) },
                  { key: 'revenue', label: 'Revenue', align: 'right', render: (x) => <span className="font-medium">{money(x.revenue)}</span> },
                  { key: 'profit', label: 'Profit*', align: 'right', render: (x) => (x.profit != null ? money(x.profit) : '—') },
                  { key: 'margin', label: 'Margin', align: 'right', render: (x) => (x.profit != null && x.cost ? `${((x.profit / (x.profit + x.cost)) * 100).toFixed(0)}%` : '—') },
                ]} />
              </div>
            )}
            <p className="p-3 text-xs text-zinc-400">* Profit only counts sales of products that have a cost price.</p>
          </>
        )}
      </Card>
    </>
  );
}
