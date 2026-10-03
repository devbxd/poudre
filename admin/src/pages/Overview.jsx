import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, PackageX, ShoppingBag } from 'lucide-react';
import { useFetch } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { money, int, change, daysAgo, today, date, ago, fullName, ORDER_STATUS, CHANNEL } from '../lib/format.js';
import { Badge, Card, PageHeader, Select, Spinner, Thumb, cx } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';

export const RANGES = [
  { value: 'today', label: 'Today', from: () => today(), to: () => today() },
  { value: '7d', label: 'Last 7 days', from: () => daysAgo(6), to: () => today() },
  { value: '30d', label: 'Last 30 days', from: () => daysAgo(29), to: () => today() },
  { value: '90d', label: 'Last 90 days', from: () => daysAgo(89), to: () => today() },
  { value: 'month', label: 'This month', from: () => today().slice(0, 8) + '01', to: () => today() },
  { value: 'year', label: 'This year', from: () => today().slice(0, 5) + '01-01', to: () => today() },
  { value: '365d', label: 'Last 12 months', from: () => daysAgo(364), to: () => today() },
];

function Delta({ cur, prev, money: isMoney }) {
  if (!prev && !cur) return null;
  const d = change(cur, prev);
  const up = d >= 0;
  return (
    <span className={cx('inline-flex items-center gap-0.5 text-xs font-medium', up ? 'text-emerald-700' : 'text-red-600')}
      title={`Previous period: ${isMoney ? money(prev) : int(prev)}`}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(d).toFixed(0)}%
    </span>
  );
}

