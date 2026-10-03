import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { money } from '../lib/format.js';
import { Button, Card, Field, Input, Modal, PageHeader, SearchInput, Spinner, Table, Textarea, Toggle, useAction, useToast } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';

function SupplierForm({ value, onClose, onSaved }) {
  const [s, setS] = useState({ address: {}, ...value });
  const [run, busy] = useAction();
  const { confirm } = useToast();
  const f = (k, label, props = {}) => <Field label={label}><Input value={s[k] || ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} {...props} /></Field>;
  return (
    <Modal open onClose={onClose} title={s.id ? 'Edit supplier' : 'New supplier'} width={560}
      footer={<>
        {s.id && <Button variant="danger" className="mr-auto" onClick={async () => {
          if (!(await confirm({ title: `Delete ${s.name}?`, message: 'Products linked to this supplier keep existing.', danger: true, confirmLabel: 'Delete' }))) return;
          await run(() => api.del(`/admin/suppliers/${s.id}`), 'Supplier deleted');
          onSaved();
        }}>Delete</Button>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={async () => { await run(() => (s.id ? api.put(`/admin/suppliers/${s.id}`, s) : api.post('/admin/suppliers', s)), 'Supplier saved'); onSaved(); }}>Save</Button>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">{f('name', 'Name', { autoFocus: true })}</div>
        {f('phone', 'Phone')}{f('email', 'Email')}{f('website', 'Website / ordering link')}{f('code', 'Account / reference')}
        <Field label="Lead time (days)"><Input type="number" value={s.lead_time_days ?? ''} onChange={(e) => setS({ ...s, lead_time_days: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field label="Country / city"><Input value={s.address?.city || ''} onChange={(e) => setS({ ...s, address: { ...s.address, city: e.target.value } })} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea rows={3} value={s.notes || ''} onChange={(e) => setS({ ...s, notes: e.target.value })} /></Field>
        <Toggle checked={s.active !== false} onChange={(v) => setS({ ...s, active: v })} label="Active" />
      </div>
    </Modal>
  );
}

export default function Suppliers() {
  const { data, reload } = useFetch('/admin/suppliers');
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const rows = (data || []).filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Suppliers" subtitle={data ? `${data.length} suppliers` : ' '}
        actions={can('manager') && <Button variant="primary" icon={Plus} onClick={() => setEdit({ name: '', active: true })}>Add supplier</Button>} />
      <Card padded={false}>
        <div className="border-b border-zinc-200 p-3"><SearchInput value={q} onChange={setQ} delay={0} placeholder="Find a supplier…" className="w-72" /></div>
        {!data ? <Spinner /> : (
          <Table rows={rows} onRowClick={can('manager') ? setEdit : undefined} columns={[
            { key: 'name', label: 'Supplier', render: (s) => <div><div className="font-medium">{s.name}</div><div className="text-xs text-zinc-500">{[s.phone, s.email].filter(Boolean).join(' · ')}</div></div> },
            { key: 'product_count', label: 'Products', align: 'right', render: (s) => <Link onClick={(e) => e.stopPropagation()} className="hover:underline" to={`/products?supplier=${s.id}`}>{s.product_count}</Link> },
            { key: 'po_count', label: 'Purchase orders', align: 'right', render: (s) => <Link onClick={(e) => e.stopPropagation()} className="hover:underline" to={`/purchase-orders?supplier=${s.id}`}>{s.po_count}</Link> },
            { key: 'purchased', label: 'Total bought', align: 'right', render: (s) => money(s.purchased) },
          ]} />
        )}
      </Card>
      {edit && <SupplierForm value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}
