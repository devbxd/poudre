import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutGrid, ShoppingBag, Package, FolderTree, Tag, Boxes, Truck, ClipboardList, Users, TicketPercent, Star, BarChart3,
  Globe, Image, FileText, Menu as MenuIcon, Mail, Settings, Store, LogOut, Search, X, Monitor, Newspaper, Home,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { cx, Thumb, ErrorBoundary, Spinner } from './ui.jsx';

const NAV = [
  { items: [
    { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
    { to: '/pos', label: 'Point of sale', icon: Monitor },
  ] },
  { title: 'Sales', items: [
    { to: '/orders', label: 'Orders', icon: ShoppingBag },
    { to: '/customers', label: 'Customers', icon: Users },
    { to: '/coupons', label: 'Coupons', icon: TicketPercent, role: 'manager' },
    { to: '/reviews', label: 'Reviews', icon: Star },
  ] },
  { title: 'Catalogue', items: [
    { to: '/products', label: 'Products', icon: Package },
    { to: '/categories', label: 'Categories', icon: FolderTree },
    { to: '/brands', label: 'Brands', icon: Tag },
  ] },
  { title: 'Inventory', items: [
    { to: '/stock', label: 'Stock', icon: Boxes },
    { to: '/purchase-orders', label: 'Purchase orders', icon: ClipboardList, role: 'manager' },
    { to: '/suppliers', label: 'Suppliers', icon: Truck },
  ] },
  { title: 'Insights', items: [
    { to: '/reports', label: 'Reports', icon: BarChart3, role: 'manager' },
  ] },
  { title: 'Website', role: 'manager', items: [
    { to: '/website/homepage', label: 'Homepage', icon: Home },
    { to: '/website/menus', label: 'Menus', icon: MenuIcon },
    { to: '/website/pages', label: 'Pages', icon: FileText },
    { to: '/website/blog', label: 'Blog', icon: Newspaper },
    { to: '/media', label: 'Media', icon: Image },
    { to: '/messages', label: 'Messages', icon: Mail },
  ] },
  { items: [
    { to: '/settings', label: 'Settings', icon: Settings, role: 'manager' },
  ] },
];

function Sidebar({ onNavigate }) {
  const { staff, can, logout } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-zinc-900 text-[13px] font-bold text-white">P</div>
        <span className="font-semibold">Poudre Beauty</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {NAV.filter((g) => !g.role || can(g.role)).map((group, i) => (
          <div key={i} className="mt-3">
            {group.title && <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{group.title}</div>}
            {group.items.filter((it) => !it.role || can(it.role)).map((it) => (
              <NavLink
                key={it.to} to={it.to} end={it.end} onClick={onNavigate}
                className={({ isActive }) => cx('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px]',
                  isActive ? 'bg-zinc-200/70 font-medium text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900')}
              >
                <it.icon size={16} strokeWidth={1.8} />{it.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-zinc-200 p-3">
        <a href="/" target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-zinc-600 hover:bg-zinc-100">
          <Globe size={15} /> View website
        </a>
        <div className="flex items-center justify-between gap-2 px-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">{staff?.name}</div>
            <div className="text-xs capitalize text-zinc-500">{staff?.role}</div>
          </div>
          <button title="Log out" onClick={logout} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100"><LogOut size={16} /></button>
        </div>
      </div>
    </div>
  );
}

function CommandPalette({ open, onClose }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { if (!open) { setQ(''); setRes(null); } }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(() => api.get(`/admin/search?q=${encodeURIComponent(q)}`).then(setRes).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [q]);
  if (!open) return null;
  const go = (path) => { navigate(path); onClose(); };
  return (
    <div className="fixed inset-0 z-50 bg-black/30 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="mx-auto max-w-xl overflow-hidden rounded-lg bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4">
          <Search size={16} className="text-zinc-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, orders, customers…" className="h-12 flex-1 outline-none" />
          <kbd className="rounded border border-zinc-200 px-1.5 text-xs text-zinc-400">Esc</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!res && <p className="px-3 py-6 text-center text-zinc-400">Type at least 2 letters. You can also search by SKU, order number or phone.</p>}
          {res && !res.products.length && !res.orders.length && !res.customers.length && <p className="px-3 py-6 text-center text-zinc-400">No results</p>}
          {res?.products.length > 0 && <div className="px-2 pb-1 pt-2 text-xs font-medium text-zinc-400">Products</div>}
          {res?.products.map((p) => (
            <button key={p.id} onClick={() => go(`/products/${p.id}`)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100">
              <Thumb src={p.image} size={28} /><span className="flex-1 truncate">{p.name}</span><span className="text-xs text-zinc-400">{p.sku}</span>
            </button>
          ))}
          {res?.orders.length > 0 && <div className="px-2 pb-1 pt-2 text-xs font-medium text-zinc-400">Orders</div>}
          {res?.orders.map((o) => (
            <button key={o.id} onClick={() => go(`/orders/${o.id}`)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100">
              <span className="font-medium">#{o.number}</span><span className="flex-1 truncate text-zinc-500">{[o.first_name, o.last_name].join(' ')}</span><span className="num">{money(o.total)}</span>
            </button>
          ))}
          {res?.customers.length > 0 && <div className="px-2 pb-1 pt-2 text-xs font-medium text-zinc-400">Customers</div>}
          {res?.customers.map((c) => (
            <button key={c.id} onClick={() => go(`/customers/${c.id}`)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100">
              <span className="flex-1 truncate">{[c.first_name, c.last_name].join(' ') || c.email}</span><span className="text-xs text-zinc-400">{c.phone || c.email}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const location = useLocation();
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); }
      if (e.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-zinc-200 bg-zinc-50 lg:block"><Sidebar /></aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-64 bg-zinc-50" onClick={(e) => e.stopPropagation()}><Sidebar onNavigate={() => setMobileOpen(false)} /></aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur lg:px-6">
          <button className="rounded p-1.5 hover:bg-zinc-100 lg:hidden" onClick={() => setMobileOpen(true)}>{mobileOpen ? <X size={18} /> : <MenuIcon size={18} />}</button>
          <button onClick={() => setPalette(true)} className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-zinc-400 hover:border-zinc-300">
            <Search size={15} /><span className="flex-1 text-left">Search…</span><kbd className="hidden text-xs sm:block">Ctrl K</kbd>
          </button>
          <div className="flex-1" />
          <NavLink to="/pos" className="hidden h-9 items-center gap-2 rounded-md bg-zinc-900 px-3.5 font-medium text-white hover:bg-zinc-800 sm:flex"><Store size={15} /> Open POS</NavLink>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 lg:p-6"><ErrorBoundary key={location.pathname}><Suspense fallback={<Spinner />}><Outlet /></Suspense></ErrorBoundary></main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
