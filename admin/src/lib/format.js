export const money = (v, currency = '$') => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return `${n < 0 ? '-' : ''}${currency}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const int = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US'));
export const pct = (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%`;
export const change = (cur, prev) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : cur ? 100 : 0);

const tz = 'Asia/Beirut';
export const date = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }) : '—');
export const dateTime = (v) => (v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz }) : '—');
export const time = (v) => (v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }) : '');
export const ago = (v) => {
  if (!v) return '—';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return date(v);
};
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: tz });
export const daysAgo = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: tz });
export const fullName = (o) => [o?.first_name, o?.last_name].filter(Boolean).join(' ').trim();

export const ORDER_STATUS = {
  pending: { label: 'Pending payment', tone: 'amber' },
  processing: { label: 'Processing', tone: 'blue' },
  'on-hold': { label: 'On hold', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
  refunded: { label: 'Refunded', tone: 'red' },
  failed: { label: 'Failed', tone: 'red' },
};
export const CHANNEL = { pos: 'In store', online: 'Website', manual: 'Manual' };
