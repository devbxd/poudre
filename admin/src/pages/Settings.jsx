import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch, loadSettings } from '../lib/hooks.js';
import { dateTime, money } from '../lib/format.js';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, Textarea, Toggle, cx, useAction } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';

/** Loads one settings key and gives a save() that writes it back. */
function useSetting(key, fallback) {
  const { data } = useFetch(`/admin/settings/${key}`);
  const [value, setValue] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setValue({ ...fallback, ...data }); }, [data]); // eslint-disable-line
  const save = async (v = value) => { await run(() => api.put(`/admin/settings/${key}`, v), 'Settings saved'); loadSettings(true); };
  return [value, setValue, save, busy];
}

function SaveBar({ onSave, busy }) {
  return <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={() => onSave()}>Save</Button></div>;
}

function Store() {
  const [s, set, save, busy] = useSetting('store', {});
  if (!s) return <Spinner />;
  const f = (k, label, props = {}) => <Field label={label}><Input value={s[k] ?? ''} onChange={(e) => set({ ...s, [k]: e.target.value })} {...props} /></Field>;
  return (
    <div className="space-y-4">
      <Card title="Shop details">
        <div className="grid gap-3 sm:grid-cols-2">
          {f('name', 'Shop name')}{f('email', 'Email')}{f('phone', 'Phone')}{f('whatsapp', 'WhatsApp number', { placeholder: '961…' })}
          <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={s.address || ''} onChange={(e) => set({ ...s, address: e.target.value })} /></Field>
          {f('instagram', 'Instagram link')}{f('facebook', 'Facebook link')}{f('tiktok', 'TikTok link')}
        </div>
      </Card>
      <Card title="Currency">
        <div className="grid gap-3 sm:grid-cols-3">
          {f('currency', 'Main currency')}{f('currency_symbol', 'Symbol')}
          <Field label="LBP rate (1 $ =)" hint="Shown on receipts and in the POS">
            <Input type="number" value={s.secondary_currency?.rate ?? ''} onChange={(e) => set({ ...s, secondary_currency: { ...s.secondary_currency, code: 'LBP', rate: Number(e.target.value) } })} />
          </Field>
        </div>
      </Card>
      <SaveBar onSave={save} busy={busy} />
    </div>
  );
}

