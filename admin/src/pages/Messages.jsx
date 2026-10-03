import { Mail, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { dateTime } from '../lib/format.js';
import { Badge, Button, Card, Empty, PageHeader, Spinner, cx, useAction } from '../components/ui.jsx';

export default function Messages() {
  const { data, reload, setData } = useFetch('/admin/messages');
  const [run] = useAction();
  const markRead = async (m) => {
    if (m.read) return;
    setData((d) => d.map((x) => (x.id === m.id ? { ...x, read: true } : x)));
    await api.put(`/admin/messages/${m.id}`, { read: true });
  };
  return (
    <>
      <PageHeader title="Messages" subtitle="Contact form messages and newsletter sign-ups from the website" />
      <Card padded={false}>
        {!data ? <Spinner /> : !data.length ? <Empty icon={Mail} title="No messages yet" /> : (
          <ul className="divide-y divide-zinc-100">
            {data.map((m) => (
              <li key={m.id} onClick={() => markRead(m)} className={cx('flex gap-4 px-4 py-3', !m.read && 'bg-sky-50/40')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {!m.read && <span className="h-2 w-2 rounded-full bg-sky-600" />}
                    <span className="font-medium">{m.name || m.email}</span>
                    <Badge>{m.kind === 'newsletter' ? 'Newsletter' : 'Contact form'}</Badge>
                    <span className="text-xs text-zinc-400">{dateTime(m.created_at)}</span>
                  </div>
                  <div className="text-[13px] text-zinc-500">{[m.email, m.phone].filter(Boolean).join(' · ')}</div>
                  {m.subject && <div className="mt-1 font-medium">{m.subject}</div>}
                  {m.body && <p className="mt-0.5 whitespace-pre-wrap text-zinc-700">{m.body}</p>}
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  {m.email && <a href={`mailto:${m.email}`}><Button size="sm">Reply</Button></a>}
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={async (e) => { e.stopPropagation(); await run(() => api.del(`/admin/messages/${m.id}`), 'Deleted'); reload(); }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
