import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CornerDownRight, CornerUpLeft, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { Button, Card, Field, Input, PageHeader, Select, Spinner, Tabs, useAction } from '../components/ui.jsx';
import { categoryOptions } from '../components/pickers.jsx';

const LOCATION_LABELS = { primary: 'Main menu', 'topbar-menu': 'Top bar', 'categories-menu': 'Categories menu' };

// Menu items are stored as a tree; the editor works on a flat list with depth
const flatten = (items, depth = 0) => items.flatMap((it) => [{ ...it, depth, children: undefined }, ...flatten(it.children || [], depth + 1)]);
function unflatten(list) {
  const root = [];
  const stack = [{ depth: -1, children: root }];
  for (const it of list) {
    const node = { ...it, children: [] };
    delete node.depth;
    while (stack[stack.length - 1].depth >= it.depth) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push({ depth: it.depth, children: node.children });
  }
  return root;
}

export default function Menus() {
  const { data: menus, setData } = useFetch('/admin/menus');
  const { data: categories } = useFetch('/admin/categories');
  const { data: pages } = useFetch('/admin/pages');
  const [current, setCurrent] = useState(null);
  const [list, setList] = useState([]);
  const [add, setAdd] = useState({ type: 'category', value: '', title: '', url: '' });
  const [run, busy] = useAction();
  const catOpts = useMemo(() => categoryOptions(categories || []), [categories]);
  useEffect(() => { if (menus && !current) setCurrent(menus.find((m) => m.location === 'primary')?.id || menus[0]?.id); }, [menus, current]);
  const menu = menus?.find((m) => m.id === current);
  useEffect(() => { if (menu) setList(flatten(menu.items || [])); }, [menu]);
  if (!menus) return <Spinner />;

  const setItem = (i, patch) => setList(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, d) => {
    // move the item together with its children
    const end = list.findIndex((x, j) => j > i && x.depth <= list[i].depth);
    const block = list.slice(i, end === -1 ? list.length : end);
    const rest = [...list.slice(0, i), ...list.slice(i + block.length)];
    let target = i + d;
    if (d > 0) {
      const nextEnd = rest.findIndex((x, j) => j > i && x.depth <= list[i].depth);
      target = nextEnd === -1 ? rest.length : nextEnd;
    } else {
      for (target = i - 1; target > 0 && rest[target].depth > list[i].depth; target--);
    }
    if (target < 0) return;
    setList([...rest.slice(0, target), ...block, ...rest.slice(target)]);
  };
  const indent = (i, d) => {
    const end = list.findIndex((x, j) => j > i && x.depth <= list[i].depth);
    const last = end === -1 ? list.length : end;
    const maxDepth = i === 0 ? 0 : list[i - 1].depth + 1;
    const nd = Math.max(0, Math.min(maxDepth, list[i].depth + d));
    const delta = nd - list[i].depth;
    setList(list.map((x, j) => (j >= i && j < last ? { ...x, depth: x.depth + delta } : x)));
  };
  const addItem = () => {
    let item;
    if (add.type === 'category') {
      const c = (categories || []).find((x) => x.id === Number(add.value));
      if (!c) return;
      item = { title: c.name, url: `/product-category/${c.slug}/`, type: 'product_cat', object_id: c.id };
    } else if (add.type === 'page') {
      const p = (pages || []).find((x) => x.id === Number(add.value));
      if (!p) return;
      item = { title: p.title, url: `/${p.slug}/`, type: 'page', object_id: p.id };
    } else {
      if (!add.title || !add.url) return;
      item = { title: add.title, url: add.url, type: 'custom' };
    }
    setList([...list, { ...item, id: Date.now(), depth: 0 }]);
    setAdd({ ...add, value: '', title: '', url: '' });
  };
  const save = async () => {
    const saved = await run(() => api.put(`/admin/menus/${current}`, { items: unflatten(list) }), 'Menu saved');
    setData((ms) => ms.map((m) => (m.id === saved.id ? saved : m)));
  };

  return (
    <>
      <PageHeader title="Menus" subtitle="The links shown in the website header and footer" actions={<Button variant="primary" loading={busy} onClick={save}>Save menu</Button>} />
      <Tabs className="mb-4" value={current} onChange={setCurrent} tabs={menus.map((m) => ({ value: m.id, label: LOCATION_LABELS[m.location] || m.name }))} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={menu?.name} className="lg:col-span-2" padded={false}>
          <ul className="divide-y divide-zinc-100">
            {list.map((it, i) => (
              <li key={`${it.id}-${i}`} className="flex items-center gap-2 px-3 py-2">
                <div style={{ width: it.depth * 28 }} className="shrink-0" />
                <Input value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} className="h-8 flex-1" />
                <Input value={it.url} onChange={(e) => setItem(i, { url: e.target.value })} className="h-8 w-56 text-zinc-500" />
                <div className="flex">
                  <button title="Move up" onClick={() => move(i, -1)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"><ArrowUp size={14} /></button>
                  <button title="Move down" onClick={() => move(i, 1)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"><ArrowDown size={14} /></button>
                  <button title="Make sub-item" onClick={() => indent(i, 1)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"><CornerDownRight size={14} /></button>
                  <button title="Move out" onClick={() => indent(i, -1)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"><CornerUpLeft size={14} /></button>
                  <button title="Remove" onClick={() => {
                    const end = list.findIndex((x, j) => j > i && x.depth <= it.depth);
                    setList([...list.slice(0, i), ...(end === -1 ? [] : list.slice(end))]);
                  }} className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
            {!list.length && <li className="py-10 text-center text-zinc-400">This menu is empty</li>}
          </ul>
        </Card>
        <Card title="Add a link">
          <div className="space-y-3">
            <Select value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value, value: '' })}>
              <option value="category">Category</option><option value="page">Page</option><option value="custom">Custom link</option>
            </Select>
            {add.type === 'category' && <Select value={add.value} onChange={(e) => setAdd({ ...add, value: e.target.value })}><option value="">Choose…</option>{catOpts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}
            {add.type === 'page' && <Select value={add.value} onChange={(e) => setAdd({ ...add, value: e.target.value })}><option value="">Choose…</option>{(pages || []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select>}
            {add.type === 'custom' && <>
              <Field label="Text"><Input value={add.title} onChange={(e) => setAdd({ ...add, title: e.target.value })} /></Field>
              <Field label="Link"><Input value={add.url} onChange={(e) => setAdd({ ...add, url: e.target.value })} placeholder="/brand/dior/ or https://…" /></Field>
            </>}
            <Button icon={Plus} className="w-full" onClick={addItem}>Add to menu</Button>
            <p className="text-xs text-zinc-500">Use the arrows to reorder, and the indent buttons to put a link inside a dropdown.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
