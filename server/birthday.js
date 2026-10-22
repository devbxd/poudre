// Birthday gift: every morning, customers whose birthday is today (date of birth given in their account) get an e-mail
// "Happy Birthday" with their own one-use code, valid until midnight (Beirut time). The code takes each item down to
// 20 % below its regular price at most: an item already 10 % off only gets 10 % more (coupon type "birthday").
import { randomBytes } from 'node:crypto';
import { query, tx } from './db.js';
import { emailSettings, sendMail, layout } from './mail.js';
import { getSetting } from './lib.js';

export const BIRTHDAY_PERCENT = 20;
const TZ = 'Asia/Beirut';

/** Today in Beirut: { date: 'YYYY-MM-DD', md: 'MM-DD', year } and the instant the day ends */
function beirutToday(now = new Date()) {
  const date = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const [y, m, d] = date.split('-').map(Number);
  // end of the day in Beirut = next midnight there (offset found from the formatted hour)
  const offsetH = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(Date.UTC(y, m - 1, d, 12)))) - 12;
  const endsAt = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0) - offsetH * 3600e3 - 1000);
  return { date, md: date.slice(5), year: y, endsAt };
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const newCode = () => `BDAY-${randomBytes(4).toString('hex').toUpperCase()}`;

/** Discount of a "birthday" coupon on cart lines ({ price, regular, quantity }): each item at most 20 % under its regular price */
export function birthdayLinesDiscount(lines, percent = BIRTHDAY_PERCENT) {
  return lines.reduce((s, l) => {
    const regular = Number(l.regular ?? l.price);
    const floor = regular * (1 - percent / 100);
    return s + Math.max(0, Number(l.price) - floor) * Number(l.quantity);
  }, 0);
}

/**
 * Sends today's birthday e-mails (once a year per customer). A date of birth given today does not count: it must have
 * been in the account before the birthday (no new account with "today" as birthday for a discount).
 */
export async function sendBirthdayEmails({ now = new Date(), dryRun = false } = {}) {
  const today = beirutToday(now);
  const mds = [today.md];
  if (today.md === '02-28' && !isLeap(today.year)) mds.push('02-29'); // born on 29 February: celebrated on the 28th
  const cfg = await emailSettings();
  if (!cfg.enabled?.customer_birthday && !dryRun) return { sent: 0, reason: 'birthday e-mails switched off' };
  const people = await query(`
    select id, first_name, email from customers
    where email is not null and email <> '' and date_of_birth is not null and to_char(date_of_birth, 'MM-DD') = any($1::text[])
      and (dob_set_at is null or dob_set_at < $2::date) and birthday_used_year is distinct from $3`, [mds, today.date, today.year]);
  if (dryRun) return { sent: 0, would: people.map((p) => p.email) };
  const store = await getSetting('store', {});
  const site = (store.url || 'https://poudrebeauty.com').replace(/\/$/, '');
  let sent = 0;
  for (const p of people) {
    let code;
    await tx(async (t) => {
      // claim this year's gift first, so a second run never sends two codes
      const [claimed] = await t.query('update customers set birthday_used_year = $2 where id = $1 and birthday_used_year is distinct from $2 returning id', [p.id, today.year]);
      if (!claimed) return;
      for (let i = 0; i < 5 && !code; i++) {
        const c = newCode();
        const [row] = await t.query(`insert into coupons (code, type, amount, description, expires_at, usage_limit, active)
          values ($1, 'birthday', $2, $3, $4, 1, true) on conflict (code) do nothing returning code`, [c, BIRTHDAY_PERCENT, `Birthday gift for ${p.email}`, today.endsAt]);
        if (row) code = row.code;
      }
    });
    if (!code) continue;
    const name = (p.first_name || '').trim();
    try {
      await sendMail({
        to: p.email,
        subject: `Happy Birthday${name ? ` ${name}` : ''}! 🎂 ${BIRTHDAY_PERCENT}% off today`,
        html: layout(cfg, `Happy Birthday${name ? `, ${name}` : ''}! 🎂`, `
          <p>To celebrate, enjoy <b>${BIRTHDAY_PERCENT}% off</b> your order today on poudrebeauty.com.</p>
          <p style="text-align:center;margin:28px 0"><span style="display:inline-block;border:2px dashed #7a2d48;border-radius:10px;padding:14px 26px;font-size:24px;font-weight:700;letter-spacing:3px;color:#7a2d48">${code}</span></p>
          <p>Enter this code in your cart. It works <b>once</b>, <b>today only, until midnight</b>.</p>
          <p style="text-align:center;margin:26px 0"><a href="${site}/shop/" style="background:#1f1f1f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:24px;font-weight:600">Shop now</a></p>`),
      }, cfg);
      sent++;
    } catch (e) {
      console.error('birthday mail', p.email, e.message);
    }
  }
  return { sent, of: people.length };
}

/** A date of birth typed by a customer: YYYY-MM-DD, a real date, 5 to 110 years ago. null when invalid. */
export function parseBirthDate(v) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  const age = (Date.now() - d.getTime()) / (365.25 * 86400e3);
  return age >= 5 && age <= 110 ? s : null;
}
