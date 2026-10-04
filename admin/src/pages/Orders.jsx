import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Plus, ShoppingBag } from 'lucide-react';
import { useFetch, useFilters } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { money, dateTime, fullName, ORDER_STATUS, CHANNEL } from '../lib/format.js';
import { Badge, Button, Card, Empty, Input, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Tabs, useAction } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';

const STATUS_TABS = ['', 'processing', 'on-hold', 'pending', 'completed', 'cancelled', 'refunded'];

export default function Orders() {
  const [f, setF] = useFilters({ page: '1' });
  const navigate = useNavigate();
  const { can } = useAuth();
  const [selected, setSelected] = useState(new Set());
  const [run, busy] = useAction();
  const query = qs({ q: f.q, status: f.status, channel: f.channel, payment: f.payment, from: f.from, to: f.to, customer: f.customer, page: f.page, per_page: 50 });
  const { data, loading, reload } = useFetch(`/admin/orders${query}`);

  const bulk = async (status) => {
    await run(() => api.post('/admin/orders/bulk', { ids: [...selected], status }), `${selected.size} orders updated`);
    setSelected(new Set());
    reload();
  };

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle={data ? `${data.total.toLocaleString()} orders · ${money(data.amount)}` : ' '}
        actions={<>
          {can('manager') && <Button icon={Download} onClick={() => { window.location.href = `/api/admin/orders/export${query}`; }}>Export CSV</Button>}
          {can('manager') && <Link to="/orders/new"><Button variant="primary" icon={Plus}>New order</Button></Link>}
        </>}
      />
      <Card padded={false}>
        <Tabs
          className="px-2"
          value={f.status || ''}
          onChange={(v) => setF({ status: v })}
          tabs={STATUS_TABS.map((s) => ({ value: s, label: s ? ORDER_STATUS[s].label : 'All', count: s ? data?.counts?.[s] || 0 : undefined }))}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3">
          <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Order #, name, phone, product…" className="w-full sm:w-72" />
          <Select value={f.channel || ''} onChange={(e) => setF({ channel: e.target.value })} className="w-36">
            <option value="">All channels</option><option value="pos">In store</option><option value="online">Website</option><option value="manual">Manual</option>
          </Select>
          <Input type="date" value={f.from || ''} onChange={(e) => setF({ from: e.target.value })} className="w-40" title="From" />
          <Input type="date" value={f.to || ''} onChange={(e) => setF({ to: e.target.value })} className="w-40" title="To" />
          {(f.q || f.channel || f.from || f.to || f.customer) && <Button variant="ghost" size="sm" onClick={() => setF({ q: '', channel: '', from: '', to: '', customer: '' })}>Clear filters</Button>}
          {selected.size > 0 && can('manager') && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[13px] text-zinc-500">{selected.size} selected</span>
              <Select className="w-44" value="" disabled={busy} onChange={(e) => e.target.value && bulk(e.target.value)}>
                <option value="">Change status to…</option>
                {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
            </div>
          )}
        </div>
        {!data ? <Spinner /> : (
          <div className={loading ? 'opacity-60' : ''}>
            <Table
              rows={data.items}
              selectable={can('manager')} selected={selected} onSelect={setSelected}
              onRowClick={(o) => navigate(`/orders/${o.id}`)}
              empty={<Empty icon={ShoppingBag} title="No orders found" text="Try changing the filters." />}
              columns={[
                { key: 'number', label: 'Order', render: (o) => <span className="font-medium">#{o.number}</span> },
                { key: 'created_at', label: 'Date', mobile: false, render: (o) => <span className="whitespace-nowrap text-zinc-600">{dateTime(o.created_at)}</span> },
                { key: 'customer', label: 'Customer', render: (o) => (
                  <div className="max-w-[220px]">
                    <div className="truncate">{fullName(o) && fullName(o) !== 'Guest' ? fullName(o) : <span className="text-zinc-400">Walk-in</span>}</div>
                    {o.phone && <div className="text-xs text-zinc-500">{o.phone}</div>}
                  </div>
                ) },
                { key: 'items', label: 'Items', mobile: false, render: (o) => <div className="max-w-[280px] truncate text-zinc-600" title={o.items_preview}>{o.item_count} · {o.items_preview}</div> },
                { key: 'channel', label: 'Channel', mobile: false, render: (o) => <span className="text-zinc-600">{CHANNEL[o.channel]}{o.staff_name ? ` · ${o.staff_name.split(' ')[0]}` : ''}</span> },
                { key: 'status', label: 'Status', render: (o) => <Badge tone={ORDER_STATUS[o.status]?.tone}>{ORDER_STATUS[o.status]?.label}</Badge> },
                { key: 'total', label: 'Total', align: 'right', render: (o) => (
                  <div>
                    <div className="font-medium">{money(o.total)}</div>
                    {o.refunded_total > 0 && <div className="text-xs text-red-600">-{money(o.refunded_total)}</div>}
                  </div>
                ) },
              ]}
            />
            <Pagination page={data.page} perPage={data.per_page} total={data.total} onChange={(page) => setF({ page: String(page) })} />
          </div>
        )}
      </Card>
    </>
  );
}
