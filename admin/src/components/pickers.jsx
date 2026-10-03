import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, fullName } from '../lib/format.js';
import { Thumb, cx } from './ui.jsx';

/** Generic async search box with a dropdown. */
function AsyncSearch({ placeholder, load, renderItem, onPick, clearOnPick = true, className, autoFocus }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef();
  useEffect(() => {
    if (!q.trim()) { setItems([]); return; }
    const t = setTimeout(() => load(q.trim()).then((r) => { setItems(r); setActive(0); setOpen(true); }).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line
  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const pick = (it) => { onPick(it); if (clearOnPick) setQ(''); setOpen(false); };
  return (
    <div ref={box} className={cx('relative', className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
      <input
        autoFocus={autoFocus} value={q} placeholder={placeholder}
        onChange={(e) => setQ(e.target.value)} onFocus={() => items.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && items[active]) { e.preventDefault(); pick(items[active]); }
        }}
        className="h-9 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
      />
      {open && q && (
        <div className="absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg">
          {items.length ? items.map((it, i) => (
            <button type="button" key={i} onMouseEnter={() => setActive(i)} onClick={() => pick(it)}
              className={cx('flex w-full items-center gap-3 rounded px-2 py-1.5 text-left', i === active && 'bg-zinc-100')}>
              {renderItem(it)}
            </button>
          )) : <div className="px-3 py-3 text-zinc-400">No results</div>}
        </div>
      )}
    </div>
  );
}

export function ProductSearch({ onPick, variations = true, placeholder = 'Search products by name or SKU…', ...props }) {
  return (
    <AsyncSearch
      {...props} placeholder={placeholder} onPick={onPick}
      load={(q) => api.get(`/admin/lookup${qs({ q, variations: variations ? 1 : '' })}`)}
      renderItem={(p) => (
        <>
          <Thumb src={p.image} size={30} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{p.name}</span>
            <span className="block text-xs text-zinc-500">{p.sku || 'No SKU'}{p.stock_quantity != null && ` · ${p.stock_quantity} in stock`}{p.type === 'variable' && ' · has options'}</span>
          </span>
          <span className="num text-zinc-600">{money(p.sale_price ?? p.regular_price)}</span>
        </>
      )}
    />
  );
}

export function CustomerSearch({ onPick, ...props }) {
  return (
    <AsyncSearch
      {...props} placeholder="Search customer by name, phone or email…" onPick={onPick}
      load={(q) => api.get(`/admin/customers${qs({ q, per_page: 10 })}`).then((r) => r.items)}
      renderItem={(c) => (
        <span className="min-w-0 flex-1">
          <span className="block truncate">{fullName(c) || c.email || c.phone}</span>
          <span className="block text-xs text-zinc-500">{[c.phone, c.email].filter(Boolean).join(' · ')}{c.order_count ? ` · ${c.order_count} orders` : ''}</span>
        </span>
      )}
    />
  );
}

/** Multi-select of ids from a list of {id,name}. */
export function MultiSelect({ options, value = [], onChange, placeholder = 'Add…' }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef();
  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const chosen = value.map((id) => options.find((o) => o.id === id)).filter(Boolean);
  const filtered = options.filter((o) => !value.includes(o.id) && o.name.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <div ref={box} className="relative">
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-zinc-300 bg-white p-1 focus-within:border-zinc-900 focus-within:ring-1 focus-within:ring-zinc-900" onClick={() => setOpen(true)}>
        {chosen.map((o) => (
          <span key={o.id} className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-[13px]">
            {o.label || o.name}
            <button type="button" onClick={(e) => { e.stopPropagation(); onChange(value.filter((v) => v !== o.id)); }} className="text-zinc-400 hover:text-zinc-900"><X size={12} /></button>
          </span>
        ))}
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} placeholder={chosen.length ? '' : placeholder} className="h-7 min-w-[80px] flex-1 px-1 outline-none" />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg">
          {filtered.map((o) => (
            <button type="button" key={o.id} onClick={() => { onChange([...value, o.id]); setQ(''); }} className="block w-full truncate rounded px-2 py-1.5 text-left hover:bg-zinc-100">{o.label || o.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Builds indented labels for a category tree: "Makeup › Lips". */
export function categoryOptions(categories) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path = (c) => {
    const parts = [c.name];
    let p = c.parent_id && byId.get(c.parent_id);
    let guard = 0;
    while (p && guard++ < 10) { parts.unshift(p.name); p = p.parent_id && byId.get(p.parent_id); }
    return parts.join(' › ');
  };
  return categories.map((c) => ({ id: c.id, name: c.name, label: path(c) })).sort((a, b) => a.label.localeCompare(b.label));
}
