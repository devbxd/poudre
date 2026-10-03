import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, MessageCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { money, date, dateTime, fullName, ORDER_STATUS, CHANNEL } from '../lib/format.js';
import { Badge, Button, Card, PageHeader, Spinner, Table, useAction, useToast } from '../components/ui.jsx';
import { CustomerForm } from './Customers.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { confirm } = useToast();
  const { data: c, reload } = useFetch(`/admin/customers/${id}`);
  const [edit, setEdit] = useState(false);
  const [run] = useAction();
  if (!c) return <Spinner />;
  const wa = c.phone ? `https://wa.me/${c.phone.replace(/\D/g, '').replace(/^0/, '961')}` : null;
  return (
    <>
      <PageHeader
        back={<Link to="/customers" className="mb-1 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} /> Customers</Link>}
        title={fullName(c) || c.email || c.phone || 'Customer'}
        subtitle={`Customer since ${date(c.created_at)}${c.has_account ? ' · has a website account' : ''}`}
        actions={<>
          {wa && <a href={wa} target="_blank" rel="noreferrer"><Button icon={MessageCircle}>WhatsApp</Button></a>}
          <Button icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>
          {can('manager') && <Button variant="danger" icon={Trash2} onClick={async () => {
            if (!(await confirm({ title: 'Delete this customer?', message: 'Their past orders are kept but no longer linked to them.', danger: true, confirmLabel: 'Delete' }))) return;
            await run(() => api.del(`/admin/customers/${id}`), 'Customer deleted');
            navigate('/customers');
          }} />}
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-3 gap-3">
            {[['Orders', c.stats.orders], ['Total spent', money(c.stats.spent)], ['Average order', money(c.stats.average)]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-zinc-200 bg-white p-4"><div className="text-[13px] text-zinc-500">{k}</div><div className="num mt-1 text-xl font-semibold">{v}</div></div>
            ))}
          </div>
          <Card title="Orders" padded={false}>
            <Table rows={c.orders} onRowClick={(o) => navigate(`/orders/${o.id}`)} columns={[
              { key: 'number', label: 'Order', render: (o) => <span className="font-medium">#{o.number}</span> },
              { key: 'created_at', label: 'Date', render: (o) => dateTime(o.created_at) },
              { key: 'channel', label: 'Channel', render: (o) => CHANNEL[o.channel] },
              { key: 'status', label: 'Status', render: (o) => <Badge tone={ORDER_STATUS[o.status]?.tone}>{ORDER_STATUS[o.status]?.label}</Badge> },
              { key: 'total', label: 'Total', align: 'right', render: (o) => money(o.total) },
            ]} />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Contact">
            <div className="space-y-1 text-zinc-700">
              {c.phone && <div>{c.phone}</div>}
              {c.email && <div>{c.email}</div>}
              {c.billing?.address_1 && <div className="pt-2">{c.billing.address_1}</div>}
              {c.billing?.city && <div>{c.billing.city}</div>}
              {c.tags?.length > 0 && <div className="flex flex-wrap gap-1 pt-2">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
            </div>
          </Card>
          {c.notes && <Card title="Notes"><p className="whitespace-pre-wrap text-zinc-700">{c.notes}</p></Card>}
          {c.top_products.length > 0 && (
            <Card title="Favourite products">
              <ul className="space-y-1.5">{c.top_products.map((p) => <li key={p.name} className="flex justify-between gap-2"><span className="truncate">{p.name}</span><span className="num text-zinc-500">×{p.qty}</span></li>)}</ul>
            </Card>
          )}
        </div>
      </div>
      {edit && <CustomerForm value={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
    </>
  );
}
