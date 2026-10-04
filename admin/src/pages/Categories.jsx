import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { Button, Card, Field, Input, Modal, PageHeader, SearchInput, Select, Spinner, Textarea, Thumb, Toggle, cx, useAction, useToast } from '../components/ui.jsx';
import { MediaPicker } from '../components/MediaPicker.jsx';
import { categoryOptions } from '../components/pickers.jsx';
import { useAuth } from '../lib/auth.jsx';

/** Small on/off switch used in the category rows */
function MiniSwitch({ on, onClick, title }) {
  return (
    <span className="flex w-14 justify-center">
      <button type="button" role="switch" aria-checked={!!on} title={title} onClick={onClick}
        className={cx('relative h-5 w-9 rounded-full transition-colors', on ? 'bg-emerald-600' : 'bg-zinc-300')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </span>
  );
}

function CategoryForm({ value, categories, onClose, onSaved }) {
  const [c, setC] = useState(value);
  const [picker, setPicker] = useState(false);
  const [run, busy] = useAction();
  const opts = categoryOptions(categories.filter((x) => x.id !== c.id));
  const save = async () => {
    const body = { ...c, parent_id: c.parent_id ? Number(c.parent_id) : null };
    await run(() => (c.id ? api.put(`/admin/categories/${c.id}`, body) : api.post('/admin/categories', body)), 'Category saved');
    onSaved();
  };
  return (
    <Modal open onClose={onClose} title={c.id ? 'Edit category' : 'New category'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <div className="flex gap-3">
          <button type="button" onClick={() => setPicker(true)} className="shrink-0">
            {c.image ? <Thumb src={c.image} size={72} /> : <div className="flex h-[72px] w-[72px] items-center justify-center rounded border border-dashed border-zinc-300 text-zinc-400"><ImagePlus size={18} /></div>}
          </button>
          <div className="flex-1 space-y-3">
            <Field label="Name"><Input autoFocus value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
            <Field label="Parent category">
              <Select value={c.parent_id || ''} onChange={(e) => setC({ ...c, parent_id: e.target.value })}>
                <option value="">None (top level)</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </Select>
            </Field>
          </div>
        </div>
        {c.image && <button className="text-xs text-red-600" onClick={() => setC({ ...c, image: null })}>Remove image</button>}
        <Field label="URL" hint={`poudrebeauty.com/product-category/${c.slug || '…'}/`}><Input value={c.slug || ''} onChange={(e) => setC({ ...c, slug: e.target.value })} placeholder="generated from the name" /></Field>
        <Field label="Description"><Textarea rows={3} value={c.description || ''} onChange={(e) => setC({ ...c, description: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-6 pt-1">
          <Toggle checked={c.visible} onChange={(v) => setC({ ...c, visible: v })} label="Show on website" />
          <Toggle checked={c.pos_visible} onChange={(v) => setC({ ...c, pos_visible: v })} label="Show in POS" />
        </div>
      </div>
      <MediaPicker open={picker} onClose={() => setPicker(false)} onPick={([m]) => setC({ ...c, image: m.url })} />
    </Modal>
  );
}

export default function Categories() {
  const { data, reload, setData } = useFetch('/admin/categories');
  const { can } = useAuth();
  const { confirm } = useToast();
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState(new Set());
  const [run] = useAction();

  const tree = useMemo(() => {
    if (!data) return [];
    const kids = new Map();
    for (const c of data) {
      const k = c.parent_id || 0;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k).push(c);
    }
    for (const list of kids.values()) list.sort((a, b) => a.menu_order - b.menu_order || a.name.localeCompare(b.name));
    const out = [];
    const walk = (pid, depth) => {
      for (const c of kids.get(pid) || []) {
        out.push({ ...c, depth, hasKids: kids.has(c.id), siblings: kids.get(pid) });
        if (!collapsed.has(c.id) || q) walk(c.id, depth + 1);
      }
    };
    walk(0, 0);
    return q ? out.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : out;
  }, [data, collapsed, q]);

  const move = async (c, dir) => {
    const list = [...c.siblings];
    const i = list.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const items = list.map((x, k) => ({ id: x.id, parent_id: x.parent_id, menu_order: k }));
    setData((d) => d.map((x) => ({ ...x, menu_order: items.find((it) => it.id === x.id)?.menu_order ?? x.menu_order })));
    await run(() => api.post('/admin/categories/reorder', items));
  };
  const toggle = async (c, field) => {
    setData((d) => d.map((x) => (x.id === c.id ? { ...x, [field]: !x[field] } : x)));
    await run(() => api.put(`/admin/categories/${c.id}`, { [field]: !c[field] }), field === 'visible' ? (c.visible ? 'Hidden from website' : 'Shown on website') : (c.pos_visible ? 'Hidden from POS' : 'Shown in POS'));
  };

  return (
    <>
      <PageHeader title="Categories" subtitle={data ? `${data.length} categories · Use the arrows to change the order shown on the website and in the POS` : ' '}
        actions={can('manager') && <Button variant="primary" icon={Plus} onClick={() => setEdit({ name: '', visible: true, pos_visible: true, parent_id: '' })}>Add category</Button>} />
      <Card padded={false}>
        <div className="flex items-center gap-2 border-b border-zinc-200 p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Find a category…" className="w-72" delay={0} />
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set(data.filter((c) => data.some((k) => k.parent_id === c.id)).map((c) => c.id)))}>Collapse all</Button>
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}>Expand all</Button>
        </div>
        {!data ? <Spinner /> : (
          <ul className="divide-y divide-zinc-100">
            <li className="flex items-center gap-2 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-500">
              <span className="flex-1">Category</span>
              {can('manager') && <><span className="w-14 text-center">Website</span><span className="w-14 text-center">POS</span><span className="w-[136px]" /></>}
            </li>
            {tree.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-50">
                <div style={{ width: c.depth * 24 }} className="shrink-0" />
                <button className={cx('rounded p-0.5 text-zinc-400 hover:bg-zinc-200', !c.hasKids && 'invisible')}
                  onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}>
                  {collapsed.has(c.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                </button>
                <Thumb src={c.image} size={32} />
                <div className="min-w-0 flex-1">
                  <div className={cx('truncate font-medium', !c.visible && 'text-zinc-400')}>{c.name}</div>
                  <div className="text-xs text-zinc-500">/{c.slug}</div>
                </div>
                <Link to={`/products?category=${c.id}`} className="num w-24 text-right text-[13px] text-zinc-500 hover:text-zinc-900">{c.product_count} products</Link>
                {can('manager') && (
                  <div className="flex items-center gap-0.5">
                    <MiniSwitch on={c.visible} onClick={() => toggle(c, 'visible')} title={c.visible ? 'Shown on the website — click to hide' : 'Hidden from the website — click to show'} />
                    <MiniSwitch on={c.pos_visible} onClick={() => toggle(c, 'pos_visible')} title={c.pos_visible ? 'Shown in the POS — click to hide' : 'Hidden from the POS — click to show'} />
                    <button title="Move up" onClick={() => move(c, -1)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-900"><ArrowUp size={14} /></button>
                    <button title="Move down" onClick={() => move(c, 1)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-900"><ArrowDown size={14} /></button>
                    <button title="Edit" onClick={() => setEdit(c)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-900"><Pencil size={14} /></button>
                    <button title="Delete" onClick={async () => {
                      if (!(await confirm({ title: `Delete "${c.name}"?`, message: 'Products stay in your catalogue, they are only removed from this category. Sub-categories move up one level.', danger: true, confirmLabel: 'Delete' }))) return;
                      await run(() => api.del(`/admin/categories/${c.id}`), 'Category deleted');
                      reload();
                    }} className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <CategoryForm value={edit} categories={data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}
