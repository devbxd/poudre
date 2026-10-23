// Keeps the database awake while the shop is working: for 30 minutes after the last use of the dashboard or the POS
// (the app writes data/last-staff-activity), so a click never waits for Neon to wake up. When nobody works it sleeps:
// Neon's free plan allows 100 compute hours a month. Run every 4 minutes by a systemd timer (Neon sleeps after 5).
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const KEEP_FOR = 30 * 60e3;
const last = Number(await readFile('data/last-staff-activity', 'utf8').catch(() => '0'));
if (!process.env.DATABASE_URL || Date.now() - last > KEEP_FOR) {
  console.log('idle: database left to sleep');
  process.exit(0);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 20 });
await sql`select 1`;
await sql.end({ timeout: 5 });
console.log(`awake (last activity ${Math.round((Date.now() - last) / 60e3)} min ago)`);
process.exit(0);
