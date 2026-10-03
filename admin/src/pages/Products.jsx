import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Package, Plus, EyeOff } from 'lucide-react';
import { useFetch, useFilters } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { money, int } from '../lib/format.js';
import { Badge, Button, Card, Empty, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Tabs, Thumb, useAction, useToast } from '../components/ui.jsx';
import { categoryOptions } from '../components/pickers.jsx';
import { useAuth } from '../lib/auth.jsx';

export const STATUS = { publish: { label: 'Active', tone: 'green' }, draft: { label: 'Draft', tone: 'gray' }, private: { label: 'Private', tone: 'amber' }, archived: { label: 'Archived', tone: 'gray' } };

export function StockCell({ p }) {
  if (p.type === 'variable' && p.variations?.count) {
    const s = p.variations.stock;
    return <span className={s <= 0 ? 'text-red-600' : ''}>{s ?? '—'} <span className="text-zinc-400">in {p.variations.count} options</span></span>;
  }
  if (!p.manage_stock) return p.stock_status === 'outofstock' ? <span className="text-red-600">Out of stock</span> : <span className="text-zinc-500">Not tracked</span>;
  const q = p.stock_quantity;
  return <span className={q <= 0 ? 'font-medium text-red-600' : q <= 3 ? 'font-medium text-amber-700' : ''}>{q}</span>;
}

export function PriceCell({ p }) {
  if (p.type === 'variable' && p.variations?.count) {
    const { min, max } = p.variations;
    return min === max ? money(min) : <span>{money(min)} – {money(max)}</span>;
  }
  if (p.sale_price != null && Number(p.sale_price) < Number(p.regular_price)) {
    return <span><span className="text-zinc-400 line-through">{money(p.regular_price)}</span> {money(p.sale_price)}</span>;
  }
  return p.regular_price != null ? money(p.regular_price) : <span className="text-red-600">No price</span>;
}

function BulkModal({ action, ids, categories, brands, suppliers, onClose, onDone }) {
  const [value, setValue] = useState('');
  const [run, busy] = useAction();
  const titles = {
    add_category: 'Add to category', remove_category: 'Remove from category', set_brand: 'Set brand', supplier: 'Set supplier',
    price_percent: 'Change prices by %', sale_percent: 'Put on sale', status: 'Change status',
  };
  const opts = action.includes('category') ? categoryOptions(categories) : action === 'set_brand' ? brands : action === 'supplier' ? suppliers : null;
  return (
    <Modal open onClose={onClose} title={`${titles[action]} · ${ids.length} products`} width={440}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => {
        await run(() => api.post('/admin/products/bulk', { ids, action, value }), 'Products updated');
        onDone();
      }}>Apply</Button></>}>
      {opts && (
        <Select value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">{action === 'set_brand' || action === 'supplier' ? 'None' : 'Choose…'}</option>
          {opts.map((o) => <option key={o.id} value={o.id}>{o.label || o.name}</option>)}
        </Select>
      )}
      {action === 'status' && (
        <Select value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Choose…</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      )}
      {action === 'price_percent' && <><Input suffix="%" type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="10 or -10" /><p className="mt-2 text-[13px] text-zinc-500">Raises (or lowers with a minus) the regular price of the selected products and their options.</p></>}
      {action === 'sale_percent' && <><Input suffix="% off" type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="20" /><p className="mt-2 text-[13px] text-zinc-500">Sets a sale price X% below the regular price. Enter 0 to remove the sale.</p></>}
    </Modal>
  );
}

