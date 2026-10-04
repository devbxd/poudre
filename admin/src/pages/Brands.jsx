import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ImagePlus, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { Button, Card, Field, Input, Modal, PageHeader, SearchInput, Spinner, Table, Textarea, Thumb, Toggle, useAction, useToast } from '../components/ui.jsx';
import { MediaPicker } from '../components/MediaPicker.jsx';
import { useAuth } from '../lib/auth.jsx';

function BrandForm({ value, onClose, onSaved }) {
  const [b, setB] = useState(value);
  const [picker, setPicker] = useState(false);
  const [run, busy] = useAction();
  const { confirm } = useToast();
  return (
    <Modal open onClose={onClose} title={b.id ? 'Edit brand' : 'New brand'}
      footer={<>
        {b.id && <Button variant="danger" className="mr-auto" onClick={async () => {
          if (!(await confirm({ title: `Delete ${b.name}?`, message: 'Products keep existing but lose this brand.', danger: true, confirmLabel: 'Delete' }))) return;
          await run(() => api.del(`/admin/brands/${b.id}`), 'Brand deleted');
          onSaved();
        }}>Delete</Button>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={async () => { await run(() => (b.id ? api.put(`/admin/brands/${b.id}`, b) : api.post('/admin/brands', b)), 'Brand saved'); onSaved(); }}>Save</Button>
      </>}>
      <div className="space-y-3">
        <div className="flex gap-3">
          <button type="button" onClick={() => setPicker(true)} className="shrink-0">
            {b.image ? <Thumb src={b.image} size={72} crop={false} className="object-contain" /> : <div className="flex h-[72px] w-[72px] items-center justify-center rounded border border-dashed border-zinc-300 text-zinc-400"><ImagePlus size={18} /></div>}
          </button>
          <Field label="Name" className="flex-1"><Input autoFocus value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></Field>
        </div>
        <Field label="URL" hint={`poudrebeauty.com/brand/${b.slug || '…'}/`}><Input value={b.slug || ''} onChange={(e) => setB({ ...b, slug: e.target.value })} /></Field>
        <Field label="Description"><Textarea rows={3} value={b.description || ''} onChange={(e) => setB({ ...b, description: e.target.value })} /></Field>
        <Toggle checked={b.visible} onChange={(v) => setB({ ...b, visible: v })} label="Show on website" />
      </div>
      <MediaPicker open={picker} onClose={() => setPicker(false)} onPick={([m]) => setB({ ...b, image: m.url })} />
    </Modal>
  );
}

export default function Brands() {
  const { data, reload } = useFetch('/admin/brands');
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const rows = (data || []).filter((b) => b.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Brands" subtitle={data ? `${data.length} brands` : ' '}
        actions={can('manager') && <Button variant="primary" icon={Plus} onClick={() => setEdit({ name: '', visible: true })}>Add brand</Button>} />
      <Card padded={false}>
        <div className="border-b border-zinc-200 p-3"><SearchInput value={q} onChange={setQ} delay={0} placeholder="Find a brand…" className="w-72" /></div>
        {!data ? <Spinner /> : (
          <Table rows={rows} onRowClick={can('manager') ? setEdit : undefined} columns={[
            { key: 'name', label: 'Brand', render: (b) => <div className="flex items-center gap-3"><Thumb src={b.image} size={32} crop={false} /><span className="font-medium">{b.name}</span>{!b.visible && <span className="text-xs text-zinc-400">hidden</span>}</div> },
            { key: 'slug', label: 'URL', render: (b) => <span className="text-zinc-500">/brand/{b.slug}</span> },
            { key: 'product_count', label: 'Products', align: 'right', render: (b) => <Link onClick={(e) => e.stopPropagation()} to={`/products?brand=${b.id}`} className="hover:underline">{b.product_count}</Link> },
          ]} />
        )}
      </Card>
      {edit && <BrandForm value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}