function Shipping() {
  const [s, set, save, busy] = useSetting('shipping', { methods: [] });
  if (!s) return <Spinner />;
  const methods = s.methods || [];
  const setM = (i, patch) => set({ ...s, methods: methods.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  return (
    <div className="space-y-4">
      <Card title="Delivery options" actions={<Button size="sm" icon={Plus} onClick={() => set({ ...s, methods: [...methods, { id: `m${Date.now()}`, title: '', cost: 0, enabled: true }] })}>Add option</Button>}>
        <p className="mb-3 text-[13px] text-zinc-500">What customers can choose at checkout. Leave the areas empty to offer an option everywhere.</p>
        <div className="space-y-3">
          {methods.map((m, i) => (
            <div key={m.id} className="grid items-end gap-3 rounded-md border border-zinc-200 p-3 sm:grid-cols-[1fr_120px_160px_1fr_auto_auto]">
              <Field label="Name"><Input value={m.title} onChange={(e) => setM(i, { title: e.target.value })} placeholder="Delivery – Beirut" /></Field>
              <Field label="Price"><Input prefix="$" type="number" step="0.01" value={m.cost} onChange={(e) => setM(i, { cost: Number(e.target.value) })} /></Field>
              <Field label="Free above"><Input prefix="$" type="number" value={m.free_above ?? ''} onChange={(e) => setM(i, { free_above: e.target.value === '' ? null : Number(e.target.value) })} placeholder="never" /></Field>
              <Field label="Areas (comma separated)"><Input value={(m.areas || []).join(', ')} onChange={(e) => setM(i, { areas: e.target.value.split(',').map((a) => a.trim()).filter(Boolean) })} placeholder="Beirut, Metn…" /></Field>
              <Toggle checked={m.enabled} onChange={(v) => setM(i, { enabled: v })} label="On" />
              <button onClick={() => set({ ...s, methods: methods.filter((_, j) => j !== i) })} className="mb-2 rounded p-1 text-zinc-400 hover:text-red-600"><Trash2 size={15} /></button>
            </div>
          ))}
          {!methods.length && <p className="py-4 text-center text-zinc-400">No delivery options yet</p>}
        </div>
        <div className="mt-4"><Toggle checked={s.pickup !== false} onChange={(v) => set({ ...s, pickup: v })} label="Allow pick-up in store" /></div>
      </Card>
      <SaveBar onSave={save} busy={busy} />
    </div>
  );
}

function Payments() {
  const { data } = useFetch('/admin/settings/payments');
  const [list, setList] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setList(Array.isArray(data) ? data : []); }, [data]);
  if (!list) return <Spinner />;
  const setP = (i, patch) => setList(list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-4">
      <Card title="Payment methods" actions={<Button size="sm" icon={Plus} onClick={() => setList([...list, { id: `pay${Date.now()}`, title: '', description: '', enabled: true, online: true, pos: true }])}>Add method</Button>}>
        <div className="space-y-3">
          {list.map((p, i) => (
            <div key={p.id} className="rounded-md border border-zinc-200 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><Input value={p.title} onChange={(e) => setP(i, { title: e.target.value })} /></Field>
                <Field label="Instructions for the customer"><Input value={p.description || ''} onChange={(e) => setP(i, { description: e.target.value })} /></Field>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-5">
                <Toggle checked={p.enabled} onChange={(v) => setP(i, { enabled: v })} label="Enabled" />
                <Toggle checked={p.online !== false} onChange={(v) => setP(i, { online: v })} label="On website" />
                <Toggle checked={p.pos !== false} onChange={(v) => setP(i, { pos: v })} label="In POS" />
                <button onClick={() => setList(list.filter((_, j) => j !== i))} className="ml-auto text-[13px] text-red-600 hover:underline">Remove</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <SaveBar busy={busy} onSave={async () => { await run(() => api.put('/admin/settings/payments', list), 'Payment methods saved'); loadSettings(true); }} />
    </div>
  );
}

function Pos() {
  const [s, set, save, busy] = useSetting('pos', {});
  if (!s) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card title="Receipt">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Header"><Input value={s.receipt_header || ''} onChange={(e) => set({ ...s, receipt_header: e.target.value })} /></Field>
          <Field label="Footer"><Input value={s.receipt_footer || ''} onChange={(e) => set({ ...s, receipt_footer: e.target.value })} /></Field>
        </div>
        <div className="mt-4 space-y-3">
          <Toggle checked={s.auto_print !== false} onChange={(v) => set({ ...s, auto_print: v })} label="Print the receipt automatically after each sale" />
          <Toggle checked={s.show_lbp !== false} onChange={(v) => set({ ...s, show_lbp: v })} label="Show the total in LBP" />
        </div>
      </Card>
      <Card title="Rules">
        <div className="space-y-3">
          <Toggle checked={!!s.require_session} onChange={(v) => set({ ...s, require_session: v })} label="Cash register must be opened before selling" description="Counts the cash at the start and end of the day" />
          <Toggle checked={s.allow_negative_stock !== false} onChange={(v) => set({ ...s, allow_negative_stock: v })} label="Allow selling items with no stock left" />
          <Toggle checked={s.cashier_discounts !== false} onChange={(v) => set({ ...s, cashier_discounts: v })} label="Cashiers can change prices and give discounts" />
          <Toggle checked={s.cashier_refunds !== false} onChange={(v) => set({ ...s, cashier_refunds: v })} label="Cashiers can make refunds" />
        </div>
      </Card>
      <SaveBar onSave={save} busy={busy} />
    </div>
  );
}

function Staff() {
  const { data, reload } = useFetch('/admin/staff');
  const { can, staff: me } = useAuth();
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  return (
    <>
      <Card padded={false} title="Team" actions={can('owner') && <Button size="sm" icon={Plus} onClick={() => setEdit({ role: 'cashier', active: true })}>Add member</Button>}>
        {!data ? <Spinner /> : (
          <Table rows={data} onRowClick={can('owner') ? setEdit : undefined} columns={[
            { key: 'name', label: 'Name', render: (s) => <div><div className="font-medium">{s.name}{s.id === me.id && <span className="ml-1 text-zinc-400">(you)</span>}</div><div className="text-xs text-zinc-500">{s.username}</div></div> },
            { key: 'role', label: 'Role', render: (s) => <Badge tone={s.role === 'owner' ? 'blue' : 'gray'}>{s.role}</Badge> },
            { key: 'has_pin', label: 'POS PIN', render: (s) => (s.has_pin ? 'Yes' : '—') },
            { key: 'order_count', label: 'Sales', align: 'right' },
            { key: 'last_login_at', label: 'Last login', render: (s) => dateTime(s.last_login_at) },
            { key: 'active', label: '', render: (s) => !s.active && <Badge>Disabled</Badge> },
          ]} />
        )}
      </Card>
      <div className="mt-4 rounded-md bg-zinc-50 p-4 text-[13px] text-zinc-600">
        <b>Owner</b>: everything. <b>Manager</b>: everything except team, payments and shop settings. <b>Cashier</b>: POS, orders, customers and stock view only.
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit team member' : 'New team member'}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => {
          await run(() => (edit.id ? api.put(`/admin/staff/${edit.id}`, edit) : api.post('/admin/staff', edit)), 'Saved');
          setEdit(null); reload();
        }}>Save</Button></>}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><Input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Username"><Input value={edit.username || ''} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
            <Field label="Email"><Input value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Role"><Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}><option value="cashier">Cashier</option><option value="manager">Manager</option><option value="owner">Owner</option></Select></Field>
            <Field label={edit.id ? 'New password' : 'Password'} hint={edit.id ? 'Leave empty to keep it' : 'At least 6 characters'}><Input type="password" value={edit.password || ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
            <Field label="POS PIN" hint="4–6 digits for quick login at the till"><Input inputMode="numeric" value={edit.pin || ''} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></Field>
            {edit.id && <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" />}
          </div>
        )}
      </Modal>
    </>
  );
}