export default function Products() {
  const [f, setF] = useFilters({ page: '1' });
  const navigate = useNavigate();
  const { can } = useAuth();
  const { confirm } = useToast();
  const [selected, setSelected] = useState(new Set());
  const [bulk, setBulk] = useState(null);
  const [run] = useAction();
  const { data, loading, reload } = useFetch(`/admin/products${qs({ ...f, per_page: 50 })}`);
  const { data: categories } = useFetch('/admin/categories');
  const { data: brands } = useFetch('/admin/brands');
  const { data: suppliers } = useFetch('/admin/suppliers');
  const catOpts = useMemo(() => categoryOptions(categories || []), [categories]);

  const doBulk = async (action) => {
    const ids = [...selected];
    if (['add_category', 'remove_category', 'set_brand', 'supplier', 'price_percent', 'sale_percent', 'status'].includes(action)) return setBulk(action);
    if (action === 'delete' && !(await confirm({ title: `Delete ${ids.length} products?`, message: 'Products that were already sold are archived instead, so your reports stay correct.', danger: true, confirmLabel: 'Delete' }))) return;
    const [a, value] = action.split(':');
    await run(() => api.post('/admin/products/bulk', { ids, action: a, value: value === 'true' ? true : value === 'false' ? false : value }), 'Products updated');
    setSelected(new Set());
    reload();
  };

  return (
    <>
      <PageHeader
        title="Products"
        subtitle={data ? `${int(data.total)} products` : ' '}
        actions={can('manager') && <Link to="/products/new"><Button variant="primary" icon={Plus}>Add product</Button></Link>}
      />
      <Card padded={false}>
        <Tabs className="px-2" value={f.status || ''} onChange={(v) => setF({ status: v })}
          tabs={[{ value: '', label: 'All' }, { value: 'publish', label: 'Active' }, { value: 'draft', label: 'Drafts' }, { value: 'private', label: 'Private' }, { value: 'archived', label: 'Archived' }]} />
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3">
          <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Name, SKU or barcode…" className="w-full sm:w-64" />
          <Select value={f.category || ''} onChange={(e) => setF({ category: e.target.value })} className="w-48">
            <option value="">All categories</option>{catOpts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          <Select value={f.brand || ''} onChange={(e) => setF({ brand: e.target.value })} className="w-40">
            <option value="">All brands</option>{(brands || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select value={f.stock || ''} onChange={(e) => setF({ stock: e.target.value })} className="w-36">
            <option value="">Any stock</option><option value="in">In stock</option><option value="low">Running low</option><option value="out">Out of stock</option><option value="negative">Negative stock</option>
          </Select>
          <Select value={f.issue || ''} onChange={(e) => setF({ issue: e.target.value })} className="w-40">
            <option value="">Data issues…</option><option value="no_image">No image</option><option value="no_sku">No SKU / barcode</option><option value="no_price">No price</option><option value="no_cost">No cost price</option>
          </Select>
          <Select value={f.sort || ''} onChange={(e) => setF({ sort: e.target.value })} className="w-40">
            <option value="">Newest first</option><option value="-updated">Recently edited</option><option value="name">Name A–Z</option><option value="-sales">Best sellers</option>
            <option value="price">Price low → high</option><option value="-price">Price high → low</option><option value="stock">Stock low → high</option>
          </Select>
          {(f.q || f.category || f.brand || f.stock || f.issue || f.supplier || f.online) && <Button variant="ghost" size="sm" onClick={() => setF({ q: '', category: '', brand: '', stock: '', issue: '', supplier: '', online: '' })}>Clear</Button>}
        </div>
        {selected.size > 0 && can('manager') && (
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
            <span className="text-[13px] font-medium">{selected.size} selected</span>
            <Select className="w-56" value="" onChange={(e) => e.target.value && doBulk(e.target.value)}>
              <option value="">Bulk actions…</option>
              <option value="status">Change status</option>
              <option value="add_category">Add to category</option>
              <option value="remove_category">Remove from category</option>
              <option value="set_brand">Set brand</option>
              <option value="supplier">Set supplier</option>
              <option value="price_percent">Change prices by %</option>
              <option value="sale_percent">Put on sale / remove sale</option>
              <option value="online_visible:true">Show on website</option>
              <option value="online_visible:false">Hide from website</option>
              <option value="pos_visible:true">Show in POS</option>
              <option value="pos_visible:false">Hide from POS</option>
              <option value="featured:true">Mark as featured</option>
              <option value="featured:false">Remove featured</option>
              <option value="delete">Delete</option>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
          </div>
        )}
        {!data ? <Spinner /> : (
          <div className={loading ? 'opacity-60' : ''}>
            <Table
              rows={data.items} selectable={can('manager')} selected={selected} onSelect={setSelected}
              onRowClick={(p) => navigate(`/products/${p.id}`)}
              empty={<Empty icon={Package} title="No products found" text="Try other filters or add a new product." />}
              columns={[
                { key: 'name', label: 'Product', render: (p) => (
                  <div className="flex items-center gap-3">
                    <Thumb src={p.image} size={40} />
                    <div className="min-w-0 max-w-[340px]">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                        {p.sku || <span className="text-amber-700">No SKU</span>}
                        {!p.online_visible && <span title="Hidden from website" className="inline-flex items-center gap-0.5"><EyeOff size={11} /> Website</span>}
                        {p.featured && <span>· Featured</span>}
                      </div>
                    </div>
                  </div>
                ) },
                { key: 'status', label: 'Status', render: (p) => <Badge tone={STATUS[p.status]?.tone}>{STATUS[p.status]?.label}</Badge> },
                { key: 'stock', label: 'Stock', render: (p) => <StockCell p={p} /> },
                { key: 'price', label: 'Price', render: (p) => <span className="num whitespace-nowrap"><PriceCell p={p} /></span> },
                { key: 'categories', label: 'Category', render: (p) => <span className="block max-w-[180px] truncate text-zinc-600">{p.categories.map((c) => c.name).join(', ') || <span className="text-amber-700">None</span>}</span> },
                { key: 'brand', label: 'Brand', render: (p) => <span className="text-zinc-600">{p.brands[0]?.name || '—'}</span> },
                { key: 'sales', label: 'Sold', align: 'right', render: (p) => int(p.total_sales) },
              ]}
            />
            <Pagination page={data.page} perPage={data.per_page} total={data.total} onChange={(page) => setF({ page: String(page) })} />
          </div>
        )}
      </Card>
      {bulk && <BulkModal action={bulk} ids={[...selected]} categories={categories || []} brands={brands || []} suppliers={suppliers || []}
        onClose={() => setBulk(null)} onDone={() => { setBulk(null); setSelected(new Set()); reload(); }} />}
    </>
  );
}
