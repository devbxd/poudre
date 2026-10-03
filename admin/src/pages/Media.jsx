import { useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { date } from '../lib/format.js';
import { Button, Card, Field, Input, Modal, PageHeader, Pagination, SearchInput, Spinner, useAction, useToast } from '../components/ui.jsx';
import { UploadButton } from '../components/MediaPicker.jsx';

export default function Media() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const { data, reload } = useFetch(`/admin/media${qs({ q, page, per_page: 60 })}`);
  const { toast, confirm } = useToast();
  const [run] = useAction();
  return (
    <>
      <PageHeader title="Media" subtitle={data ? `${data.total.toLocaleString()} images · Photos are resized and optimised automatically when uploaded` : ' '}
        actions={<UploadButton variant="primary" onUploaded={reload}>Upload images</UploadButton>} />
      <Card>
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by file name…" className="mb-4 w-72" />
        {!data ? <Spinner /> : (
          <>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-10">
              {data.items.map((m) => (
                <button key={m.id} onClick={() => setOpen(m)} className="aspect-square overflow-hidden rounded border border-zinc-200 bg-zinc-50 hover:border-zinc-400">
                  <img src={m.url} alt={m.alt} loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            <Pagination page={page} perPage={60} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.filename} width={720}
        footer={<>
          <Button variant="danger" icon={Trash2} className="mr-auto" onClick={async () => {
            if (!(await confirm({ title: 'Delete this image?', message: 'Products or pages that use it will show an empty image.', danger: true, confirmLabel: 'Delete' }))) return;
            await run(() => api.del(`/admin/media/${open.id}`), 'Image deleted');
            setOpen(null); reload();
          }}>Delete</Button>
          <Button icon={Copy} onClick={() => { navigator.clipboard.writeText(location.origin + open.url); toast('Link copied'); }}>Copy link</Button>
          <Button variant="primary" onClick={async () => { await run(() => api.put(`/admin/media/${open.id}`, { alt: open.alt }), 'Saved'); setOpen(null); reload(); }}>Save</Button>
        </>}>
        {open && (
          <div className="grid gap-4 sm:grid-cols-2">
            <img src={open.url} alt="" className="max-h-80 w-full rounded border border-zinc-200 object-contain" />
            <div className="space-y-3 text-[13px]">
              <Field label="Alt text" hint="Describes the image for Google and screen readers"><Input value={open.alt || ''} onChange={(e) => setOpen({ ...open, alt: e.target.value })} /></Field>
              <div className="text-zinc-500">{open.width && `${open.width} × ${open.height} px · `}{open.mime}</div>
              <div className="text-zinc-500">Uploaded {date(open.created_at)}</div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
