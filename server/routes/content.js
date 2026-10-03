import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { query, one, tx } from '../db.js';
import { requireStaff } from '../auth.js';
import { fail, pick, insertRow, updateRow, uniqueSlug, paging, getSetting, setSetting, audit } from '../lib.js';
import { saveFile, deleteFile } from '../storage.js';

export const content = new Hono();

// ---------------- Media ----------------
content.get('/media', requireStaff(), async (c) => {
  const { page, per, offset } = paging(c, { def: 60 });
  const q = c.req.query('q');
  const params = q ? [`%${q.toLowerCase()}%`] : [];
  const where = q ? 'where lower(filename) like $1 or lower(alt) like $1' : '';
  const [{ total }] = await query(`select count(*)::int total from media ${where}`, params);
  const rows = await query(`select * from media ${where} order by created_at desc, id desc limit ${per} offset ${offset}`, params);
  return c.json({ items: rows, total, page, per_page: per });
});

content.post('/media', requireStaff(), async (c) => {
  const form = await c.req.formData();
  const files = form.getAll('file');
  if (!files.length) fail(400, 'No file uploaded');
  const out = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) fail(400, `${file.name} is not an image`);
    if (file.size > 15 * 1024 * 1024) fail(400, `${file.name} is larger than 15 MB`);
    let buffer = Buffer.from(await file.arrayBuffer());
    let width = null, height = null, mime = file.type, name = file.name;
    if (!['image/svg+xml', 'image/gif'].includes(file.type)) {
      // resize big photos and convert to webp to keep the website fast
      const { default: sharp } = await import('sharp');
      const img = sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 });
      const { data, info } = await img.toBuffer({ resolveWithObject: true });
      buffer = data; width = info.width; height = info.height; mime = 'image/webp';
      name = name.replace(/\.[a-z0-9]+$/i, '') + '.webp';
    }
    const now = new Date();
    const safe = name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
    const key = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${Date.now().toString(36)}-${safe}`;
    const url = await saveFile(key, buffer, mime);
    out.push(await tx((t) => insertRow(t, 'media', { url, filename: safe, mime, width, height, alt: form.get('alt') || '' })));
  }
  return c.json(out, 201);
});

content.put('/media/:id', requireStaff(), async (c) => {
  const { alt } = await c.req.json();
  return c.json(await one('update media set alt = $2 where id = $1 returning *', [Number(c.req.param('id')), alt || '']));
});

content.delete('/media/:id', requireStaff('manager'), async (c) => {
  const row = await one('delete from media where id = $1 returning url', [Number(c.req.param('id'))]);
  if (row?.url?.startsWith('/uploads/new/')) await deleteFile(row.url.replace('/uploads/new/', ''));
  return c.json({ ok: true });
});

// ---------------- Pages & posts ----------------
for (const [path, table, cols] of [
  ['pages', 'pages', ['slug', 'title', 'content', 'template', 'status', 'seo', 'menu_order']],
  ['posts', 'posts', ['slug', 'title', 'excerpt', 'content', 'image', 'categories', 'status', 'published_at']],
]) {
  content.get(`/${path}`, requireStaff(), async (c) => c.json(await query(`select id, slug, title, status, updated_at${table === 'posts' ? ', published_at, image' : ', template'} from ${table} order by ${table === 'posts' ? 'published_at desc' : 'menu_order, title'}`)));
  content.get(`/${path}/:id`, requireStaff(), async (c) => {
    const row = await one(`select * from ${table} where id = $1`, [Number(c.req.param('id'))]);
    if (!row) fail(404, 'Not found');
    return c.json(row);
  });
  content.post(`/${path}`, requireStaff('manager'), async (c) => {
    const body = await c.req.json();
    if (!body.title?.trim()) fail(400, 'Title is required');
    const data = pick(body, cols, ['seo']);
    data.slug = await uniqueSlug(table, body.slug || body.title);
    return c.json(await tx((t) => insertRow(t, table, data)), 201);
  });
  content.put(`/${path}/:id`, requireStaff('manager'), async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json();
    const data = pick(body, cols, ['seo']);
    if (body.slug !== undefined) data.slug = await uniqueSlug(table, body.slug || body.title, id);
    const row = await tx((t) => updateRow(t, table, id, data));
    await audit(c.get('staff'), 'update', table, id);
    return c.json(row);
  });
  content.delete(`/${path}/:id`, requireStaff('manager'), async (c) => {
    await query(`delete from ${table} where id = $1`, [Number(c.req.param('id'))]);
    return c.json({ ok: true });
  });
}

// ---------------- Menus ----------------
content.get('/menus', requireStaff(), async (c) => c.json(await query('select * from menus order by id')));
content.put('/menus/:id', requireStaff('manager'), async (c) => {
  const { name, items } = await c.req.json();
  const row = await one('update menus set name = coalesce($2, name), items = $3 where id = $1 returning *', [Number(c.req.param('id')), name || null, JSON.stringify(items || [])]);
  await audit(c.get('staff'), 'update', 'menu', row?.id);
  return c.json(row);
});
content.post('/menus', requireStaff('manager'), async (c) => {
  const { name, location } = await c.req.json();
  if (!name || !location) fail(400, 'Name and location are required');
  return c.json(await one('insert into menus (name, location, items) values ($1, $2, $3) returning *', [name, location, '[]']), 201);
});

// ---------------- Settings ----------------
const SETTING_KEYS = ['store', 'shipping', 'payments', 'pos', 'homepage', 'header', 'footer', 'seo', 'notifications', 'popup', 'social', 'checkout'];
content.get('/settings', requireStaff(), async (c) => {
  const rows = await query('select key, value from settings');
  return c.json(Object.fromEntries(rows.map((r) => [r.key, typeof r.value === 'string' ? JSON.parse(r.value) : r.value])));
});
content.get('/settings/:key', requireStaff(), async (c) => c.json(await getSetting(c.req.param('key'), {})));
content.put('/settings/:key', requireStaff('manager'), async (c) => {
  const key = c.req.param('key');
  if (!SETTING_KEYS.includes(key)) fail(400, 'Unknown setting');
  if (['payments', 'shipping', 'store'].includes(key) && c.get('staff').role !== 'owner') fail(403, 'Only the owner can change this setting');
  const value = await c.req.json();
  await setSetting(key, value);
  await audit(c.get('staff'), 'update', 'settings', key);
  return c.json(value);
});

// ---------------- Staff ----------------
content.get('/staff', requireStaff('manager'), async (c) => c.json(await query(`
  select s.id, s.name, s.username, s.email, s.role, s.active, s.created_at, s.last_login_at, s.pin_hash is not null has_pin,
    (select count(*)::int from orders o where o.staff_id = s.id) order_count
  from staff s order by s.active desc, s.name`)));
content.post('/staff', requireStaff('owner'), async (c) => {
  const b = await c.req.json();
  if (!b.name || !b.username || !b.password) fail(400, 'Name, username and password are required');
  if (String(b.password).length < 6) fail(400, 'Password must be at least 6 characters');
  if (await one('select id from staff where lower(username) = lower($1)', [b.username])) fail(400, 'Username already taken');
  const row = await one(`insert into staff (name, username, email, role, password_hash, pin_hash) values ($1,$2,$3,$4,$5,$6) returning id, name, username, email, role, active`,
    [b.name, b.username.trim(), b.email || null, ['owner', 'manager', 'cashier'].includes(b.role) ? b.role : 'cashier', bcrypt.hashSync(b.password, 10), b.pin ? bcrypt.hashSync(String(b.pin), 10) : null]);
  await audit(c.get('staff'), 'create', 'staff', row.id);
  return c.json(row, 201);
});
content.put('/staff/:id', requireStaff('owner'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const me = c.get('staff');
  if (id === me.id && (b.active === false || (b.role && b.role !== 'owner'))) fail(400, 'You cannot disable or demote your own account');
  const data = pick(b, ['name', 'username', 'email', 'role', 'active']);
  if (b.password) {
    if (String(b.password).length < 6) fail(400, 'Password must be at least 6 characters');
    data.password_hash = bcrypt.hashSync(b.password, 10);
  }
  if (b.pin !== undefined) data.pin_hash = b.pin ? bcrypt.hashSync(String(b.pin), 10) : null;
  const row = await tx((t) => updateRow(t, 'staff', id, data, { touch: false }));
  await audit(me, 'update', 'staff', id);
  return c.json({ id: row.id, name: row.name, username: row.username, email: row.email, role: row.role, active: row.active });
});

// ---------------- Messages (contact form / newsletter) ----------------
content.get('/messages', requireStaff(), async (c) => c.json(await query('select * from messages order by created_at desc limit 500')));
content.put('/messages/:id', requireStaff(), async (c) => {
  const { read } = await c.req.json();
  return c.json(await one('update messages set read = $2 where id = $1 returning *', [Number(c.req.param('id')), !!read]));
});
content.delete('/messages/:id', requireStaff('manager'), async (c) => {
  await query('delete from messages where id = $1', [Number(c.req.param('id'))]);
  return c.json({ ok: true });
});

// ---------------- Activity log ----------------
content.get('/activity', requireStaff('owner'), async (c) => {
  const { per, offset } = paging(c);
  return c.json(await query(`select a.*, s.name staff_name from audit_log a left join staff s on s.id = a.staff_id order by a.created_at desc limit ${per} offset ${offset}`));
});

// ---------------- Global search (command palette) ----------------
content.get('/search', requireStaff(), async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ products: [], orders: [], customers: [] });
  const like = `%${q.toLowerCase()}%`;
  const [products, orders, customers] = await Promise.all([
    query(`select id, name, sku, images->0->>'url' image from products where status <> 'archived' and (lower(name) like $1 or sku = $2) order by total_sales desc limit 6`, [like, q]),
    query(`select id, number, total::float8, status, billing->>'first_name' first_name, billing->>'last_name' last_name from orders
      where number = $2 or lower(billing->>'first_name' || ' ' || coalesce(billing->>'last_name','')) like $1 or billing->>'phone' like $1 order by created_at desc limit 5`, [like, q.replace(/^#/, '')]),
    query(`select id, first_name, last_name, email, phone from customers where lower(first_name || ' ' || last_name) like $1 or lower(email) like $1 or phone like $1 limit 5`, [like]),
  ]);
  return c.json({ products, orders, customers });
});
