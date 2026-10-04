import { useRef, useState } from 'react';
import { Upload, Check } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { Button, Modal, Pagination, SearchInput, Spinner, cx, sized, useAction } from './ui.jsx';

export function useUpload() {
  const [run, busy] = useAction();
  const upload = async (files) => {
    const form = new FormData();
    for (const f of files) form.append('file', f);
    return run(() => api.upload('/admin/media', form), `${files.length} image${files.length > 1 ? 's' : ''} uploaded`);
  };
  return [upload, busy];
}

export function UploadButton({ onUploaded, multiple = true, children = 'Upload', ...props }) {
  const input = useRef();
  const [upload, busy] = useUpload();
  return (
    <>
      <input ref={input} type="file" accept="image/*" multiple={multiple} hidden onChange={async (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        if (files.length) onUploaded(await upload(files));
      }} />
      <Button icon={Upload} loading={busy} onClick={() => input.current.click()} {...props}>{children}</Button>
    </>
  );
}

/** Media library picker. onPick receives an array of media rows. */
export function MediaPicker({ open, onClose, onPick, multiple = false }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState([]);
  const { data, reload } = useFetch(open ? `/admin/media${qs({ q, page, per_page: 48 })}` : null);
  const toggle = (m) => {
    if (!multiple) { onPick([m]); onClose(); return; }
    setChosen((c) => (c.some((x) => x.id === m.id) ? c.filter((x) => x.id !== m.id) : [...c, m]));
  };
  return (
    <Modal open={open} onClose={onClose} title="Choose images" width={880}
      footer={multiple && <><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!chosen.length} onClick={() => { onPick(chosen); setChosen([]); onClose(); }}>Add {chosen.length || ''} image{chosen.length === 1 ? '' : 's'}</Button></>}>
      <div className="mb-3 flex gap-2">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by file name…" className="flex-1" />
        <UploadButton variant="primary" onUploaded={(rows) => { reload(); if (!multiple) { onPick(rows.slice(0, 1)); onClose(); } else setChosen((c) => [...c, ...rows]); }} />
      </div>
      {!data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {data.items.map((m) => {
              const on = chosen.some((x) => x.id === m.id);
              return (
                <button key={m.id} type="button" onClick={() => toggle(m)} title={m.filename}
                  className={cx('relative aspect-square overflow-hidden rounded border bg-zinc-50', on ? 'border-zinc-900 ring-2 ring-zinc-900' : 'border-zinc-200 hover:border-zinc-400')}>
                  <img src={sized(m.url, 300)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  {on && <span className="absolute right-1 top-1 rounded-full bg-zinc-900 p-0.5 text-white"><Check size={12} /></span>}
                </button>
              );
            })}
          </div>
          <Pagination page={page} perPage={48} total={data.total} onChange={setPage} />
        </>
      )}
    </Modal>
  );
}
