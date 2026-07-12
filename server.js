require('dotenv/config');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { Pool } = require('pg');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function toParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function query(sql, params = []) {
  const { rows } = await pool.query(toParams(sql), params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  const res = await pool.query(toParams(sql), params);
  return { id: res.rows[0]?.id, rowCount: res.rowCount };
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      display_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      sku TEXT UNIQUE,
      barcode TEXT,
      name TEXT NOT NULL,
      category TEXT,
      brand TEXT,
      price REAL DEFAULT 0,
      sale_price REAL DEFAULT 0,
      stock INTEGER DEFAULT 0,
      low_stock_alert INTEGER DEFAULT 5,
      image_url TEXT,
      description TEXT,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_num TEXT UNIQUE NOT NULL,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      type TEXT DEFAULT 'online',
      status TEXT DEFAULT 'pending',
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT,
      sku TEXT,
      price REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      subtotal REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const defaultSettings = {
    store_name: 'Poudre Beauty',
    store_email: '',
    store_phone: '',
    store_address: '',
    currency: 'USD',
    logo: '',
  };
  for (const [k, v] of Object.entries(defaultSettings)) {
    await pool.query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }

  const count = await queryOne('SELECT COUNT(*) as c FROM users');
  if (parseInt(count.c) === 0) {
    await pool.query('INSERT INTO users (username,password,role,display_name) VALUES ($1,$2,$3,$4)',
      ['admin', bcrypt.hashSync('poudre2024', 10), 'admin', 'Admin']);
  }

  console.log('✅ Database ready');
}

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
  }
}));
app.use(session({
  secret: process.env.SESSION_SECRET || 'poudre-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

function auth(req, res, next) { if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' }); next(); }
function admin(req, res, next) { if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' }); next(); }

// AUTH
app.post('/api/login', async (req, res) => {
  try {
    const u = await queryOne('SELECT * FROM users WHERE username=?', [req.body.username]);
    if (!u || !bcrypt.compareSync(req.body.password, u.password)) return res.json({ success: false, error: 'Invalid credentials' });
    req.session.user = { id: u.id, username: u.username, role: u.role, display_name: u.display_name };
    res.json({ success: true, user: req.session.user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));

// SETTINGS
app.get('/api/settings', async (req, res) => {
  try {
    const rows = await query('SELECT key,value FROM settings');
    const s = {}; rows.forEach(r => s[r.key] = r.value); res.json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/settings', auth, async (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body)) {
      await pool.query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [k, String(v)]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PRODUCTS
app.get('/api/products/search', async (req, res) => {
  try {
    const { q: search } = req.query;
    if (!search) return res.json([]);
    const results = await query(
      "SELECT * FROM products WHERE active=true AND product_type IN ('simple','variable') AND (name ILIKE ? OR sku ILIKE ? OR barcode ILIKE ?) ORDER BY name LIMIT 50",
      ['%'+search+'%','%'+search+'%','%'+search+'%']
    );
    res.json(results);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/products', async (req, res) => {
  try {
    const { search, category, brand, low_stock } = req.query;
    let q = "SELECT * FROM products WHERE active=true AND product_type IN ('simple','variable') AND (price > 0 OR sale_price > 0 OR product_type = 'variable')"; const p = [];
    if (search) { q += ' AND (name ILIKE ? OR sku ILIKE ? OR barcode ILIKE ? OR variant_name ILIKE ?)'; p.push('%'+search+'%','%'+search+'%','%'+search+'%','%'+search+'%'); }
    if (category) { q += ' AND category=?'; p.push(category); }
    if (brand) { q += ' AND brand=?'; p.push(brand); }
    if (low_stock === 'true') { q += ' AND stock <= low_stock_alert'; }
    q += ' ORDER BY name LIMIT 50 OFFSET ?';
    p.push(parseInt(req.query.offset)||0);
    res.json(await query(q, p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

  app.get('/api/products', async (req, res) => {
  try {
    const { search, category, brand, low_stock } = req.query;
    let q = "SELECT * FROM products WHERE active=true AND product_type IN ('simple','variable')"; const p = [];
    if (search) { q += ' AND (name ILIKE ? OR sku ILIKE ? OR barcode ILIKE ? OR variant_name ILIKE ?)'; p.push('%'+search+'%','%'+search+'%','%'+search+'%','%'+search+'%'); }
    if (category) { q += ' AND category=?'; p.push(category); }
    if (brand) { q += ' AND brand=?'; p.push(brand); }
    if (low_stock === 'true') { q += ' AND stock <= low_stock_alert'; }
    q += ' ORDER BY name LIMIT 50 OFFSET ?';
    p.push(parseInt(req.query.offset)||0);
    res.json(await query(q, p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/products/scan/:barcode', async (req, res) => {
  try {
    const p = await queryOne('SELECT * FROM products WHERE barcode=? OR sku=?', [req.params.barcode, req.params.barcode]);
    if (!p) return res.status(404).json({ error: 'Product not found' });
    res.json(p);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/products/categories', async (req, res) => {
  try {
    const allCats = await query('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND active=true');
    const cats = new Set();
    allCats.forEach(r => {
      r.category.split(',').forEach(c => {
        const clean = c.trim().split('>').pop().trim();
        if (clean) cats.add(clean);
      });
    });
    res.json([...cats].sort());
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/products/brands', async (req, res) => {
  try {
    const rows = await query('SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND active=true ORDER BY brand');
    res.json(rows.map(r => r.brand));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/products/variations', async (req, res) => {
  try {
    res.json(await query("SELECT * FROM products WHERE product_type IN ('variation','variation, downloadable') AND active=true ORDER BY name"));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/products/:id', async (req, res) => {
  try {
    const p = await queryOne('SELECT * FROM products WHERE id=?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/products', auth, async (req, res) => {
  try {
    const { sku, barcode, name, category, brand, price, sale_price, stock, low_stock_alert, image_url, description } = req.body;
    const r = await queryOne('INSERT INTO products (sku,barcode,name,category,brand,price,sale_price,stock,low_stock_alert,image_url,description) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id',
      [sku||null, barcode||null, name, category||'', brand||'', parseFloat(price)||0, parseFloat(sale_price)||0, parseInt(stock)||0, parseInt(low_stock_alert)||5, image_url||'', description||'']);
    res.json({ id: r.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/products/:id', auth, async (req, res) => {
  try {
    const { sku, barcode, name, category, brand, price, sale_price, stock, low_stock_alert, image_url, description } = req.body;
    await run('UPDATE products SET sku=?,barcode=?,name=?,category=?,brand=?,price=?,sale_price=?,stock=?,low_stock_alert=?,image_url=?,description=? WHERE id=?',
      [sku||null, barcode||null, name, category||'', brand||'', parseFloat(price)||0, parseFloat(sale_price)||0, parseInt(stock)||0, parseInt(low_stock_alert)||5, image_url||'', description||'', req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/products/:id', auth, async (req, res) => {
  try {
    await run('UPDATE products SET active=false WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});










app.post('/api/products/import-csv', auth, upload.single('file'), async (req, res) => {
  try {
    const content = fs.readFileSync(req.file.path, 'utf8');
    const records = parse(content, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
    let imported = 0, skipped = 0;

    for (const r of records) {
      try {
        const type = r['Type'] || 'simple';
        const name = r['Name'] || r['name'];
        if (!name) { skipped++; continue; }
        const sku = r['SKU'] || null;
        const barcode = r['GTIN, UPC, EAN, or ISBN'] || null;
        const price = parseFloat(r['Regular price'] || 0);
        const sale_price = parseFloat(r['Sale price'] || 0);
        const stock = parseInt(r['Stock'] || 0);
        const category = r['Categories'] || '';
        const brand = r['Brands'] || '';
        const image_url = (r['Images'] || '').split(',')[0].trim();
        let parent_sku = r['Parent'] || null;
if (parent_sku && parent_sku.startsWith('id:')) parent_sku = parent_sku.replace('id:', '');

        // Build attributes from Attribute columns
        const attributes = {};
        for (let i = 1; i <= 5; i++) {
          const attrName = r[`Attribute ${i} name`];
          const attrValue = r[`Attribute ${i} value(s)`];
          if (attrName && attrValue) attributes[attrName] = attrValue;
        }
        const variant_name = Object.values(attributes).join(' / ') || null;

        await pool.query(`
          INSERT INTO products (sku, barcode, name, category, brand, price, sale_price, stock, image_url, parent_sku, attributes, variant_name, product_type)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (sku) DO UPDATE SET
            name=$3, category=$4, brand=$5, price=$6, sale_price=$7,
            stock=$8, image_url=$9, parent_sku=$10, attributes=$11,
            variant_name=$12, product_type=$13
        `, [sku, barcode, name, category, brand, price, sale_price, stock, image_url,
            parent_sku, JSON.stringify(attributes), variant_name, type]);
        imported++;
      } catch(e) { skipped++; }
    }

    fs.unlinkSync(req.file.path);
    res.json({ success: true, imported, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});















// ORDERS
app.get('/api/orders/next-num', async (req, res) => {
  try {
    const last = await queryOne('SELECT order_num FROM orders ORDER BY id DESC LIMIT 1');
    if (!last) return res.json({ num: 'ORD-001' });
    const m = last.order_num.match(/(\d+)$/);
    res.json({ num: 'ORD-' + String(m ? parseInt(m[1]) + 1 : 1).padStart(3, '0') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/orders', auth, async (req, res) => {
  try {
    const { from, to, status, type } = req.query;
    let q = 'SELECT * FROM orders WHERE 1=1'; const p = [];
    if (from) { q += ' AND DATE(created_at)>=?'; p.push(from); }
    if (to) { q += ' AND DATE(created_at)<=?'; p.push(to); }
    if (status) { q += ' AND status=?'; p.push(status); }
    if (type) { q += ' AND type=?'; p.push(type); }
    q += ' ORDER BY created_at DESC';
    res.json(await query(q, p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/orders/:id', auth, async (req, res) => {
  try {
    const order = await queryOne('SELECT * FROM orders WHERE id=?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Not found' });
    const items = await query('SELECT * FROM order_items WHERE order_id=?', [order.id]);
    res.json({ ...order, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});























app.post('/api/orders', async (req, res) => {
  try {
    const { order_num, customer_name, customer_email, customer_phone, type, status, items, discount, notes } = req.body;
    const subtotal = (items || []).reduce((a, i) => a + (parseFloat(i.price) * parseInt(i.quantity)), 0);
    const disc = parseFloat(discount) || 0;
    const total = subtotal - disc;
    const r = await queryOne('INSERT INTO orders (order_num,customer_name,customer_email,customer_phone,type,status,subtotal,discount,total,notes) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id',
      [order_num, customer_name||'', customer_email||'', customer_phone||'', type||'online', status||'pending', subtotal, disc, total, notes||'']);
    for (const item of (items || [])) {
      await run('INSERT INTO order_items (order_id,product_id,product_name,sku,price,quantity,subtotal) VALUES (?,?,?,?,?,?,?)',
        [r.id, item.product_id||null, item.product_name, item.sku||'', parseFloat(item.price), parseInt(item.quantity), parseFloat(item.price)*parseInt(item.quantity)]);
      if (item.product_id) {
        await run('UPDATE products SET stock=stock-? WHERE id=? AND stock>0', [parseInt(item.quantity), item.product_id]);
      }
    }
    
    res.json({ id: r.id, order_num });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/orders/:id/status', auth, async (req, res) => {
  try {
    await run('UPDATE orders SET status=? WHERE id=?', [req.body.status, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// REPORTS
app.get('/api/reports', auth, async (req, res) => {
  try {
    const { from, to } = req.query;
    let w = '1=1'; const p = [];
    if (from) { w += ' AND DATE(created_at)>=?'; p.push(from); }
    if (to) { w += ' AND DATE(created_at)<=?'; p.push(to); }
    const orders = await query(`SELECT * FROM orders WHERE ${w}`, p);
    const totalSales = orders.filter(o => o.status !== 'cancelled').reduce((a, o) => a + o.total, 0);
    const totalOrders = orders.filter(o => o.status !== 'cancelled').length;
    const byDay = {};
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const d = o.created_at.toISOString().split('T')[0];
      byDay[d] = (byDay[d] || 0) + o.total;
    }
    const lowStock = await query('SELECT * FROM products WHERE stock <= low_stock_alert AND active=true ORDER BY stock ASC LIMIT 10');
    const totalProducts = await queryOne('SELECT COUNT(*) as c FROM products WHERE active=true');
    res.json({ totalSales, totalOrders, byDay, lowStock, totalProducts: parseInt(totalProducts.c) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// USERS
app.get('/api/users', admin, async (req, res) => {
  try { res.json(await query('SELECT id,username,role,display_name FROM users')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/users', admin, async (req, res) => {
  try {
    const r = await queryOne('INSERT INTO users (username,password,role,display_name) VALUES (?,?,?,?) RETURNING id',
      [req.body.username, bcrypt.hashSync(req.body.password, 10), req.body.role||'staff', req.body.display_name]);
    res.json({ id: r.id });
  } catch (e) { res.status(400).json({ error: 'Username already taken' }); }
});
app.put('/api/users/:id', admin, async (req, res) => {
  try {
    const { display_name, role, password } = req.body;
    if (password) await run('UPDATE users SET password=? WHERE id=?', [bcrypt.hashSync(password, 10), req.params.id]);
    await run('UPDATE users SET display_name=?,role=? WHERE id=?', [display_name, role, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/users/:id', admin, async (req, res) => {
  try {
    if (req.params.id == req.session.user?.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    await run('DELETE FROM users WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/products/variations', async (req, res) => {
  try {
    res.json(await query("SELECT * FROM products WHERE product_type IN ('variation','variation, downloadable') AND active=true ORDER BY name"));
  } catch (e) { res.status(500).json({ error: e.message }); }
});



// SHOP API
app.get('/api/shop/products', async (req, res) => {
  try {
    const { search, category, limit, offset, max_price } = req.query;
    let q = "SELECT * FROM products WHERE active=true AND product_type IN ('simple','variable')"; const p = [];
    if (search) { q += ' AND (name ILIKE ? OR sku ILIKE ? OR barcode ILIKE ?)'; p.push('%'+search+'%','%'+search+'%','%'+search+'%'); }
    if (category && category !== 'all') { q += ' AND category ILIKE ?'; p.push('%'+category+'%'); }
    if (max_price) { q += ' AND (sale_price <= ? OR (sale_price = 0 AND price <= ?))'; p.push(max_price, max_price); }
    q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    p.push(parseInt(limit)||24, parseInt(offset)||0);
    res.json(await query(q, p));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/shop/variations/:sku', async (req, res) => {
  try {
    const vars = await query("SELECT * FROM products WHERE parent_sku=? AND product_type IN ('variation','variation, downloadable') AND active=true ORDER BY variant_name", [req.params.sku]);
    res.json(vars);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/shop/wishlist', async (req, res) => {
  try {
    const ids = (req.query.ids || '').split(',').map(Number).filter(Boolean);
    if (!ids.length) return res.json([]);
    const placeholders = ids.map((_, i) => `$${i+1}`).join(',');
    const { rows } = await pool.query(`SELECT * FROM products WHERE id IN (${placeholders})`, ids);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/shop', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop.html')));


app.delete('/api/orders/:id', auth, async (req, res) => {
  try {
    await run('DELETE FROM order_items WHERE order_id=?', [req.params.id]);
    await run('DELETE FROM orders WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n💄 Poudre Beauty — Dashboard`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  });
}).catch(err => {
  console.error('❌ DB Error:', err.message);
  process.exit(1);
});