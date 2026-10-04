import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, ExternalLink, ImagePlus, Plus, Star, Trash2, Wand2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { money, int, dateTime, date } from '../lib/format.js';
import { Badge, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, Textarea, Thumb, Toggle, cx, sized, useAction, useToast } from '../components/ui.jsx';
import { ProductSearch, categoryOptions } from '../components/pickers.jsx';
import { MediaPicker } from '../components/MediaPicker.jsx';
import RichText from '../components/RichText.jsx';
import { STATUS } from './Products.jsx';
import { useAuth } from '../lib/auth.jsx';

const EMPTY = {
  type: 'simple', status: 'publish', name: '', slug: '', sku: '', barcode: '', description: '', short_description: '',
  regular_price: '', sale_price: '', sale_from: '', sale_to: '', purchase_price: '', manage_stock: true, stock_quantity: 0,
  stock_status: 'instock', backorders: 'no', low_stock_amount: '', weight: '', featured: false, catalog_visibility: 'visible',
  online_visible: true, pos_visible: true, supplier_id: '', supplier_sku: '', reviews_allowed: true, menu_order: 0,
  images: [], attributes: [], default_attributes: [], upsell_ids: [], cross_sell_ids: [], seo: {},
  categories: [], brands: [], tags: [], variations: [],
};

const toDateInput = (v) => (v ? String(v).slice(0, 10) : '');
const margin = (price, cost) => (Number(price) && Number(cost) ? `${(((price - cost) / price) * 100).toFixed(0)}% margin · ${money(price - cost)} profit` : null);

