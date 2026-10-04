import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { one, query } from './db.js';
import { fail, audit } from './lib.js';

const COOKIE = 'poudre_staff';
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-me-in-production-please');

async function sign(payload, days) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${days}d`).sign(secret());
}

async function verify(token) {
  try { return (await jwtVerify(token, secret())).payload; } catch { return null; }
}

const cookieOpts = (c, days) => ({
  httpOnly: true, sameSite: 'Lax', path: '/', maxAge: days * 86400,
  secure: new URL(c.req.url).protocol === 'https:',
});

const publicStaff = (s) => ({ id: s.id, name: s.name, username: s.username, email: s.email, role: s.role });

export const ROLES = { owner: 3, manager: 2, cashier: 1 };

/** Password reset link for a customer: valid 24 h and only until the password changes (fingerprint of the current hash). */
const fingerprint = (hash) => (hash || 'none').slice(-12);
export async function resetToken(customer) {
  return new SignJWT({ rid: customer.id, fp: fingerprint(customer.password_hash) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('24h').sign(secret());
}
export async function checkResetToken(token, id) {
  const p = await verify(token || '');
  if (!p || Number(p.rid) !== Number(id)) return null;
  const customer = await one('select * from customers where id = $1', [Number(id)]);
  return customer && fingerprint(customer.password_hash) === p.fp ? customer : null;
}

/** Middleware: requires a logged-in staff member with at least `minRole`. */
export const requireStaff = (minRole = 'cashier') => async (c, next) => {
  const payload = await verify(getCookie(c, COOKIE) || c.req.header('authorization')?.replace(/^Bearer /, '') || '');
  if (!payload) fail(401, 'Please log in');
  const staff = await one('select * from staff where id = $1 and active', [payload.sid]);
  if (!staff) fail(401, 'Account disabled');
  if (ROLES[staff.role] < ROLES[minRole]) fail(403, 'You do not have permission to do this');
  c.set('staff', staff);
  await next();
};

export const auth = new Hono();

auth.post('/login', async (c) => {
  const { username, password, pin } = await c.req.json();
  let staff;
  if (pin) {
    // POS quick switch: PIN only, checked against every active cashier
    const all = await query('select * from staff where active and pin_hash is not null');
    staff = all.find((s) => bcrypt.compareSync(String(pin), s.pin_hash));
    if (!staff) fail(401, 'Wrong PIN');
  } else {
    staff = await one('select * from staff where active and (lower(username) = lower($1) or lower(email) = lower($1))', [String(username || '').trim()]);
    if (!staff || !bcrypt.compareSync(String(password || ''), staff.password_hash)) fail(401, 'Wrong username or password');
  }
  const days = 30;
  setCookie(c, COOKIE, await sign({ sid: staff.id }, days), cookieOpts(c, days));
  await query('update staff set last_login_at = now() where id = $1', [staff.id]);
  await audit(staff, 'login', 'staff', staff.id, { method: pin ? 'pin' : 'password' });
  return c.json({ staff: publicStaff(staff) });
});

auth.post('/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

auth.get('/me', requireStaff(), (c) => c.json({ staff: publicStaff(c.get('staff')) }));

auth.post('/password', requireStaff(), async (c) => {
  const { current, password } = await c.req.json();
  const staff = c.get('staff');
  if (!bcrypt.compareSync(String(current || ''), staff.password_hash)) fail(400, 'Current password is wrong');
  if (String(password || '').length < 8) fail(400, 'Password must be at least 8 characters');
  await query('update staff set password_hash = $2 where id = $1', [staff.id, bcrypt.hashSync(password, 10)]);
  return c.json({ ok: true });
});

// ---------- Website customer accounts ----------
const CUSTOMER_COOKIE = 'poudre_customer';

export async function currentCustomer(c) {
  const payload = await verify(getCookie(c, CUSTOMER_COOKIE) || '');
  if (!payload?.cid) return null;
  return one('select id, first_name, last_name, email, phone, billing, shipping from customers where id = $1', [payload.cid]);
}

export async function loginCustomer(c, customerId) {
  setCookie(c, CUSTOMER_COOKIE, await sign({ cid: customerId }, 60), cookieOpts(c, 60));
}

export function logoutCustomer(c) {
  deleteCookie(c, CUSTOMER_COOKIE, { path: '/' });
}
