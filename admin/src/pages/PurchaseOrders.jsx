import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import { useFetch, useFilters } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { money, date } from '../lib/format.js';
import { Badge, Button, Card, Empty, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Tabs } from '../components/ui.jsx';

export const PO_STATUS = { draft: { label: 'Draft', tone: 'gray' }, ordered: { label: 'Ordered', tone: 'blue' }, partial: { label: 'Partly received', tone: 'amber' }, received: { label: 'Received', tone: 'green' }, cancelled: { label: 'Cancelled', tone: 'gray' } };

export default function PurchaseOrders() {
  const [f, setF] = useFilters({ page: '1' });
  const navigate = useNavigate();
  const { data, loading } = useFetch(`/admin/purchase-orders${qs({ ...f, per_page: 50 })}`);
  const { data: suppliers } = useFetch('/admin/suppliers');
  return (
    <>
      <PageHeader title="Purchase orders" subtitle="Orders you place with your suppliers. Receiving one adds the stock automatically."
        actions={<Link to="/purchase-orders/new"><Button variant="primary" icon={Plus}>New purchase order</Button></Link>} />
      <Card padded={false}>
        <Tabs className="px-2" value={f.status || ''} onChange={(v) => setF({ status: v })}
          tabs={[{ value: '', label: 'All' }, ...Object.entries(PO_STATUS).map(([k, v]) => ({ value: k, label: v.label }))]} />
        <div className="flex flex-wrap gap-2 border-b border-zinc-200 p-3">
          <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="PO number or product…" className="w-64" />
          <Select value={f.supplier || ''} onChange={(e) => setF({ supplier: e.target.value })} className="w-48">
            <option value="">All suppliers</option>{(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        {!data ? <Spinner /> : (
          <div className={loading ? 'opacity-60' : ''}>
            <Table rows={data.items} onRowClick={(po) => navigate(`/purchase-orders/${po.id}`)}
              empty={<Empty icon={ClipboardList} title="No purchase orders" />}
              columns={[
                { key: 'number', label: 'Number', render: (po) => <span className="font-medium">{po.number}</span> },
                { key: 'created_at', label: 'Date', render: (po) => date(po.created_at) },
                { key: 'supplier_name', label: 'Supplier', render: (po) => po.supplier_name || <span className="text-zinc-400">—</span> },
                { key: 'lines', label: 'Items', render: (po) => `${po.line_count} products · ${po.unit_count} units` },
                { key: 'status', label: 'Status', render: (po) => <Badge tone={PO_STATUS[po.status]?.tone}>{PO_STATUS[po.status]?.label}</Badge> },
                { key: 'total', label: 'Total', align: 'right', render: (po) => money(po.total) },
              ]} />
            <Pagination page={data.page} perPage={data.per_page} total={data.total} onChange={(page) => setF({ page: String(page) })} />
          </div>
        )}
      </Card>
    </>
  );
}