function Account() {
  const [f, setF] = useState({ current: '', password: '' });
  const [run, busy] = useAction();
  return (
    <Card title="Change my password">
      <div className="max-w-sm space-y-3">
        <Field label="Current password"><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New password" hint="At least 8 characters"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Button variant="primary" loading={busy} onClick={async () => { await run(() => api.post('/auth/password', f), 'Password changed'); setF({ current: '', password: '' }); }}>Change password</Button>
      </div>
    </Card>
  );
}

function Registers() {
  const { data } = useFetch('/pos/sessions');
  return (
    <Card padded={false} title="Cash register history">
      {!data ? <Spinner /> : (
        <Table rows={data} columns={[
          { key: 'opened_at', label: 'Opened', render: (s) => dateTime(s.opened_at) },
          { key: 'closed_at', label: 'Closed', render: (s) => (s.closed_at ? dateTime(s.closed_at) : <Badge tone="green">Open</Badge>) },
          { key: 'staff_name', label: 'By' },
          { key: 'orders', label: 'Sales', align: 'right' },
          { key: 'revenue', label: 'Revenue', align: 'right', render: (s) => money(s.revenue) },
          { key: 'diff', label: 'Cash difference', align: 'right', render: (s) => {
            if (s.closing_cash == null) return '—';
            const d = Number(s.closing_cash) - Number(s.expected_cash);
            return <span className={Math.abs(d) > 0.5 ? 'font-medium text-red-600' : 'text-emerald-700'}>{d > 0 ? '+' : ''}{money(d)}</span>;
          } },
        ]} />
      )}
    </Card>
  );
}

function Activity() {
  const { data } = useFetch('/admin/activity?per_page=200');
  return (
    <Card padded={false} title="Activity log">
      {!data ? <Spinner /> : (
        <Table dense rows={data} columns={[
          { key: 'created_at', label: 'When', render: (a) => dateTime(a.created_at) },
          { key: 'staff_name', label: 'Who' },
          { key: 'action', label: 'Action', render: (a) => `${a.action} ${a.entity || ''} ${a.entity_id && a.entity_id.length < 12 ? `#${a.entity_id}` : ''}` },
        ]} />
      )}
    </Card>
  );
}

const SECTIONS = [
  { path: 'store', label: 'Shop', el: Store, role: 'owner' },
  { path: 'shipping', label: 'Delivery', el: Shipping, role: 'owner' },
  { path: 'payments', label: 'Payments', el: Payments, role: 'owner' },
  { path: 'pos', label: 'Point of sale', el: Pos, role: 'manager' },
  { path: 'registers', label: 'Cash registers', el: Registers, role: 'manager' },
  { path: 'team', label: 'Team', el: Staff, role: 'manager' },
  { path: 'activity', label: 'Activity log', el: Activity, role: 'owner' },
  { path: 'account', label: 'My account', el: Account, role: 'cashier' },
];

export default function Settings() {
  const { can } = useAuth();
  const sections = SECTIONS.filter((s) => can(s.role));
  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-48 lg:flex-col">
          {sections.map((s) => (
            <NavLink key={s.path} to={`/settings/${s.path}`} className={({ isActive }) => cx('whitespace-nowrap rounded-md px-3 py-1.5', isActive ? 'bg-zinc-200/70 font-medium' : 'text-zinc-600 hover:bg-zinc-100')}>{s.label}</NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Routes>
            {sections.map((s) => <Route key={s.path} path={s.path} element={<s.el />} />)}
            <Route path="*" element={<Navigate to={sections[0].path} replace />} />
          </Routes>
        </div>
      </div>
    </>
  );
}
