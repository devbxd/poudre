import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { qs } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { money, int, date } from '../lib/format.js';
import { Button, Card, Input, PageHeader, Select, Spinner, Table, Tabs, cx } from '../components/ui.jsx';
import { RANGES } from './Overview.jsx';

const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Beirut' });
/** Period: the usual ranges, or "Custom dates" with a from / to date */
function usePeriod(initial = '30d') {
  const [range, setRange] = useState(initial);
  const [custom, setCustom] = useState({ from: todayStr().slice(0, 8) + '01', to: todayStr() });
  const r = RANGES.find((x) => x.value === range);
  const from = range === 'custom' ? custom.from : r.from();
  const to = range === 'custom' ? custom.to : r.to();
  const picker = (
    <>
      <Select value={range} onChange={(e) => setRange(e.target.value)} className="w-40">
        {RANGES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        <option value="custom">Custom dates…</option>
      </Select>
      {range === 'custom' && (
        <span className="flex items-center gap-1.5 text-[13px] text-zinc-600">
          <Input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} className="w-40" />
          to
          <Input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} className="w-40" />
        </span>
      )}
    </>
  );
  return { from, to, picker };
}

const GROUPS = [
  { value: 'variation', label: 'Each item (colour / size)' }, { value: 'product', label: 'Products (all colours together)' }, { value: 'brand', label: 'Brands' }, { value: 'category', label: 'Categories' },
  { value: 'supplier', label: 'Suppliers' }, { value: 'customer', label: 'Customers' }, { value: 'staff', label: 'Cashiers' }, { value: 'payment', label: 'Payment methods' },
  { value: 'day', label: 'Day by day' }, { value: 'month', label: 'Month by month' }, { value: 'hour', label: 'Hour of the day' },
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
        { key: 'name', label: 'Product', render: (r) => <a href={`/dashboard/products/${r.id}`} className="hover:underline">{r.name}</a> },
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

/** Supplier invoices received in the period: products, VAT, other charges, by supplier and one by one */
function Purchases() {
  const period = usePeriod();
  const params = qs({ from: period.from, to: period.to });
  const { data } = useFetch(`/admin/reports/purchases${params}`);
  const sum = (k) => (data || []).reduce((t, x) => t + (x[k] || 0), 0);
  const bySupplier = Object.values((data || []).reduce((m, x) => {
    const k = x.supplier || '—';
    m[k] ??= { supplier: k, invoices: 0, units: 0, products: 0, vat: 0, other: 0, total: 0 };
    for (const f of ['units', 'products', 'vat', 'other', 'total']) m[k][f] += x[f] || 0;
    m[k].invoices++;
    return m;
  }, {})).sort((a, b) => b.total - a.total);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3">
        {period.picker}
        <Button icon={Download} className="ml-auto" onClick={() => { window.location.href = `/api/admin/reports/purchases/export${params}`; }}>Export CSV</Button>
      </div>
      {!data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 border-b border-zinc-200 text-center sm:grid-cols-5">
            {[['Invoices', int(data.length)], ['Products', money(sum('products'))], ['VAT paid', money(sum('vat'))], ['Other charges', money(sum('other'))], ['Total bought', money(sum('total'))]].map(([k, v]) => (
              <div key={k} className="border-b border-r border-zinc-200 py-3 sm:border-b-0"><div className="text-xs text-zinc-500">{k}</div><div className="num font-semibold">{v}</div></div>
            ))}
          </div>
          <h3 className="px-4 pb-1 pt-4 font-medium">By supplier</h3>
          <Table dense rows={bySupplier} rowKey="supplier" columns={[
            { key: 'supplier', label: 'Supplier' },
            { key: 'invoices', label: 'Invoices', align: 'right', render: (x) => int(x.invoices) },
            { key: 'units', label: 'Units', align: 'right', render: (x) => int(x.units) },
            { key: 'products', label: 'Products', align: 'right', render: (x) => money(x.products) },
            { key: 'vat', label: 'VAT', align: 'right', render: (x) => money(x.vat) },
            { key: 'other', label: 'Other', align: 'right', render: (x) => money(x.other) },
            { key: 'total', label: 'Total', align: 'right', render: (x) => <span className="font-medium">{money(x.total)}</span> },
          ]} />
          <h3 className="px-4 pb-1 pt-5 font-medium">Invoices</h3>
          <Table dense rows={data} rowKey="id" columns={[
            { key: 'number', label: 'Number', render: (x) => <Link to={`/purchase-orders/${x.id}`} className="font-medium hover:underline">{x.number}</Link> },
            { key: 'date', label: 'Received', render: (x) => date(x.date) },
            { key: 'supplier', label: 'Supplier', render: (x) => x.supplier || '—' },
            { key: 'notes', label: 'Invoice / notes', render: (x) => <span className="block max-w-[180px] truncate text-zinc-500">{x.notes}</span> },
            { key: 'products', label: 'Products', align: 'right', render: (x) => money(x.products) },
            { key: 'vat', label: 'VAT', align: 'right', render: (x) => (x.vat ? `${money(x.vat)} (${x.vat_rate}%)` : '—') },
            { key: 'other', label: 'Other', align: 'right', render: (x) => (x.other ? <span title={x.other_details}>{money(x.other)}</span> : '—') },
            { key: 'total', label: 'Total', align: 'right', render: (x) => <span className="font-medium">{money(x.total)}</span> },
          ]} />
          <p className="p-3 text-xs text-zinc-400">Received purchase orders only (drafts are not counted). Dates are the day the goods were received.</p>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Sales: three simple steps (when, show, filter)
const Pill = ({ active, onClick, children }) => (
  <button type="button" onClick={onClick}
    className={cx('rounded-full border px-3.5 py-1.5 text-sm font-medium transition', active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-800 hover:border-zinc-900')}>
    {children}
  </button>
);
const Step = ({ label, children }) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="w-20 shrink-0 text-[13px] font-semibold text-zinc-500">{label}</span>
    {children}
  </div>
);
const QUICK_RANGES = ['today', '7d', '30d', 'month', 'year'];
const MAIN_VIEWS = ['variation', 'product', 'brand', 'category', 'day'];
const VIEW_LABELS = { variation: 'Each item', product: 'Products', brand: 'Brands', category: 'Categories', day: 'Day by day' };

function Sales() {
  const [group, setGroup] = useState('variation');
  const [range, setRange] = useState('30d');
  const [custom, setCustom] = useState({ from: todayStr().slice(0, 8) + '01', to: todayStr() });
  const [channel, setChannel] = useState('');
  const [brand, setBrand] = useState(null); // { id, name }
  const [brandText, setBrandText] = useState('');
  const [category, setCategory] = useState('');
  const [find, setFind] = useState('');
  const { data: brands } = useFetch('/admin/brands');
  const { data: cats } = useFetch('/admin/categories');
  const r = RANGES.find((x) => x.value === range);
  const from = range === 'custom' ? custom.from : r.from();
  const to = range === 'custom' ? custom.to : r.to();
  const params = qs({ group, from, to, channel, brand: brand?.id || '', category });
  const { data, loading } = useFetch(`/admin/reports/sales${params}`);
  const rows = (data || []).filter((x) => !find.trim() || String(x.label || '').toLowerCase().includes(find.trim().toLowerCase()));
  const totals = rows.reduce((s, x) => ({ qty: s.qty + (x.qty || 0), revenue: s.revenue + (x.revenue || 0), profit: s.profit + (x.profit || 0) }), { qty: 0, revenue: 0, profit: 0 });
  const sortedBrands = [...(brands || [])].sort((a, b) => a.name.localeCompare(b.name));
  const pickBrand = (text) => {
    setBrandText(text);
    const b = sortedBrands.find((x) => x.name.toLowerCase() === text.trim().toLowerCase());
    if (b) { setBrand(b); setBrandText(''); }
  };
  const catName = (cats || []).find((c) => String(c.id) === String(category))?.name;
  const itemView = group === 'variation' || group === 'product';
  const channels = [['', 'Shop + website'], ['pos', 'Shop only'], ['online', 'Website only']];

  return (
    <>
      <div className="space-y-3 border-b border-zinc-200 p-4">
        <Step label="1. When">
          {QUICK_RANGES.map((v) => <Pill key={v} active={range === v} onClick={() => setRange(v)}>{RANGES.find((x) => x.value === v).label}</Pill>)}
          <Pill active={range === 'custom'} onClick={() => setRange('custom')}>Choose dates…</Pill>
          {range === 'custom' && (
            <span className="flex items-center gap-1.5 text-[13px] text-zinc-600">
              <Input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} className="w-40" />
              to
              <Input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} className="w-40" />
            </span>
          )}
        </Step>
        <Step label="2. Show">
          {MAIN_VIEWS.map((v) => <Pill key={v} active={group === v} onClick={() => setGroup(v)}>{VIEW_LABELS[v]}</Pill>)}
          <Select value={MAIN_VIEWS.includes(group) ? '' : group} onChange={(e) => e.target.value && setGroup(e.target.value)} className="h-9 w-44">
            <option value="">More…</option>
            {GROUPS.filter((g) => !MAIN_VIEWS.includes(g.value)).map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </Select>
        </Step>
        <Step label="3. Filter">
          {brand
            ? <Pill active onClick={() => setBrand(null)}>Brand: {brand.name} ✕</Pill>
            : (
              <>
                <Input list="report-brands" value={brandText} onChange={(e) => pickBrand(e.target.value)} placeholder="Type a brand…" className="w-52" />
                <datalist id="report-brands">{sortedBrands.map((b) => <option key={b.id} value={b.name} />)}</datalist>
              </>
            )}
          {category
            ? <Pill active onClick={() => setCategory('')}>Category: {catName} ✕</Pill>
            : (
              <Select value="" onChange={(e) => setCategory(e.target.value)} className="h-9 w-48">
                <option value="">Any category</option>
                {(cats || []).filter((c) => !c.parent_id).flatMap((p) => [p, ...(cats || []).filter((c) => c.parent_id === p.id)]).map((c) => <option key={c.id} value={c.id}>{c.parent_id ? `— ${c.name}` : c.name}</option>)}
              </Select>
            )}
          <span className="mx-1 h-6 w-px bg-zinc-200" />
          {channels.map(([v, l]) => <Pill key={v} active={channel === v} onClick={() => setChannel(v)}>{l}</Pill>)}
        </Step>
      </div>

      {data && (
        <div className="grid grid-cols-3 border-b border-zinc-200 text-center">
          {[['Pieces sold', int(totals.qty)], ['Sales', money(totals.revenue)], ['Profit *', money(totals.profit)]].map(([k, v]) => (
            <div key={k} className="border-r border-zinc-200 py-4 last:border-0"><div className="text-[13px] text-zinc-500">{k}</div><div className="num text-2xl font-semibold">{v}</div></div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2">
        <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in the list…" className="w-64" />
        <span className="text-[13px] text-zinc-500">{data ? `${rows.length} line${rows.length === 1 ? '' : 's'}` : ''}</span>
        <Button icon={Download} className="ml-auto" onClick={() => { window.location.href = `/api/admin/reports/sales/export${params}`; }}>Download (Excel)</Button>
      </div>
      {!data ? <Spinner /> : (
        <div className={loading ? 'opacity-60' : ''}>
          <Table dense rows={rows.map((x, i) => ({ ...x, _k: `${x.id}-${i}` }))} rowKey="_k" columns={[
            { key: 'label', label: itemView ? 'Item' : VIEW_LABELS[group] || GROUPS.find((g) => g.value === group).label, render: (x) => <span className="block max-w-[420px] truncate">{x.label || '—'}</span> },
            { key: 'qty', label: 'Sold', align: 'right', render: (x) => <span className="font-medium">{int(x.qty)}</span> },
            ...(itemView ? [{ key: 'stock', label: 'In stock', align: 'right', render: (x) => (x.stock == null ? '—' : <span className={x.stock <= 0 ? 'font-medium text-red-600' : ''}>{int(x.stock)}</span>) }] : []),
            { key: 'revenue', label: 'Sales', align: 'right', render: (x) => money(x.revenue) },
            { key: 'profit', label: 'Profit *', align: 'right', render: (x) => (x.profit != null ? money(x.profit) : '—') },
            { key: 'discounts', label: 'Discounts', align: 'right', mobile: false, render: (x) => (x.discounts ? money(x.discounts) : '—') },
          ]} />
        </div>
      )}
      <p className="p-3 text-xs text-zinc-400">Sold = number of pieces sold in the period. In stock = on the shelf now. * Profit only for products that have a cost price. With a brand or category chosen, all its items are listed, also those not sold.</p>
    </>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('sales');
  return (
    <>
      <PageHeader title="Reports" />
      <Card padded={false}>
        <Tabs className="px-2" value={tab} onChange={setTab} tabs={[{ value: 'sales', label: 'Sales' }, { value: 'day', label: 'End of day' }, { value: 'purchases', label: 'Purchases' }, { value: 'dead', label: 'Slow movers' }]} />
        {tab === 'sales' && <Sales />}
        {tab === 'day' && <DayReport />}
        {tab === 'purchases' && <Purchases />}
        {tab === 'dead' && <DeadStock />}
      </Card>
    </>
  );
}