function Images({ images, onChange }) {
  const [picker, setPicker] = useState(false);
  const move = (i, d) => {
    const next = [...images];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <Card title="Images" actions={<Button size="sm" icon={ImagePlus} onClick={() => setPicker(true)}>Add images</Button>}>
      {images.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {images.map((img, i) => (
            <div key={`${img.url}-${i}`} className={cx('group relative aspect-square overflow-hidden rounded-md border bg-zinc-50', i === 0 ? 'col-span-2 row-span-2 border-zinc-300' : 'border-zinc-200')}>
              <img src={sized(img.url, 500)} alt={img.alt} className="h-full w-full object-cover" />
              {i === 0 && <span className="absolute left-1.5 top-1.5 rounded bg-white/90 px-1.5 text-xs font-medium">Main</span>}
              <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-gradient-to-t from-black/50 p-1.5 opacity-0 transition group-hover:opacity-100">
                {i > 0 && <button title="Make main image" onClick={() => onChange([img, ...images.filter((_, j) => j !== i)])} className="rounded bg-white p-1"><Star size={13} /></button>}
                {i > 0 && <button title="Move left" onClick={() => move(i, -1)} className="rounded bg-white p-1"><ChevronLeft size={13} /></button>}
                {i < images.length - 1 && <button title="Move right" onClick={() => move(i, 1)} className="rounded bg-white p-1"><ChevronRight size={13} /></button>}
                <button title="Remove" onClick={() => onChange(images.filter((_, j) => j !== i))} className="rounded bg-white p-1 text-red-600"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <button onClick={() => setPicker(true)} className="flex h-32 w-full flex-col items-center justify-center rounded-md border border-dashed border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:bg-zinc-50">
          <ImagePlus size={20} className="mb-1" /> Add images
        </button>
      )}
      <MediaPicker open={picker} multiple onClose={() => setPicker(false)} onPick={(rows) => onChange([...images, ...rows.map((m) => ({ id: m.id, url: m.url, alt: m.alt || '' }))])} />
    </Card>
  );
}

function Attributes({ attributes, onChange, variable }) {
  const [draft, setDraft] = useState({ name: '', options: '' });
  return (
    <div className="space-y-2">
      {attributes.map((a, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md border border-zinc-200 p-2">
          <Input value={a.name} className="w-36" onChange={(e) => onChange(attributes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <Input value={a.options.join(' | ')} className="flex-1" placeholder="Option 1 | Option 2"
            onChange={(e) => onChange(attributes.map((x, j) => (j === i ? { ...x, options: e.target.value.split('|').map((s) => s.trim()).filter(Boolean) } : x)))} />
          {variable && <Checkbox className="mt-2" checked={a.variation} onChange={(v) => onChange(attributes.map((x, j) => (j === i ? { ...x, variation: v } : x)))} label="Options" />}
          <button onClick={() => onChange(attributes.filter((_, j) => j !== i))} className="mt-1.5 rounded p-1 text-zinc-400 hover:text-red-600"><X size={15} /></button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input value={draft.name} className="w-36" placeholder="e.g. Shade" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <Input value={draft.options} className="flex-1" placeholder="Values separated by |  e.g. 01 Ivory | 02 Beige" onChange={(e) => setDraft({ ...draft, options: e.target.value })} />
        <Button icon={Plus} disabled={!draft.name.trim()} onClick={() => {
          onChange([...attributes, { name: draft.name.trim(), options: draft.options.split('|').map((s) => s.trim()).filter(Boolean), visible: true, variation: variable }]);
          setDraft({ name: '', options: '' });
        }}>Add</Button>
      </div>
    </div>
  );
}

function Variations({ product, setProduct }) {
  const [picker, setPicker] = useState(null);
  const attrs = product.attributes.filter((a) => a.variation);
  const vars = product.variations;
  const setVar = (i, patch) => setProduct({ ...product, variations: vars.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const generate = () => {
    const combos = attrs.reduce((acc, a) => acc.flatMap((c) => a.options.map((o) => [...c, { name: a.name, option: o }])), [[]]);
    const key = (list) => list.map((x) => `${x.name}=${x.option}`).sort().join('&');
    const existing = new Set(vars.map((v) => key(v.attributes)));
    const added = combos.filter((c) => !existing.has(key(c))).map((attributes) => ({
      attributes, sku: '', regular_price: product.regular_price || '', sale_price: '', purchase_price: product.purchase_price || '', manage_stock: true, stock_quantity: 0, status: 'publish', image: null,
    }));
    setProduct({ ...product, variations: [...vars, ...added] });
  };
  const applyAll = (field) => {
    const value = prompt(`Set ${field.replace('_', ' ')} for all options:`);
    if (value !== null) setProduct({ ...product, variations: vars.map((v) => ({ ...v, [field]: value, ...(field === 'stock_quantity' ? { manage_stock: true } : {}) })) });
  };
  return (
    <Card title={`Options (${vars.length})`} padded={false}
      actions={<>
        <Button size="sm" icon={Wand2} disabled={!attrs.length} onClick={generate}>Create all combinations</Button>
        <Button size="sm" icon={Plus} onClick={() => setProduct({ ...product, variations: [...vars, { attributes: attrs.map((a) => ({ name: a.name, option: a.options[0] || '' })), manage_stock: true, stock_quantity: 0, status: 'publish', regular_price: product.regular_price || '' }] })}>Add one</Button>
      </>}>
      {!attrs.length && <p className="p-4 text-zinc-500">First add an attribute above (for example “Shade” or “Size”) and tick “Options”.</p>}
      {vars.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Image</th>
                {attrs.map((a) => <th key={a.name} className="px-2 py-2 font-medium">{a.name}</th>)}
                <th className="px-2 py-2 font-medium">SKU / barcode</th>
                <th className="px-2 py-2 font-medium"><button className="hover:underline" onClick={() => applyAll('regular_price')}>Price</button></th>
                <th className="px-2 py-2 font-medium"><button className="hover:underline" onClick={() => applyAll('sale_price')}>Sale</button></th>
                <th className="px-2 py-2 font-medium"><button className="hover:underline" onClick={() => applyAll('purchase_price')}>Cost</button></th>
                <th className="px-2 py-2 font-medium"><button className="hover:underline" onClick={() => applyAll('stock_quantity')}>Stock</button></th>
                <th className="px-2 py-2 font-medium">Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {vars.map((v, i) => (
                <tr key={v.id || `new-${i}`} className="border-b border-zinc-100">
                  <td className="px-3 py-1.5">
                    <button onClick={() => setPicker(i)} title="Choose image">{v.image?.url ? <Thumb src={v.image.url} size={32} /> : <div className="flex h-8 w-8 items-center justify-center rounded border border-dashed border-zinc-300 text-zinc-400"><ImagePlus size={13} /></div>}</button>
                  </td>
                  {attrs.map((a) => {
                    const cur = v.attributes.find((x) => x.name.toLowerCase() === a.name.toLowerCase())?.option || '';
                    return (
                      <td key={a.name} className="px-2 py-1.5">
                        <Select className="h-8 w-32" value={cur} onChange={(e) => setVar(i, { attributes: [...v.attributes.filter((x) => x.name.toLowerCase() !== a.name.toLowerCase()), { name: a.name, option: e.target.value }] })}>
                          <option value="">Any {a.name}</option>{a.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </Select>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5"><Input className="h-8 w-36" value={v.sku || ''} onChange={(e) => setVar(i, { sku: e.target.value, barcode: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><Input className="h-8 w-20" type="number" step="0.01" value={v.regular_price ?? ''} onChange={(e) => setVar(i, { regular_price: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><Input className="h-8 w-20" type="number" step="0.01" value={v.sale_price ?? ''} onChange={(e) => setVar(i, { sale_price: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><Input className="h-8 w-20" type="number" step="0.01" value={v.purchase_price ?? ''} onChange={(e) => setVar(i, { purchase_price: e.target.value })} /></td>
                  <td className="px-2 py-1.5">
                    {v.manage_stock
                      ? <Input className={cx('h-8 w-20', Number(v.stock_quantity) <= 0 && 'text-red-600')} type="number" value={v.stock_quantity ?? 0} onChange={(e) => setVar(i, { stock_quantity: e.target.value })} />
                      : <Select className="h-8 w-28" value={v.stock_status} onChange={(e) => e.target.value === 'track' ? setVar(i, { manage_stock: true, stock_quantity: 0 }) : setVar(i, { stock_status: e.target.value })}>
                          <option value="instock">In stock</option><option value="outofstock">Out of stock</option><option value="track">Track qty…</option>
                        </Select>}
                  </td>
                  <td className="px-2 py-1.5"><Checkbox checked={v.status !== 'private'} onChange={(on) => setVar(i, { status: on ? 'publish' : 'private' })} /></td>
                  <td className="px-2 py-1.5"><button onClick={() => setProduct({ ...product, variations: vars.filter((_, j) => j !== i) })} className="rounded p-1 text-zinc-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-zinc-500">Tip: click a column title (Price, Sale, Cost, Stock) to fill it for every option at once.</p>
        </div>
      )}
      <MediaPicker open={picker !== null} onClose={() => setPicker(null)} onPick={([m]) => setVar(picker, { image: { id: m.id, url: m.url, alt: m.alt || '' } })} />
    </Card>
  );
}

function CategoryChecklist({ categories, value, onChange }) {
  const [q, setQ] = useState('');
  const opts = useMemo(() => categoryOptions(categories), [categories]);
  const shown = opts.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const selected = opts.filter((o) => value.includes(o.id));
  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {selected.map((o) => (
            <button key={o.id} type="button" title="Remove" onClick={() => onChange(value.filter((x) => x !== o.id))}
              className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white hover:bg-zinc-700">{o.label} ×</button>
          ))}
        </div>
      )}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a category…" className="mb-2 h-8" />
      <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-zinc-200 p-2">
        {shown.map((o) => (
          <Checkbox key={o.id} className="flex w-full rounded px-1 py-0.5 hover:bg-zinc-50" checked={value.includes(o.id)}
            onChange={(on) => onChange(on ? [...value, o.id] : value.filter((x) => x !== o.id))} label={<span className="text-[13px]">{o.label}</span>} />
        ))}
      </div>
    </div>
  );
}

function LinkedProducts({ ids, onChange, label }) {
  const [names, setNames] = useState({});
  useEffect(() => {
    const missing = ids.filter((id) => !names[id]);
    if (missing.length) Promise.all(missing.map((id) => api.get(`/admin/products/${id}`).then((p) => [id, p.name]).catch(() => [id, `#${id}`]))).then((r) => setNames((n) => ({ ...n, ...Object.fromEntries(r) })));
  }, [ids]); // eslint-disable-line
  return (
    <Field label={label}>
      <div className="mb-2 flex flex-wrap gap-1">
        {ids.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-[13px]">
            {names[id] || '…'}<button onClick={() => onChange(ids.filter((x) => x !== id))} className="text-zinc-400 hover:text-zinc-900"><X size={12} /></button>
          </span>
        ))}
      </div>
      <ProductSearch variations={false} placeholder="Add a product…" onPick={(p) => !ids.includes(p.id) && onChange([...ids, p.id])} />
    </Field>
  );
}

export default function ProductEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { can } = useAuth();
  const { confirm } = useToast();
  const { data: loaded, setData } = useFetch(isNew ? null : `/admin/products/${id}`);
  const { data: categories } = useFetch('/admin/categories');
  const { data: brands } = useFetch('/admin/brands');
  const { data: suppliers } = useFetch('/admin/suppliers');
  const [p, setP] = useState(isNew ? EMPTY : null);
  const [dirty, setDirty] = useState(false);
  const [run, busy] = useAction();

  useEffect(() => {
    if (loaded) setP({ ...EMPTY, ...loaded, sale_from: toDateInput(loaded.sale_from), sale_to: toDateInput(loaded.sale_to), seo: loaded.seo || {} });
  }, [loaded]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (!p) return <Spinner />;

  const set = (patch) => { setP((x) => ({ ...x, ...patch })); setDirty(true); };
  const readOnly = !can('manager');

  const save = async () => {
    const body = {
      ...p,
      category_ids: p.categories.map((c) => c.id ?? c), brand_ids: p.brands.map((b) => b.id ?? b), tags: p.tags.map((t) => t.name ?? t),
      supplier_id: p.supplier_id || null, sale_from: p.sale_from || null, sale_to: p.sale_to || null,
      barcode: p.barcode || p.sku || null,
      variations: p.type === 'variable' ? p.variations : [],
    };
    for (const k of ['regular_price', 'sale_price', 'purchase_price', 'low_stock_amount', 'weight']) body[k] = body[k] === '' ? null : body[k];
    const saved = await run(() => (isNew ? api.post('/admin/products', body) : api.put(`/admin/products/${id}`, body)), 'Product saved');
    setDirty(false);
    if (isNew) navigate(`/products/${saved.id}`, { replace: true });
    else setData((d) => ({ ...d, ...saved }));
  };

  const catIds = p.categories.map((c) => c.id ?? c);
  const brandId = p.brands[0]?.id ?? p.brands[0] ?? '';

  return (
    <>
      <PageHeader
        back={<Link to="/products" className="mb-1 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} /> Products</Link>}
        title={isNew ? 'New product' : p.name || 'Untitled'}
        subtitle={!isNew && <span className="flex items-center gap-2"><Badge tone={STATUS[p.status]?.tone}>{STATUS[p.status]?.label}</Badge> Last edited {dateTime(p.updated_at)}</span>}
        actions={<>
          {!isNew && p.status === 'publish' && <a href={`/product/${p.slug}/`} target="_blank" rel="noreferrer"><Button icon={ExternalLink}>View</Button></a>}
          {!isNew && can('manager') && <Button icon={Copy} onClick={async () => { const c = await run(() => api.post(`/admin/products/${id}/duplicate`), 'Copy created as draft'); navigate(`/products/${c.id}`); }}>Duplicate</Button>}
          {!isNew && can('manager') && <Button variant="danger" icon={Trash2} onClick={async () => {
            if (!(await confirm({ title: 'Delete this product?', message: 'If it was already sold, it is archived instead so your reports stay correct.', danger: true, confirmLabel: 'Delete' }))) return;
            await run(() => api.del(`/admin/products/${id}`), 'Product removed');
            navigate('/products');
          }} />}
          {!readOnly && <Button variant="primary" loading={busy} onClick={save} disabled={!dirty && !isNew}>Save</Button>}
        </>}
      />
      <fieldset disabled={readOnly} className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <div className="space-y-3">
              <Field label="Name"><Input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Maybelline Fit Me Foundation" /></Field>
              <Field label="Short description" hint="Shown next to the price on the product page"><RichText value={p.short_description} onChange={(v) => set({ short_description: v })} minHeight={70} /></Field>
              <Field label="Description"><RichText value={p.description} onChange={(v) => set({ description: v })} /></Field>
            </div>
          </Card>

          <Images images={p.images} onChange={(images) => set({ images })} />

          <Card title="Price">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Price"><Input prefix="$" type="number" step="0.01" value={p.regular_price ?? ''} onChange={(e) => set({ regular_price: e.target.value })} /></Field>
              <Field label="Sale price"><Input prefix="$" type="number" step="0.01" value={p.sale_price ?? ''} onChange={(e) => set({ sale_price: e.target.value })} /></Field>
              <Field label="Sale starts"><Input type="date" value={p.sale_from || ''} onChange={(e) => set({ sale_from: e.target.value })} /></Field>
              <Field label="Sale ends"><Input type="date" value={p.sale_to || ''} onChange={(e) => set({ sale_to: e.target.value })} /></Field>
              {can('manager') && <Field label="Cost price" hint="Never shown to customers"><Input prefix="$" type="number" step="0.01" value={p.purchase_price ?? ''} onChange={(e) => set({ purchase_price: e.target.value })} /></Field>}
              {can('manager') && <div className="col-span-1 flex items-end pb-2 text-[13px] text-zinc-500 sm:col-span-3">{margin(Number(p.sale_price) || Number(p.regular_price), Number(p.purchase_price))}</div>}
            </div>
            {p.type === 'variable' && <p className="mt-2 text-xs text-zinc-500">For products with options, each option has its own price below. These are used as defaults for new options.</p>}
          </Card>

          <Card title="Inventory">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="SKU / barcode" hint="Scanned at the POS"><Input value={p.sku || ''} onChange={(e) => set({ sku: e.target.value })} /></Field>
              {p.type !== 'variable' && (p.manage_stock
                ? <Field label="Quantity in stock"><Input type="number" value={p.stock_quantity ?? 0} onChange={(e) => set({ stock_quantity: e.target.value })} /></Field>
                : <Field label="Stock status"><Select value={p.stock_status} onChange={(e) => set({ stock_status: e.target.value })}><option value="instock">In stock</option><option value="outofstock">Out of stock</option><option value="onbackorder">On backorder</option></Select></Field>)}
              <Field label="Low stock alert at" hint="Default is 3"><Input type="number" value={p.low_stock_amount ?? ''} onChange={(e) => set({ low_stock_amount: e.target.value })} /></Field>
            </div>
            {p.type !== 'variable' && (
              <div className="mt-4 flex flex-wrap gap-6">
                <Toggle checked={p.manage_stock} onChange={(v) => set({ manage_stock: v, stock_quantity: p.stock_quantity ?? 0 })} label="Track quantity" description="Turn off for services or unlimited items" />
                {p.manage_stock && <Toggle checked={p.backorders !== 'no'} onChange={(v) => set({ backorders: v ? 'notify' : 'no' })} label="Sell when out of stock" description="Allows orders when quantity is 0" />}
              </div>
            )}
          </Card>

          <Card title="Product type & attributes">
            <div className="mb-4 flex gap-2">
              {[['simple', 'Single product'], ['variable', 'Product with options (shades, sizes…)']].map(([k, label]) => (
                <button key={k} type="button" onClick={() => set({ type: k })}
                  className={cx('rounded-md border px-3 py-2 text-left text-[13px]', p.type === k ? 'border-zinc-900 bg-zinc-50 font-medium' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300')}>{label}</button>
              ))}
            </div>
            <Attributes attributes={p.attributes} variable={p.type === 'variable'} onChange={(attributes) => set({ attributes })} />
          </Card>

          {p.type === 'variable' && <Variations product={p} setProduct={(np) => { setP(np); setDirty(true); }} />}

          <Card title="Related products">
            <div className="grid gap-4 sm:grid-cols-2">
              <LinkedProducts label="You may also like (upsells)" ids={p.upsell_ids || []} onChange={(upsell_ids) => set({ upsell_ids })} />
              <LinkedProducts label="Bought together (cross-sells)" ids={p.cross_sell_ids || []} onChange={(cross_sell_ids) => set({ cross_sell_ids })} />
            </div>
          </Card>

          <Card title="Search engines (SEO)">
            <div className="space-y-3">
              <Field label="URL" hint={`poudrebeauty.com/product/${p.slug || '…'}/`}><Input value={p.slug || ''} onChange={(e) => set({ slug: e.target.value })} placeholder="generated from the name" /></Field>
              <Field label="Page title"><Input value={p.seo?.title || ''} onChange={(e) => set({ seo: { ...p.seo, title: e.target.value } })} placeholder={p.name} /></Field>
              <Field label="Meta description"><Textarea rows={2} value={p.seo?.description || ''} onChange={(e) => set({ seo: { ...p.seo, description: e.target.value } })} /></Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Status & visibility">
            <div className="space-y-4">
              <Select value={p.status} onChange={(e) => set({ status: e.target.value })}>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
              <Toggle checked={p.online_visible} onChange={(v) => set({ online_visible: v })} label="Show on website" />
              <Toggle checked={p.pos_visible} onChange={(v) => set({ pos_visible: v })} label="Sell in POS" />
              <Toggle checked={p.featured} onChange={(v) => set({ featured: v })} label="Featured" description="Shown in featured sections" />
              <Field label="Shown in">
                <Select value={p.catalog_visibility} onChange={(e) => set({ catalog_visibility: e.target.value })}>
                  <option value="visible">Shop and search results</option><option value="catalog">Shop only</option><option value="search">Search results only</option><option value="hidden">Hidden (direct link only)</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Card title="Organisation">
            <div className="space-y-3">
              <Field label="Categories">
                <CategoryChecklist categories={categories || []} value={catIds} onChange={(ids) => set({ categories: ids.map((cid) => (categories || []).find((c) => c.id === cid) || { id: cid }) })} />
              </Field>
              <Field label="Brand">
                <Select value={brandId} onChange={(e) => set({ brands: e.target.value ? [{ id: Number(e.target.value) }] : [] })}>
                  <option value="">No brand</option>{(brands || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Tags" hint="Press Enter after each tag">
                <div className="mb-1 flex flex-wrap gap-1">
                  {p.tags.map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-[13px]">
                      {t.name ?? t}<button type="button" onClick={() => set({ tags: p.tags.filter((_, j) => j !== i) })} className="text-zinc-400 hover:text-zinc-900"><X size={12} /></button>
                    </span>
                  ))}
                </div>
                <Input className="h-8" placeholder="Add tag…" onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); set({ tags: [...p.tags, { name: e.target.value.trim() }] }); e.target.value = ''; }
                }} />
              </Field>
            </div>
          </Card>

          {can('manager') && (
            <Card title="Supplier">
              <div className="space-y-3">
                <Select value={p.supplier_id || ''} onChange={(e) => set({ supplier_id: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">No supplier</option>{(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
                <Field label="Supplier reference"><Input value={p.supplier_sku || ''} onChange={(e) => set({ supplier_sku: e.target.value })} /></Field>
                <Field label="Weight (kg)"><Input type="number" step="0.01" value={p.weight ?? ''} onChange={(e) => set({ weight: e.target.value })} /></Field>
              </div>
            </Card>
          )}

          {!isNew && loaded?.stats && (
            <Card title="Performance">
              <dl className="space-y-1.5 text-[13px]">
                <div className="flex justify-between"><dt className="text-zinc-500">Units sold</dt><dd className="num">{int(loaded.stats.sold)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Revenue</dt><dd className="num">{money(loaded.stats.revenue)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Last sold</dt><dd>{date(loaded.stats.last_sold)}</dd></div>
              </dl>
              <Link to={`/orders?product=${id}`} className="mt-3 block text-[13px] text-zinc-500 hover:text-zinc-900">See orders with this product →</Link>
            </Card>
          )}

          {!isNew && loaded?.movements?.length > 0 && (
            <Card title="Stock history" padded={false}>
              <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto text-[13px]">
                {loaded.movements.map((m) => (
                  <li key={m.id} className="flex items-center justify-between px-4 py-2">
                    <div>
                      <div className="capitalize">{m.reason}{m.ref_type === 'order' && m.ref_id ? <Link to={`/orders/${m.ref_id}`} className="ml-1 text-zinc-500 hover:underline">#{m.ref_id}</Link> : ''}</div>
                      <div className="text-xs text-zinc-400">{dateTime(m.created_at)}</div>
                    </div>
                    <div className="text-right">
                      <div className={cx('num font-medium', m.change > 0 ? 'text-emerald-700' : 'text-zinc-700')}>{m.change > 0 ? '+' : ''}{m.change}</div>
                      <div className="num text-xs text-zinc-400">→ {m.quantity_after}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </fieldset>
    </>
  );
}
