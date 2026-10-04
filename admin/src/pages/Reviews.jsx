import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Star, Trash2, Ban } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { date } from '../lib/format.js';
import { Badge, Button, Card, Empty, PageHeader, Spinner, Tabs, useAction } from '../components/ui.jsx';

export default function Reviews() {
  const [status, setStatus] = useState('pending');
  const { data, reload } = useFetch(`/admin/reviews${status ? `?status=${status}` : ''}`);
  const [run] = useAction();
  const act = async (r, s) => { await run(() => api.put(`/admin/reviews/${r.id}`, { status: s }), s === 'approved' ? 'Review published' : 'Review updated'); reload(); };
  return (
    <>
      <PageHeader title="Reviews" subtitle="Customer reviews appear on the product page once approved" />
      <Card padded={false}>
        <div className="flex items-center justify-between pr-3">
          <Tabs className="px-2" value={status} onChange={setStatus} tabs={[{ value: 'pending', label: 'Waiting' }, { value: 'approved', label: 'Published' }, { value: 'spam', label: 'Spam' }, { value: '', label: 'All' }]} />
          {status === 'spam' && data?.length > 0 && (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => {
              if (!confirm(`Delete all ${data.length} spam reviews? This cannot be undone.`)) return;
              await run(() => api.del('/admin/reviews/spam'), 'Spam deleted'); reload();
            }}>Empty spam</Button>
          )}
        </div>
        {!data ? <Spinner /> : !data.length ? <Empty icon={Star} title="No reviews here" /> : (
          <ul className="divide-y divide-zinc-100">
            {data.map((r) => (
              <li key={r.id} className="flex gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-amber-500">{'★'.repeat(r.rating || 0)}<span className="text-zinc-300">{'★'.repeat(5 - (r.rating || 0))}</span></span>
                    <span className="font-medium">{r.author}</span>
                    {r.verified && <Badge tone="green">Verified buyer</Badge>}
                    <span className="text-xs text-zinc-400">{date(r.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-zinc-700">{r.content}</p>
                  {r.product_name && <Link to={`/products/${r.product_id}`} className="mt-1 inline-block text-[13px] text-zinc-500 hover:underline">on {r.product_name}</Link>}
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  {r.status !== 'approved' && <Button size="sm" icon={Check} onClick={() => act(r, 'approved')}>Publish</Button>}
                  {r.status === 'approved' && <Button size="sm" onClick={() => act(r, 'pending')}>Unpublish</Button>}
                  {r.status !== 'spam' && <Button size="sm" variant="ghost" icon={Ban} title="Spam" onClick={() => act(r, 'spam')} />}
                  <Button size="sm" variant="ghost" icon={Trash2} title="Delete" onClick={async () => { await run(() => api.del(`/admin/reviews/${r.id}`), 'Review deleted'); reload(); }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
