import { Component, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Search, Loader2, Check, AlertCircle } from 'lucide-react';

export const cx = (...c) => c.filter(Boolean).join(' ');
// inputs are full width unless a width class is given
const widthOf = (className) => (/(^|\s)(w-|flex-1)/.test(className || '') ? '' : 'w-full');

// ---------- Buttons ----------
const BTN = {
  primary: 'bg-zinc-900 text-white hover:bg-zinc-800 border border-zinc-900',
  secondary: 'bg-white text-zinc-900 hover:bg-zinc-50 border border-zinc-300',
  ghost: 'bg-transparent text-zinc-700 hover:bg-zinc-100 border border-transparent',
  danger: 'bg-white text-red-600 hover:bg-red-50 border border-zinc-300',
};
export function Button({ variant = 'secondary', size = 'md', loading, icon: Icon, children, className, ...props }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : size === 'lg' ? 'h-11 px-5 text-[15px]' : 'h-9 px-3.5',
        BTN[variant], className,
      )}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : Icon ? <Icon size={15} strokeWidth={2} /> : null}
      {children}
    </button>
  );
}

// ---------- Form fields ----------
export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="mb-1 block text-[13px] font-medium text-zinc-700">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const INPUT = 'h-9 rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 disabled:bg-zinc-50 placeholder:text-zinc-400';
export function Input({ className, prefix, suffix, ...props }) {
  if (prefix || suffix) {
    return (
      <div className={cx('flex h-9 items-center rounded-md border border-zinc-300 bg-white focus-within:border-zinc-900 focus-within:ring-1 focus-within:ring-zinc-900', className)}>
        {prefix && <span className="pl-3 text-zinc-500">{prefix}</span>}
        <input {...props} className="h-full w-full min-w-0 bg-transparent px-2 outline-none placeholder:text-zinc-400" />
        {suffix && <span className="pr-3 text-zinc-500">{suffix}</span>}
      </div>
    );
  }
  return <input {...props} className={cx(INPUT, widthOf(className), className)} />;
}
export function Textarea({ className, ...props }) {
  return <textarea {...props} className={cx(INPUT, widthOf(className), 'h-auto min-h-[80px] py-2', className)} />;
}
export function Select({ className, children, ...props }) {
  return <select {...props} className={cx(INPUT, widthOf(className), 'pr-8', className)}>{children}</select>;
}
export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className={cx('flex items-start gap-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button
        type="button" role="switch" aria-checked={!!checked} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-zinc-900' : 'bg-zinc-300')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {(label || description) && (
        <span>
          {label && <span className="block font-medium">{label}</span>}
          {description && <span className="block text-[13px] text-zinc-500">{description}</span>}
        </span>
      )}
    </label>
  );
}
export function Checkbox({ checked, onChange, label, indeterminate, className }) {
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2', className)} onClick={(e) => e.stopPropagation()}>
      <input ref={ref} type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-zinc-900" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search', className, autoFocus, delay = 250 }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  useEffect(() => {
    if (v === (value || '')) return;
    const t = setTimeout(() => onChange(v), delay);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line
  return (
    <div className={cx('relative', className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
      <input autoFocus={autoFocus} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className={cx(INPUT, 'w-full pl-9')} />
    </div>
  );
}

// ---------- Display ----------
const TONES = {
  gray: 'bg-zinc-100 text-zinc-700',
  green: 'bg-emerald-50 text-emerald-700',
  blue: 'bg-sky-50 text-sky-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
};
export function Badge({ tone = 'gray', children, className }) {
  return <span className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone], className)}>{children}</span>;
}