function Stat({ label, value, cur, prev, isMoney, sub }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="text-[13px] text-zinc-500">{label}</div>
      <div className="num mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
        {prev !== undefined && <Delta cur={cur} prev={prev} money={isMoney} />}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

function BarList({ rows, valueKey = 'revenue', format = money, link }) {
  const max = Math.max(...rows.map((r) => r[valueKey] || 0), 1);
  if (!rows.length) return <p className="py-6 text-center text-zinc-400">No sales in this period</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const content = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate">{r.name}</span>
              <span className="num shrink-0 text-zinc-600">{format(r[valueKey])}</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-100"><div className="h-1.5 rounded-full bg-zinc-800" style={{ width: `${(r[valueKey] / max) * 100}%` }} /></div>
          </>
        );
        return <li key={r.id ?? r.name}>{link ? <Link to={link(r)} className="block hover:opacity-80">{content}</Link> : content}</li>;
      })}
    </ul>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function Heatmap({ cells }) {
  const hours = Array.from({ length: 14 }, (_, i) => i + 9); // 9:00 → 22:00
  const map = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.orders]));
  const max = Math.max(...cells.map((c) => c.orders), 1);
  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] text-zinc-500">
        <thead><tr><th />{hours.map((h) => <th key={h} className="px-0.5 pb-1 font-normal">{h}</th>)}</tr></thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <tr key={d}>
              <td className="pr-2">{DAYS[d]}</td>
              {hours.map((h) => {
                const v = map.get(`${d}-${h}`) || 0;
                return (
                  <td key={h} className="p-0.5">
                    <div title={`${DAYS[d]} ${h}:00 — ${v} orders`} className="h-5 w-6 rounded-sm"
                      style={{ background: v ? `rgba(24,24,27,${0.08 + (v / max) * 0.85})` : '#f4f4f5' }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] shadow-sm">
      <div className="text-zinc-500">{date(p.day)}</div>
      <div className="num font-semibold">{money(p.revenue)}</div>
      <div className="num text-zinc-500">{p.orders} orders</div>
    </div>
  );
}

export default function Overview() {
  const { staff, can } = useAuth();
  const [range, setRange] = useState('30d');
  const [channel, setChannel] = useState('');
  const r = RANGES.find((x) => x.value === range);
  const { data, loading } = useFetch(`/admin/reports/overview${qs({ from: r.from(), to: r.to(), channel })}`);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={`${greet}, ${staff.name.split(' ')[0]}`}
        subtitle={data ? `Today: ${money(data.today.revenue)} from ${data.today.orders} orders` : ' '}
        actions={<>
          <Select value={channel} onChange={(e) => setChannel(e.target.value)} className="w-36">
            <option value="">All channels</option><option value="pos">In store</option><option value="online">Website</option>
          </Select>
          <Select value={range} onChange={(e) => setRange(e.target.value)} className="w-40">
            {RANGES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </Select>
        </>}
      />
      {!data ? <Spinner /> : (
        <div className={cx('space-y-4 transition-opacity', loading && 'opacity-60')}>
          {(data.pending_online > 0 || data.stock.out_of_stock > 0 || data.stock.low_stock > 0) && (
            <div className="flex flex-wrap gap-2">
              {data.pending_online > 0 && (
                <Link to="/orders?status=processing,on-hold,pending&channel=online" className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-800 hover:bg-sky-100">
                  <ShoppingBag size={15} /> {data.pending_online} website order{data.pending_online > 1 ? 's' : ''} to prepare
                </Link>
              )}
              {data.stock.low_stock > 0 && (
                <Link to="/stock?filter=low" className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 hover:bg-amber-100">
                  <AlertTriangle size={15} /> {int(data.stock.low_stock)} products running low
                </Link>
              )}
              {data.stock.out_of_stock > 0 && (
                <Link to="/products?stock=out&status=publish" className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50">
                  <PackageX size={15} /> {int(data.stock.out_of_stock)} published products out of stock
                </Link>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Revenue" value={money(data.current.revenue)} cur={data.current.revenue} prev={data.previous.revenue} isMoney />
            <Stat label="Orders" value={int(data.current.orders)} cur={data.current.orders} prev={data.previous.orders} />
            <Stat label="Average order" value={money(data.current.average)} cur={data.current.average} prev={data.previous.average} isMoney />
            <Stat label="Items sold" value={int(data.current.items)} cur={data.current.items} prev={data.previous.items} />
            {can('manager') && (
              <Stat label="Gross profit" value={money(data.current.profit)} cur={data.current.profit} prev={data.previous.profit} isMoney
                sub={data.current.revenue_with_cost ? `${((data.current.profit / data.current.revenue_with_cost) * 100).toFixed(0)}% margin*` : null} />
            )}
          </div>

          <Card title="Revenue" actions={<span className="text-[13px] text-zinc-500">{date(data.range.from)} – {date(data.range.to)}</span>}>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#f4f4f5" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#a1a1aa' }} minTickGap={24}
                    tickFormatter={(d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
                  <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: '#a1a1aa' }} tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f4f4f5' }} />
                  <Bar dataKey="revenue" fill="#27272a" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Best-selling products" className="lg:col-span-2" padded={false}>
              <ul className="divide-y divide-zinc-100">
                {data.topProducts.map((p, i) => (
                  <li key={p.id ?? i}>
                    <Link to={p.id ? `/products/${p.id}` : '#'} className="flex items-center gap-3 px-4 py-2 hover:bg-zinc-50">
                      <span className="num w-4 text-zinc-400">{i + 1}</span>
                      <Thumb src={p.image} size={32} />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="num w-16 text-right text-zinc-500">{p.qty} sold</span>
                      <span className="num w-24 text-right font-medium">{money(p.revenue)}</span>
                    </Link>
                  </li>
                ))}
                {!data.topProducts.length && <li className="py-8 text-center text-zinc-400">No sales in this period</li>}
              </ul>
            </Card>
            <Card title="Sales channels">
              <BarList rows={data.channels.map((c) => ({ name: `${CHANNEL[c.channel] || c.channel} · ${c.orders} orders`, revenue: c.revenue, id: c.channel }))} />
              <div className="mt-5 mb-2 text-[13px] font-medium text-zinc-500">Payment methods</div>
              <BarList rows={data.payments.map((c) => ({ name: c.method, revenue: c.revenue }))} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Top categories"><BarList rows={data.topCategories} link={(r) => `/products?category=${r.id}`} /></Card>
            <Card title="Top brands"><BarList rows={data.topBrands} link={(r) => `/products?brand=${r.id}`} /></Card>
            <Card title="Busiest hours"><Heatmap cells={data.hours} /></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Latest orders" className="lg:col-span-2" padded={false} actions={<Link to="/orders" className="text-[13px] text-zinc-500 hover:text-zinc-900">View all</Link>}>
              <ul className="divide-y divide-zinc-100">
                {data.recent.map((o) => (
                  <li key={o.id}>
                    <Link to={`/orders/${o.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50">
                      <span className="w-16 font-medium">#{o.number}</span>
                      <span className="flex-1 truncate text-zinc-600">{fullName(o) || 'Walk-in customer'}</span>
                      <span className="hidden text-zinc-500 sm:inline">{CHANNEL[o.channel]}</span>
                      <Badge tone={ORDER_STATUS[o.status]?.tone}>{ORDER_STATUS[o.status]?.label}</Badge>
                      <span className="hidden w-20 text-right text-zinc-500 sm:inline">{ago(o.created_at)}</span>
                      <span className="num w-20 text-right font-medium">{money(o.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
            {data.staff.length > 0 && (
              <Card title="Sales by cashier"><BarList rows={data.staff} /></Card>
            )}
          </div>
          {can('manager') && <p className="text-xs text-zinc-400">* Profit and margin only count products that have a cost price.</p>}
        </div>
      )}
    </>
  );
}
