import { useRef, useState } from 'react';
import { Upload, Check } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { Button, Modal, Pagination, SearchInput, Spinner, cx, sized, useAction } from './ui.jsx';

/**
 * Phone photos (4–10 MB) are shrunk on the device before sending: 2000 px on the long side is plenty for the website,
 * the upload is 10–20× faster on a mobile connection and stays under the server's 6 MB limit. Transparent PNGs keep
 * their transparency (WebP, or PNG when the browser cannot write WebP).
 */
const MAX_SIDE = 2000;
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && !/heic|heif/i.test(file.type)) { bmp.close?.(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const toBlob = (type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
    let blob;
    if (/png|webp/i.test(file.type)) {
      blob = await toBlob('image/webp', 0.88);
      if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/png');
    } else blob = await toBlob('image/jpeg', 0.86);
    if (!blob || blob.size >= file.size) return file;
    const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type: blob.type });
  } catch {
    return file; // the browser cannot read it: send as is
  }
}

export function useUpload() {
  const [run, busy] = useAction();
  // the button spins while the photos are shrunk and sent
  // one photo per request: several photos together never go over the server's limit
  const upload = (files) => run(async () => {
    const out = [];
    for (const f of files) {
      const form = new FormData();
      form.append('file', await shrink(f));
      const r = await api.upload('/admin/media', form);
      out.push(...(Array.isArray(r) ? r : [r]));
    }
    return out;
  }, `${files.length} image${files.length > 1 ? 's' : ''} uploaded`);
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