export function Card({ title, actions, children, className, padded = true }) {
  return (
    <section className={cx('rounded-lg border border-zinc-200 bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, text, action, icon: Icon }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && <Icon size={28} className="mb-3 text-zinc-300" />}
      <p className="font-medium">{title}</p>
      {text && <p className="mt-1 max-w-sm text-zinc-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }) {
  return <div className={cx('flex justify-center py-12 text-zinc-400', className)}><Loader2 className="animate-spin" size={22} /></div>;
}

/** Pre-generated square copy of an uploaded image (150 or 500 px) instead of the full-size original */
export function sized(url, px = 150) {
  if (!url || !/^\/wp-content\/uploads\/.+\.(jpe?g|png|webp)$/i.test(url) || /-\d+x\d+\.[a-z]+$/i.test(url)) return url;
  const s = px <= 150 ? 150 : 500;
  return url.replace(/(-scaled)?\.([a-z]+)$/i, `-${s}x${s}.$2`);
}

export function Thumb({ src, size = 40, className, crop = true }) {
  return src
    ? <img src={crop ? sized(src, size * 2) : src} alt="" loading="lazy" style={{ width: size, height: size }} className={cx('shrink-0 rounded border border-zinc-200 bg-white object-cover', className)} />
    : <div style={{ width: size, height: size }} className={cx('shrink-0 rounded border border-zinc-200 bg-zinc-100', className)} />;
}

export function Pagination({ page, perPage, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total <= perPage) return null;
  return (
    <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 text-[13px] text-zinc-600">
      <span className="num">{((page - 1) * perPage + 1).toLocaleString()}–{Math.min(page * perPage, total).toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => onChange(page - 1)} />
        <span className="num px-2">Page {page} / {pages}</span>
        <Button size="sm" variant="ghost" icon={ChevronRight} disabled={page >= pages} onClick={() => onChange(page + 1)} />
      </div>
    </div>
  );
}

/** Simple table. columns: [{key, label, render, align, width, className}] */
export function Table({ columns, rows, onRowClick, selectable, selected, onSelect, rowKey = 'id', empty, dense }) {
  const all = rows.length > 0 && rows.every((r) => selected?.has(r[rowKey]));
  const some = rows.some((r) => selected?.has(r[rowKey]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-200 text-xs font-medium text-zinc-500">
            {selectable && (
              <th className="w-10 px-4 py-2.5">
                <Checkbox checked={all} indeterminate={!all && some} onChange={(v) => {
                  const next = new Set(selected);
                  rows.forEach((r) => (v ? next.add(r[rowKey]) : next.delete(r[rowKey])));
                  onSelect(next);
                }} />
              </th>
            )}
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width }} className={cx('px-4 py-2.5 font-medium whitespace-nowrap', c.align === 'right' && 'text-right', c.headClassName)}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r[rowKey]}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cx('border-b border-zinc-100 last:border-0', onRowClick && 'cursor-pointer hover:bg-zinc-50', selected?.has(r[rowKey]) && 'bg-zinc-50')}
            >
              {selectable && (
                <td className="px-4" onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected.has(r[rowKey])} onChange={(v) => {
                    const next = new Set(selected);
                    v ? next.add(r[rowKey]) : next.delete(r[rowKey]);
                    onSelect(next);
                  }} />
                </td>
              )}
              {columns.map((c) => (
                <td key={c.key} className={cx('px-4', dense ? 'py-1.5' : 'py-2.5', c.align === 'right' && 'text-right num', c.className)}>
                  {c.render ? c.render(r) : r[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (empty || <Empty title="Nothing here yet" />)}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('flex gap-1 overflow-x-auto border-b border-zinc-200', className)}>
      {tabs.map((t) => (
        <button
          key={t.value} type="button" onClick={() => onChange(t.value)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium',
            value === t.value ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-800')}
        >
          {t.label}{t.count !== undefined && <span className="num ml-1.5 text-zinc-400">{t.count.toLocaleString()}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Overlays ----------
export function Modal({ open, onClose, title, children, footer, width = 520 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:pt-[8vh]" onMouseDown={onClose}>
      <div className="w-full rounded-lg bg-white shadow-xl" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-100"><X size={17} /></button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Toasts & confirm ----------
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const push = useCallback((message, tone = 'success') => {
    const id = Math.random();
    setItems((x) => [...x, { id, message, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'error' ? 6000 : 3000);
  }, []);
  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);
  return (
    <ToastCtx.Provider value={{ toast: push, confirm }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={cx('flex max-w-sm items-start gap-2 rounded-md px-3.5 py-2.5 text-white shadow-lg', t.tone === 'error' ? 'bg-red-600' : 'bg-zinc-900')}>
            {t.tone === 'error' ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <Check size={16} className="mt-0.5 shrink-0" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      <Modal
        open={!!confirmState} title={confirmState?.title || 'Are you sure?'} width={420}
        onClose={() => { confirmState?.resolve(false); setConfirmState(null); }}
        footer={<>
          <Button onClick={() => { confirmState.resolve(false); setConfirmState(null); }}>Cancel</Button>
          <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => { confirmState.resolve(true); setConfirmState(null); }}>{confirmState?.confirmLabel || 'Confirm'}</Button>
        </>}
      >
        <p className="text-zinc-600">{confirmState?.message}</p>
      </Modal>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Runs an async action with toast feedback. */
export function useAction() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success) => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      toast(e.message, 'error');
      throw e;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}

/** Catches a crashing page so the rest of the dashboard keeps working (reset when the page changes) */
export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto mt-16 max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-center">
        <p className="font-medium">This page could not be displayed</p>
        <p className="mt-1 text-[13px] text-zinc-500">{String(this.state.error?.message || this.state.error)}</p>
        <button className="mt-4 rounded-md bg-zinc-900 px-3 py-1.5 text-[13px] text-white" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
