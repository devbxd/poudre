import { useMemo, useState } from 'react';
import { Plus, TicketPercent } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { money, date } from '../lib/format.js';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Table, Textarea, Toggle, useAction, useToast } from '../components/ui.jsx';
import { MultiSelect, categoryOptions } from '../components/pickers.jsx';

function CouponForm({ value, onClose, onSaved }) {
  const [c, setC] = useState({ type: 'percent', amount: '', active: true, category_ids: [], excluded_category_ids: [], product_ids: [], excluded_product_ids: [], ...value, expires_at: value.expires_at?.slice(0, 10) || '' });
  const { data: categories } = useFetch('/admin/categories');
  const catOpts = useMemo(() => categoryOptions(categories || []), [categories]);
  const [run, busy] = useAction();
  const { confirm } = useToast();
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  return (
    <Modal open onClose={onClose} title={c.id ? `Coupon ${c.code.toUpperCase()}` : 'New coupon'} width={600}
      footer={<>
        {c.id && <Button variant="danger" className="mr-auto" onClick={async () => {
          if (!(await confirm({ title: 'Delete this coupon?', danger: true, confirmLabel: 'Delete' }))) return;
          await run(() => api.del(`/admin/coupons/${c.id}`), 'Coupon deleted');
          onSaved();
        }}>Delete</Button>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={async () => {
          const body = { ...c, amount: Number(c.amount) || 0, expires_at: c.expires_at || null, min_amount: num(c.min_amount), max_amount: num(c.max_amount), usage_limit: num(c.usage_limit), usage_limit_per_user: num(c.usage_limit_per_user) };
          await run(() => (c.id ? api.put(`/admin/coupons/${c.id}`, body) : api.post('/admin/coupons', body)), 'Coupon saved');
          onSaved();
        }}>Save</Button>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" hint="What customers type at checkout"><Input autoFocus value={c.code || ''} onChange={(e) => setC({ ...c, code: e.target.value.replace(/\s/g, '') })} className="uppercase" /></Field>
        <Field label="Discount">
          <div className="flex gap-2">
            <Select value={c.type} onChange={(e) => setC({ ...c, type: e.target.value })} className="w-40">
              <option value="percent">% off</option><option value="fixed_cart">$ off the order</option><option value="fixed_product">$ off each product</option>
            </Select>
            <Input type="number" step="0.01" value={c.amount} onChange={(e) => setC({ ...c, amount: e.target.value })} />
          </div>
        </Field>
        <Field label="Expires on"><Input type="date" value={c.expires_at} onChange={(e) => setC({ ...c, expires_at: e.target.value })} /></Field>
        <Field label="Minimum order"><Input prefix="$" type="number" value={c.min_amount ?? ''} onChange={(e) => setC({ ...c, min_amount: e.target.value })} /></Field>
        <Field label="Total uses allowed" hint="Empty = unlimited"><Input type="number" value={c.usage_limit ?? ''} onChange={(e) => setC({ ...c, usage_limit: e.target.value })} /></Field>
        <Field label="Uses per customer"><Input type="number" value={c.usage_limit_per_user ?? ''} onChange={(e) => setC({ ...c, usage_limit_per_user: e.target.value })} /></Field>
        <Field label="Only for these categories" className="col-span-2"><MultiSelect options={catOpts} value={c.category_ids || []} onChange={(v) => setC({ ...c, category_ids: v })} placeholder="All categories" /></Field>
        <Field label="Never for these categories" className="col-span-2"><MultiSelect options={catOpts} value={c.excluded_category_ids || []} onChange={(v) => setC({ ...c, excluded_category_ids: v })} placeholder="None" /></Field>
        <Field label="Description (private)" className="col-span-2"><Textarea rows={2} value={c.description || ''} onChange={(e) => setC({ ...c, description: e.target.value })} /></Field>
        <Toggle checked={c.free_shipping} onChange={(v) => setC({ ...c, free_shipping: v })} label="Free delivery" />
        <Toggle checked={c.exclude_sale_items} onChange={(v) => setC({ ...c, exclude_sale_items: v })} label="Not on sale items" />
        <Toggle checked={c.active} onChange={(v) => setC({ ...c, active: v })} label="Active" />
      </div>
    </Modal>
  );
}

export default function Coupons() {
  const { data, reload } = useFetch('/admin/coupons');
  const [edit, setEdit] = useState(null);
  const expired = (c) => c.expires_at && new Date(c.expires_at) < new Date();
  return (
    <>
      <PageHeader title="Coupons" subtitle="Discount codes for the website and the POS"
        actions={<Button variant="primary" icon={Plus} onClick={() => setEdit({ code: '' })}>Create coupon</Button>} />
      <Card padded={false}>
        {!data ? <Spinner /> : (
          <Table rows={data} onRowClick={setEdit} empty={<Empty icon={TicketPercent} title="No coupons yet" />} columns={[
            { key: 'code', label: 'Code', render: (c) => <span className="font-mono font-medium uppercase">{c.code}</span> },
            { key: 'amount', label: 'Discount', render: (c) => (c.type === 'percent' ? `${Number(c.amount)}%` : money(c.amount)) + (c.free_shipping ? ' + free delivery' : '') },
            { key: 'usage', label: 'Used', render: (c) => `${c.usage_count}${c.usage_limit ? ` / ${c.usage_limit}` : ''}` },
            { key: 'discount_given', label: 'Discount given', align: 'right', render: (c) => money(c.discount_given) },
            { key: 'expires_at', label: 'Expires', render: (c) => (c.expires_at ? date(c.expires_at) : 'Never') },
            { key: 'status', label: 'Status', render: (c) => (!c.active ? <Badge>Off</Badge> : expired(c) ? <Badge tone="red">Expired</Badge> : <Badge tone="green">Active</Badge>) },
          ]} />
        )}
      </Card>
      {edit && <CouponForm value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}
