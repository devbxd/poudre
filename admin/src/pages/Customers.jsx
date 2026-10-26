import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Users } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useFetch, useFilters } from '../lib/hooks.js';
import { money, date, fullName } from '../lib/format.js';
import { Button, Card, Empty, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Textarea, useAction, useToast } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';

export function CustomerForm({ value, onClose, onSaved }) {
  const [c, setC] = useState({ billing: {}, shipping: {}, ...value });
  const [run, busy] = useAction();
  const b = c.billing || {};
  const setB = (patch) => setC({ ...c, billing: { ...b, ...patch } });
  return (
    <Modal open onClose={onClose} title={c.id ? 'Edit customer' : 'New customer'} width={560}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => {
        const body = { ...c, billing: { ...b, first_name: c.first_name, last_name: c.last_name, phone: c.phone, email: c.email } };
        const saved = await run(() => (c.id ? api.put(`/admin/customers/${c.id}`, body) : api.post('/admin/customers', body)), 'Customer saved');
        onSaved(saved);
      }}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name"><Input autoFocus value={c.first_name || ''} onChange={(e) => setC({ ...c, first_name: e.target.value })} /></Field>
        <Field label="Last name"><Input value={c.last_name || ''} onChange={(e) => setC({ ...c, last_name: e.target.value })} /></Field>
        <Field label="Phone"><Input value={c.phone || ''} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={c.email || ''} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
        <Field label="Address" className="col-span-2"><Input value={b.address_1 || ''} onChange={(e) => setB({ address_1: e.target.value })} /></Field>
        <Field label="City / area"><Input value={b.city || ''} onChange={(e) => setB({ city: e.target.value })} /></Field>
        <Field label="Date of birth" hint="Birthday e-mail with a 20% code"><Input type="date" value={c.date_of_birth || ''} onChange={(e) => setC({ ...c, date_of_birth: e.target.value || null })} /></Field>
        <Field label="Tags" hint="Comma separated, e.g. VIP, wholesale"><Input value={(c.tags || []).join(', ')} onChange={(e) => setC({ ...c, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea rows={3} value={c.notes || ''} onChange={(e) => setC({ ...c, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function Customers() {
  const [f, setF] = useFilters({ page: '1' });
  const navigate = useNavigate();
  const [edit, setEdit] = useState(null);
  const { data, loading, reload } = useFetch(`/admin/customers${qs({ ...f, per_page: 50 })}`);
  const { can } = useAuth();
  const { confirm } = useToast();
  const [run, busy] = useAction();
  // tick one or more customers, then delete them (their orders stay in sales and reports)
  const [selected, setSelected] = useState(new Set());
  const deleteSelected = async () => {
    const n = selected.size;
    if (!(await confirm({ title: `Delete ${n} customer${n > 1 ? 's' : ''}?`, message: 'Their orders are kept (sales and reports stay correct) but are no longer linked to them. This cannot be undone.', danger: true, confirmLabel: 'Delete' }))) return;
    await run(() => api.post('/admin/customers/bulk-delete', { ids: [...selected] }), `${n} customer${n > 1 ? 's' : ''} deleted`);
    setSelected(new Set());
    reload();
  };
  return (
    <>
      <PageHeader title="Customers" subtitle={data ? `${data.total.toLocaleString()} customers` : ' '}
        actions={<Button variant="primary" icon={Plus} onClick={() => setEdit({})}>Add customer</Button>} />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-zinc-200 p-3">
          <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Name, phone or email…" className="w-full sm:w-72" />
          <Select value={f.sort || ''} onChange={(e) => setF({ sort: e.target.value })} className="w-48">
            <option value="">Newest first</option><option value="-spent">Top spenders</option><option value="-orders">Most orders</option><option value="-last">Recently ordered</option><option value="name">Name A–Z</option>
          </Select>
        </div>
        {selected.size > 0 && can('manager') && (
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
            <span className="text-[13px] font-medium">{selected.size} selected</span>
            <Button size="sm" variant="danger" icon={Trash2} loading={busy} onClick={deleteSelected}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
          </div>
        )}
        {!data ? <Spinner /> : (
          <div className={loading ? 'opacity-60' : ''}>
            <Table rows={data.items} onRowClick={(c) => navigate(`/customers/${c.id}`)} rowHref={(c) => `/customers/${c.id}`} selectable={can('manager')} selected={selected} onSelect={setSelected}
              empty={<Empty icon={Users} title="No customers found" />}
              columns={[
                { key: 'name', label: 'Customer', render: (c) => <div><div className="font-medium">{fullName(c) || <span className="text-zinc-400">No name</span>}</div>{c.tags?.length > 0 && <div className="text-xs text-zinc-500">{c.tags.join(', ')}</div>}</div> },
                { key: 'contact', label: 'Contact', mobile: false, render: (c) => <div className="text-zinc-600"><div>{c.phone}</div><div className="text-xs">{c.email}</div></div> },
                { key: 'city', label: 'City', mobile: false, render: (c) => c.city || '—' },
                { key: 'order_count', label: 'Orders', align: 'right' },
                { key: 'spent', label: 'Spent', align: 'right', render: (c) => money(c.spent) },
                { key: 'last_order', label: 'Last order', mobile: false, align: 'right', render: (c) => date(c.last_order) },
              ]} />
            <Pagination page={data.page} perPage={data.per_page} total={data.total} onChange={(page) => setF({ page: String(page) })} />
          </div>
        )}
      </Card>
      {edit && <CustomerForm value={edit} onClose={() => setEdit(null)} onSaved={(c) => { setEdit(null); navigate(`/customers/${c.id}`); }} />}
    </>
  );
}
