// Keeps the database awake during shop hours (8:00–20:00 Beirut time) so the dashboard and the POS never wait for it
// to wake up. Neon puts it to sleep after 5 minutes without a query; a tiny query every 4 minutes prevents that.
// Outside these hours it sleeps (that is what keeps the database inside the free plan: ~12 h × 0.25 = ~90 h a month).
import postgres from 'postgres';

const OPEN = 8;
const CLOSE = 20;

export default async () => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Beirut' }).format(new Date()));
  if (hour < OPEN || hour >= CLOSE || !process.env.DATABASE_URL) return new Response('closed');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 20 });
  try {
    await sql`select 1`;
    return new Response('awake');
  } finally {
    await sql.end({ timeout: 5 });
  }
};

export const config = { schedule: '*/4 * * * *' };
