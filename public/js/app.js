// ─── API ───
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

// ─── TOAST ───
function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// ─── MODAL ───
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ─── STATE ───
let currentUser = null;
let currentPage = 'dashboard';
let cart = [];

// ─── INIT ───
async function init() {
  const r = await api('GET', '/api/me');
  if (r.user) {
    currentUser = r.user;
    showApp();
  } else {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('user-name-display').textContent = currentUser.display_name;
  document.getElementById('user-role-display').textContent = currentUser.role;
  document.getElementById('user-avatar').textContent = currentUser.display_name[0].toUpperCase();
  navigateTo('dashboard');
}

// ─── LOGIN ───
document.getElementById('btn-login').addEventListener('click', async () => {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const err = document.getElementById('login-error');
  err.classList.add('hidden');
  const r = await api('POST', '/api/login', { username, password });
  if (r.success) { currentUser = r.user; showApp(); }
  else { err.textContent = r.error || 'Invalid credentials'; err.classList.remove('hidden'); }
});
document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-login').click(); });

// ─── LOGOUT ───
document.getElementById('btn-logout').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  currentUser = null;
  cart = [];
  showLogin();
});

// ─── NAVIGATION ───
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="loading-page"><i class="ti ti-loader spin"></i></div>';
  const pages = { dashboard: loadDashboard, products: loadProducts, import: loadImport, cashier: loadCashier, orders: loadOrders, reports: loadReports, settings: loadSettings };
  if (pages[page]) pages[page]();
}

// ─── DASHBOARD ───
async function loadDashboard() {
  const today = new Date().toISOString().split('T')[0];
const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
const [reports, settings] = await Promise.all([api('GET', `/api/reports?from=${firstDay}&to=${today}`), api('GET', '/api/settings')]);
  const cur = settings.currency || 'USD';
  const fmt = v => `${cur} ${Number(v).toFixed(2)}`;
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Dashboard</div><div class="page-subtitle">${new Date().toLocaleDateString('en-US', {weekday:'long', year:'numeric', month:'long', day:'numeric'})}</div></div>
    </div>
    <div class="page-body">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon" style="background:#fef3e2">💰</div>
          <div class="stat-label">Total Sales</div>
          <div class="stat-value">${fmt(reports.totalSales||0)}</div>
          <div class="stat-sub">${reports.totalOrders||0} orders</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#edf7f1">📦</div>
          <div class="stat-label">Products</div>
          <div class="stat-value">${reports.totalProducts||0}</div>
          <div class="stat-sub">Active items</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fdecea">⚠️</div>
          <div class="stat-label">Low Stock</div>
          <div class="stat-value">${reports.lowStock?.length||0}</div>
          <div class="stat-sub">Need restocking</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#eff6ff">🛒</div>
          <div class="stat-label">Today Orders</div>
          <div class="stat-value">${Object.entries(reports.byDay||{}).filter(([d])=>d===new Date().toISOString().split('T')[0]).length}</div>
          <div class="stat-sub">In-store & online</div>
        </div>
      </div>
      ${reports.lowStock?.length ? `
      <div class="low-stock-banner">
        <i class="ti ti-alert-triangle"></i>
        <span><strong>${reports.lowStock.length} products</strong> are running low on stock</span>
        <button class="btn btn-sm btn-secondary" style="margin-left:auto" onclick="navigateTo('products')">View</button>
      </div>` : ''}
      <div class="table-card">
        <div class="table-header"><span class="table-title">Low Stock Products</span></div>
        <table>
          <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Alert</th></tr></thead>
          <tbody>
            ${reports.lowStock?.length ? reports.lowStock.map(p => `
              <tr>
                <td>${p.name}</td>
                <td><code>${p.sku||'—'}</code></td>
                <td class="${p.stock===0?'stock-out':p.stock<=p.low_stock_alert?'stock-low':'stock-ok'}">${p.stock}</td>
                <td>${p.low_stock_alert}</td>
              </tr>`).join('') : '<tr class="empty-row"><td colspan="4">All products have sufficient stock 🎉</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ─── PRODUCTS ───
async function loadProducts() {
  window._offset = 0;
  const [products, variations, categories, brands] = await Promise.all([
    api('GET', '/api/products?offset=0'),
    api('GET', '/api/products/variations'),
    api('GET', '/api/products/categories'),
    api('GET', '/api/products/brands')
  ]);
  renderProducts(products, categories, brands, variations);
}

function renderProducts(products, categories, brands, variations=[]) {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Products</div><div class="page-subtitle">${products.length} items</div></div>
      <button class="btn btn-primary" onclick="openProductModal()"><i class="ti ti-plus"></i> Add Product</button>
    </div>
    <div class="page-body">
      <div class="table-card">
        <div class="table-header">
          <div class="search-bar">
            <div class="search-input"><i class="ti ti-search"></i><input type="text" id="product-search" placeholder="Search by name, SKU or barcode..." oninput="filterProducts()"/></div>
            <select class="filter-select" id="filter-category" onchange="filterProducts()">
              <option value="">All Categories</option>
              ${(categories||[]).map(c=>`<option value="${c}">${c}</option>`).join('')}
            </select>
            <select class="filter-select" id="filter-brand" onchange="filterProducts()">
              <option value="">All Brands</option>
              ${(brands||[]).map(b=>`<option value="${b}">${b}</option>`).join('')}
            </select>
            <select class="filter-select" id="filter-stock" onchange="filterProducts()">
              <option value="">All Stock</option>
              <option value="low">Low Stock</option>
            </select>
          </div>
        </div>
        <div style="overflow-x:auto">
        <table id="products-table">
          <thead><tr><th>Product</th><th>SKU / Barcode</th><th>Category</th><th>Brand</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead>
          <tbody id="products-tbody">
            ${renderProductRows(products)}
          </tbody>
        </table>
        </div>
      </div>
    </div>`;
 window._allProducts = products;
  window._categories = categories;
  window._brands = brands;
  window._variations = variations;
  // Infinite scroll
  const mainEl = document.getElementById('main-content');
  mainEl.addEventListener('scroll', async () => {
    if (mainEl.scrollTop + mainEl.clientHeight >= mainEl.scrollHeight - 200) {
      window._offset = (window._offset||0) + 50;
      const more = await api('GET', `/api/products?offset=${window._offset}`);
      if (more.length) {
        window._allProducts = [...window._allProducts, ...more];
        document.getElementById('products-tbody').innerHTML += renderProductRows(more);
      }
    }
  });
}




function renderProductRows(products) {
  if (!products.length) return '<tr class="empty-row"><td colspan="7">No products found</td></tr>';
  
  // Group by parent_sku
  const parents = products.filter(p => p.product_type !== 'variation');
  const variations = window._variations || [];
  
  // Map variations by parent_sku
  const varMap = {};
  variations.forEach(v => {
    const key = String(v.parent_sku);
    if (!varMap[key]) varMap[key] = [];
    varMap[key].push(v);
  });

  return parents.map(p => {
    const vars = varMap[String(p.sku)] || [];
    const hasVars = vars.length > 0;
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            ${p.image_url ? `<img src="${p.image_url}" class="product-img" onerror="this.style.display='none'"/>` : `<div class="product-img-placeholder">💄</div>`}
            <div>
              <div style="font-weight:500">${p.name}</div>
              ${hasVars ? `<div style="font-size:11px;color:var(--primary-dark);margin-top:2px;cursor:pointer" onclick="toggleVariants('${p.sku}')">▶ ${vars.length} variants</div>` : ''}
            </div>
          </div>
        </td>
        <td><div style="font-size:12px;color:var(--text3)">${p.sku||'—'}</div><div style="font-size:11px;color:var(--text3)">${p.barcode||''}</div></td>
        <td style="font-size:12px;color:var(--text2)">${p.category||'—'}</td>
        <td style="font-size:12px;color:var(--text2)">${p.brand||'—'}</td>
        <td style="font-weight:600">$${Number(p.sale_price||p.price).toFixed(2)}</td>
        <td class="${p.stock===0?'stock-out':p.stock<=p.low_stock_alert?'stock-low':'stock-ok'}">${p.stock}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm btn-secondary" onclick="openProductModal(${p.id})">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteProduct(${p.id})">Delete</button>
          </div>
        </td>
      </tr>
      ${hasVars ? `
      <tr id="variants-${p.sku}" style="display:none">
        <td colspan="7" style="padding:0 0 0 60px;background:var(--surface2)">
          <table style="width:100%;border-collapse:collapse">
            ${vars.map(v => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:8px 14px;font-size:12px;color:var(--text2);width:40%">
                  ${v.image_url ? `<img src="${v.image_url}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;margin-right:8px;vertical-align:middle" onerror="this.style.display='none'"/>` : ''}
                  ${v.variant_name || v.name}
                </td>
                <td style="padding:8px 14px;font-size:12px;color:var(--text3)">${v.sku||'—'}</td>
                <td style="padding:8px 14px;font-size:12px;font-weight:600">$${Number(v.sale_price||v.price).toFixed(2)}</td>
                <td style="padding:8px 14px;font-size:12px" class="${v.stock===0?'stock-out':v.stock<=v.low_stock_alert?'stock-low':'stock-ok'}">${v.stock}</td>
                <td style="padding:8px 14px">
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-sm btn-secondary" onclick="openProductModal(${v.id})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteProduct(${v.id})">Delete</button>
                  </div>
                </td>
              </tr>`).join('')}
          </table>
        </td>
      </tr>` : ''}
    `;
  }).join('');
}

function toggleVariants(sku) {
  const row = document.getElementById(`variants-${sku}`);
  if (row) row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}








async function filterProducts() {
  const search = document.getElementById('product-search')?.value || '';
  const cat = document.getElementById('filter-category')?.value || '';
  const brand = document.getElementById('filter-brand')?.value || '';
  const stock = document.getElementById('filter-stock')?.value || '';
  window._offset = 0;
  let url = `/api/products?offset=0`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (cat) url += `&category=${encodeURIComponent(cat)}`;
  if (brand) url += `&brand=${encodeURIComponent(brand)}`;
  if (stock === 'low') url += `&low_stock=true`;
  const products = await api('GET', url);
  window._allProducts = products;
  document.getElementById('products-tbody').innerHTML = renderProductRows(products);
}





async function openProductModal(id = null) {
  document.getElementById('edit-product-id').value = '';
  document.getElementById('modal-product-title').textContent = id ? 'Edit Product' : 'New Product';
  document.getElementById('btn-save-product').textContent = id ? 'Save Changes' : 'Save Product';
  ['p-name','p-sku','p-barcode','p-category','p-brand','p-price','p-sale-price','p-stock','p-low-stock','p-image','p-desc'].forEach(f => { const el = document.getElementById(f); if(el) el.value = ''; });
  document.getElementById('p-low-stock').value = '5';
  if (id) {
    const p = await api('GET', `/api/products/${id}`);
    document.getElementById('edit-product-id').value = p.id;
    document.getElementById('p-name').value = p.name || '';
    document.getElementById('p-sku').value = p.sku || '';
    document.getElementById('p-barcode').value = p.barcode || '';
    document.getElementById('p-category').value = p.category || '';
    document.getElementById('p-brand').value = p.brand || '';
    document.getElementById('p-price').value = p.price || '';
    document.getElementById('p-sale-price').value = p.sale_price || '';
    document.getElementById('p-stock').value = p.stock || '';
    document.getElementById('p-low-stock').value = p.low_stock_alert || 5;
    document.getElementById('p-image').value = p.image_url || '';
    document.getElementById('p-desc').value = p.description || '';
  }
  openModal('modal-product');
}

document.getElementById('btn-save-product').addEventListener('click', async () => {
  const id = document.getElementById('edit-product-id').value;
  const data = {
    name: document.getElementById('p-name').value.trim(),
    sku: document.getElementById('p-sku').value.trim(),
    barcode: document.getElementById('p-barcode').value.trim(),
    category: document.getElementById('p-category').value.trim(),
    brand: document.getElementById('p-brand').value.trim(),
    price: document.getElementById('p-price').value,
    sale_price: document.getElementById('p-sale-price').value,
    stock: document.getElementById('p-stock').value,
    low_stock_alert: document.getElementById('p-low-stock').value,
    image_url: document.getElementById('p-image').value.trim(),
    description: document.getElementById('p-desc').value.trim(),
  };
  if (!data.name) return toast('Product name is required', 'error');
  const r = id ? await api('PUT', `/api/products/${id}`, data) : await api('POST', '/api/products', data);
  if (r.success || r.id) { closeModal('modal-product'); toast('Product saved!', 'success'); loadProducts(); }
  else toast(r.error || 'Error', 'error');
});

async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  const r = await api('DELETE', `/api/products/${id}`);
  if (r.success) { toast('Product deleted', 'success'); loadProducts(); }
  else toast('Error', 'error');
}

// ─── IMPORT CSV ───
function loadImport() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Import Products</div><div class="page-subtitle">Import from WooCommerce CSV export</div></div>
    </div>
    <div class="page-body">
      <div class="table-card" style="padding:2rem">
        <div class="import-zone" onclick="document.getElementById('csv-input').click()">
          <i class="ti ti-file-spreadsheet"></i>
          <h3>Click to select CSV file</h3>
          <p>Export your products from WooCommerce → Products → Export</p>
          <input type="file" id="csv-input" accept=".csv" style="display:none" onchange="handleCsvImport(this)"/>
        </div>
        <div id="import-result" style="margin-top:1.5rem;display:none"></div>
      </div>
    </div>`;
}

async function handleCsvImport(input) {
  const file = input.files[0];
  if (!file) return;
  const result = document.getElementById('import-result');
  result.style.display = 'block';
  result.innerHTML = '<div style="color:var(--text3);text-align:center;padding:1rem"><i class="ti ti-loader spin"></i> Importing...</div>';
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/products/import-csv', { method: 'POST', body: formData, credentials: 'same-origin' });
  const r = await res.json();
  if (r.success) {
    result.innerHTML = `
      <div style="background:var(--green-bg);border:1px solid #a8d5b5;border-radius:var(--radius-sm);padding:1.5rem;text-align:center">
        <div style="font-size:2rem;margin-bottom:0.5rem">✅</div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--green)">Import Successful!</div>
        <div style="color:var(--text2);margin-top:8px">${r.imported} products imported · ${r.skipped} skipped</div>
        <button class="btn btn-primary" style="margin-top:1rem" onclick="navigateTo('products')">View Products</button>
      </div>`;
  } else {
    result.innerHTML = `<div style="background:var(--red-bg);padding:1rem;border-radius:var(--radius-sm);color:var(--red)">${r.error}</div>`;
  }
}

// ─── CASHIER ───
function loadCashier() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Cashier — POS</div><div class="page-subtitle">Scan barcode or search product</div></div>
    </div>
    <div class="cashier-layout">
      <div class="cashier-products">
        <div class="cashier-scan">
          <div class="scan-input">
            <i class="ti ti-barcode"></i>
            <input type="text" id="scan-input" placeholder="Scan barcode or search..." autofocus/>
          </div>
        </div>
        <div style="padding:0.75rem;border-bottom:1px solid var(--border)">
          <div class="search-bar">
            <select class="filter-select" id="pos-category" onchange="loadPosProducts()" style="flex:1">
              <option value="">All Categories</option>
            </select>
            <select class="filter-select" id="pos-brand" onchange="loadPosProducts()" style="flex:1">
              <option value="">All Brands</option>
            </select>
          </div>
        </div>
        <div class="products-grid" id="pos-grid">
          <div style="grid-column:1/-1;text-align:center;color:var(--text3);padding:2rem"><i class="ti ti-loader spin"></i></div>
        </div>
      </div>
      <div class="cashier-cart">
        <div style="padding:1rem;border-bottom:1px solid var(--border);font-weight:700;font-size:14px">🛒 Cart</div>
        <div class="cart-items" id="cart-items"><div style="text-align:center;color:var(--text3);padding:2rem;font-size:13px">Cart is empty<br/>Scan a product to start</div></div>
        <div class="cart-total">
          <div class="cart-total-row"><span style="color:var(--text3)">Subtotal</span><span id="cart-subtotal">$0.00</span></div>
          <div class="cart-total-row total"><span>TOTAL</span><span id="cart-total">$0.00</span></div>
          <button class="btn-checkout" onclick="checkout()"><i class="ti ti-check"></i> Complete Sale</button>
          <button class="btn-clear" onclick="clearCart()">Clear Cart</button>
        </div>
      </div>
    </div>`;

  api('GET', '/api/products/variations').then(vars => { window._variations = vars; });
  loadPosProducts();
  loadPosFilters();

  const scanInput = document.getElementById('scan-input');
  let scanTimeout;
  scanInput.addEventListener('input', () => {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(async () => {
      const val = scanInput.value.trim();
      if (!val) { loadPosProducts(); return; }
      // Try barcode scan first
      const r = await api('GET', `/api/products/scan/${encodeURIComponent(val)}`);
      if (r.id) { addToCart(r); scanInput.value = ''; loadPosProducts(); return; }
      // Search by name
      const products = await api('GET', `/api/products/search?q=${encodeURIComponent(val)}`);
      renderPosGrid(products);
    }, 300);
  });
}

async function loadPosFilters() {
  const [cats, brands] = await Promise.all([api('GET', '/api/products/categories'), api('GET', '/api/products/brands')]);
  const catSel = document.getElementById('pos-category');
  const brandSel = document.getElementById('pos-brand');
  if (catSel) cats.forEach(c => catSel.innerHTML += `<option value="${c}">${c}</option>`);
  if (brandSel) brands.forEach(b => brandSel.innerHTML += `<option value="${b}">${b}</option>`);
}

async function loadPosProducts() {
  const cat = document.getElementById('pos-category')?.value || '';
  const brand = document.getElementById('pos-brand')?.value || '';
  let url = '/api/products?';
  if (cat) url += `category=${encodeURIComponent(cat)}&`;
  if (brand) url += `brand=${encodeURIComponent(brand)}&`;
  const products = await api('GET', url);
  window._posProducts = products;
  renderPosGrid(products);
}

function renderPosGrid(products) {
  const grid = document.getElementById('pos-grid');
  if (!grid) return;
  if (!products.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text3);padding:2rem">No products found</div>'; return; }
  
  const allVars = window._variations || [];
  
  grid.innerHTML = products.slice(0, 100).map(p => {
    const vars = allVars.filter(v => String(v.parent_sku) === String(p.sku));
    const hasVars = p.product_type === 'variable' && vars.length > 0;
    const displayPrice = hasVars ? vars.find(v => v.price > 0)?.price || 0 : (p.sale_price || p.price);
    
    return `
      <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:10px;cursor:pointer;transition:all 0.15s">
        ${p.image_url ? `<img src="${p.image_url}" style="width:100%;height:80px;object-fit:cover;border-radius:8px;margin-bottom:8px" onerror="this.style.display='none'"/>` : '<div style="font-size:2rem;text-align:center;margin-bottom:8px">💄</div>'}
        <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px;line-height:1.3">${p.name}</div>
        <div style="font-size:13px;font-weight:700;color:var(--primary-dark);margin-bottom:6px">$${Number(displayPrice).toFixed(2)}</div>
        ${hasVars ? `
          <div style="display:flex;flex-direction:column;gap:4px;margin-top:6px;border-top:1px solid var(--border);padding-top:6px">
            ${vars.map(v => `
              <div onclick="addToCart(${JSON.stringify(v).replace(/"/g,'&quot;')})" 
                   style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--bg);border-radius:6px;cursor:pointer;font-size:11px"
                   onmouseover="this.style.background='var(--primary-light)'"
                   onmouseout="this.style.background='var(--bg)'">
                <span style="font-weight:500;color:var(--text)">${v.variant_name||v.name}</span>
                <span style="font-weight:700;color:var(--primary-dark)">$${Number(v.sale_price||v.price).toFixed(2)}</span>
              </div>`).join('')}
          </div>` : `
          <div onclick="addToCart(${JSON.stringify(p).replace(/"/g,'&quot;')})" 
               style="padding:6px;background:var(--primary);color:white;border-radius:6px;text-align:center;font-size:12px;font-weight:600;cursor:pointer">
            Add to Cart
          </div>`}
      </div>`;
  }).join('');
}

function addToCart(product) {
  if (product.stock <= 0) { toast('Out of stock!', 'error'); return; }
  const existing = cart.find(i => i.id === product.id);
  if (existing) {
    if (existing.qty >= product.stock) { toast('Not enough stock!', 'error'); return; }
    existing.qty++;
  } else {
    cart.push({ ...product, qty: 1 });
  }
  renderCart();
  toast(`${product.name} added`, 'success');
}

function renderCart() {
  const cartEl = document.getElementById('cart-items');
  if (!cart.length) { cartEl.innerHTML = '<div style="text-align:center;color:var(--text3);padding:2rem;font-size:13px">Cart is empty<br/>Scan a product to start</div>'; updateCartTotal(); return; }
  cartEl.innerHTML = cart.map((item, i) => `
    <div class="cart-item">
      <div class="cart-item-name">${item.name}</div>
      <div class="cart-qty">
        <button onclick="updateQty(${i}, -1)">−</button>
        <span>${item.qty}</span>
        <button onclick="updateQty(${i}, 1)">+</button>
      </div>
      <div class="cart-item-price">$${(Number(item.sale_price||item.price) * item.qty).toFixed(2)}</div>
      <button onclick="removeFromCart(${i})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px">×</button>
    </div>`).join('');
  updateCartTotal();
}

function updateQty(i, delta) {
  cart[i].qty += delta;
  if (cart[i].qty <= 0) cart.splice(i, 1);
  renderCart();
}

function removeFromCart(i) { cart.splice(i, 1); renderCart(); }
function clearCart() { cart = []; renderCart(); }

function updateCartTotal() {
  const sub = cart.reduce((a, i) => a + (Number(i.sale_price||i.price) * i.qty), 0);
  const subEl = document.getElementById('cart-subtotal');
  const totEl = document.getElementById('cart-total');
  if (subEl) subEl.textContent = `$${sub.toFixed(2)}`;
  if (totEl) totEl.textContent = `$${sub.toFixed(2)}`;
}

async function checkout() {
  if (!cart.length) { toast('Cart is empty!', 'error'); return; }
  const numR = await api('GET', '/api/orders/next-num');
  const items = cart.map(i => ({ product_id: i.id, product_name: i.name, sku: i.sku||'', price: Number(i.sale_price||i.price), quantity: i.qty }));
  const r = await api('POST', '/api/orders', { order_num: numR.num, type: 'in-store', status: 'completed', items });
  if (r.id) {
    const settings = await api('GET', '/api/settings');
    showReceipt(numR.num, items, settings);
    cart = [];
    renderCart();
    loadPosProducts();
  } else toast(r.error || 'Error', 'error');
}

function showReceipt(orderNum, items, settings) {
  const total = items.reduce((a, i) => a + (i.price * i.quantity), 0);
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {year:'numeric', month:'long', day:'numeric'});
  const timeStr = now.toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'});
  
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem';
  modal.innerHTML = `
    <div style="background:white;border-radius:16px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden">
      <div id="receipt-content" style="padding:2rem">
        <div style="text-align:center;margin-bottom:1.5rem">
          <div style="font-size:2rem;margin-bottom:8px">💄</div>
          <div style="font-size:18px;font-weight:700;color:#1a1a1a">${settings.store_name||'Poudre Beauty'}</div>
          ${settings.store_address ? `<div style="font-size:12px;color:#888;margin-top:4px">${settings.store_address}</div>` : ''}
          ${settings.store_phone ? `<div style="font-size:12px;color:#888">${settings.store_phone}</div>` : ''}
        </div>
        
        <div style="border-top:1px dashed #ddd;border-bottom:1px dashed #ddd;padding:12px 0;margin-bottom:1rem">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#888;margin-bottom:4px">
            <span>Order #</span><span style="font-weight:600;color:#1a1a1a">${orderNum}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#888;margin-bottom:4px">
            <span>Date</span><span>${dateStr}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#888">
            <span>Time</span><span>${timeStr}</span>
          </div>
        </div>

        <div style="margin-bottom:1rem">
          ${items.map(i => `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:500;color:#1a1a1a">${i.product_name}</div>
                <div style="font-size:11px;color:#888">x${i.quantity} × $${Number(i.price).toFixed(2)}</div>
              </div>
              <div style="font-size:13px;font-weight:600;color:#1a1a1a;margin-left:10px">$${(i.price * i.quantity).toFixed(2)}</div>
            </div>`).join('')}
        </div>

        <div style="border-top:2px solid #1a1a1a;padding-top:12px;margin-bottom:1.5rem">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:16px;font-weight:700">TOTAL</span>
            <span style="font-size:20px;font-weight:700;color:#c8a882">$${total.toFixed(2)}</span>
          </div>
          <div style="font-size:11px;color:#888;margin-top:4px;text-align:right">${settings.currency||'USD'}</div>
        </div>

        <div style="text-align:center;font-size:12px;color:#888;border-top:1px dashed #ddd;padding-top:1rem">
          <div style="margin-bottom:4px">Thank you for your purchase! 🎉</div>
          ${settings.store_email ? `<div>${settings.store_email}</div>` : ''}
        </div>
      </div>

      <div style="display:flex;gap:10px;padding:1rem;border-top:1px solid #eee;background:#fafaf8">
        <button onclick="printReceipt()" style="flex:1;padding:12px;background:#c8a882;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">🖨️ Print</button>
        <button onclick="this.closest('[style*=fixed]').remove()" style="flex:1;padding:12px;background:#f5f5f0;color:#555;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Close</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function printReceipt() {
  const content = document.getElementById('receipt-content').innerHTML;
  const win = window.open('', '_blank', 'width=400,height=600');
  win.document.write(`
    <html><head><title>Receipt</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
      @media print { body { margin: 0; padding: 10px; } }
    </style>
    </head><body>${content}
    <script>window.onload=()=>{window.print();window.close();}<\/script>
    </body></html>`);
  win.document.close();
}
// ─── ORDERS ───
async function loadOrders() {
  const today = new Date().toISOString().split('T')[0];
  const orders = await api('GET', `/api/orders?from=${today}&to=${today}`);
  if (window._ordersRefresh) clearInterval(window._ordersRefresh);
  window._ordersRefresh = setInterval(async () => { 
    if(true) {
      const today2 = new Date().toISOString().split('T')[0];
      const from = document.getElementById('orders-from')?.value || today2;
      const to = document.getElementById('orders-to')?.value || today2;
      const orders = await api('GET', `/api/orders?from=${from}&to=${to}`);
      const tbody = document.querySelector('table tbody');
      if (tbody) {
        const currentCount = tbody.querySelectorAll('tr:not(.empty-row)').length;
        if (orders.length !== currentCount) {
          if (orders.length > currentCount) toast('🛒 New order received!', 'success');
          tbody.innerHTML = orders.length ? orders.map(o => `
            <tr>
              <td style="font-weight:600;color:var(--primary-dark);cursor:pointer" onclick="viewOrder(${o.id})">${o.order_num}</td>
              <td>${o.customer_name||'Walk-in'}</td>
              <td><span class="badge ${o.type==='in-store'?'badge-green':'badge-blue'}">${o.type}</span></td>
              <td style="color:var(--text3)">—</td>
              <td style="font-weight:600">$${Number(o.total).toFixed(2)}</td>
              <td><span class="badge ${o.status==='completed'?'badge-green':o.status==='pending'?'badge-orange':'badge-gray'}">${o.status}</span></td>
              <td style="color:var(--text3);font-size:12px">${new Date(o.created_at).toLocaleString()}</td>
            </tr>`).join('') : '<tr class="empty-row"><td colspan="7">No orders yet</td></tr>';
          const subtitle = document.querySelector('.page-subtitle');
          if (subtitle) subtitle.textContent = `${orders.length} orders`;
        }
      }
    }
  }, 3000);
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Orders</div><div class="page-subtitle">${orders.length} orders</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="date" id="orders-from" class="form-input" value="${today}" style="width:150px"/>
        <span style="color:var(--text3)">to</span>
        <input type="date" id="orders-to" class="form-input" value="${today}" style="width:150px"/>
        <button class="btn btn-primary" onclick="filterOrders()">Filter</button>
        <button class="btn btn-secondary" onclick="filterOrders()"><i class="ti ti-refresh"></i> Refresh</button>
      </div>
    </div>
    <div class="page-body">
      <div class="table-card">
        <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Order #</th><th>Customer</th><th>Type</th><th>Items</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            ${orders.length ? orders.map(o => `
              <tr>
                <td style="font-weight:600;color:var(--primary-dark);cursor:pointer" onclick="viewOrder(${o.id})">${o.order_num}</td>
                <td>${o.customer_name||'Walk-in'}</td>
                <td><span class="badge ${o.type==='in-store'?'badge-green':'badge-blue'}">${o.type}</span></td>
                <td style="color:var(--text3)">—</td>
                <td style="font-weight:600">$${Number(o.total).toFixed(2)}</td>
                <td><span class="badge ${o.status==='completed'?'badge-green':o.status==='pending'?'badge-orange':'badge-gray'}">${o.status}</span></td>
                <td style="color:var(--text3);font-size:12px">${new Date(o.created_at).toLocaleString()}</td>
              </tr>`).join('') : '<tr class="empty-row"><td colspan="7">No orders yet</td></tr>'}
          </tbody>
        </table>
        </div>
      </div>
    </div>`;
}



// ─── REPORTS ───
async function loadReports() {
  const today = new Date().toISOString().split('T')[0];
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const reports = await api('GET', `/api/reports?from=${firstDay}&to=${today}`);
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Reports</div><div class="page-subtitle">This month's performance</div></div>
    </div>
    <div class="page-body">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon" style="background:#fef3e2">💰</div>
          <div class="stat-label">Total Revenue</div>
          <div class="stat-value">$${Number(reports.totalSales||0).toFixed(2)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#edf7f1">🛒</div>
          <div class="stat-label">Total Orders</div>
          <div class="stat-value">${reports.totalOrders||0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#eff6ff">📊</div>
          <div class="stat-label">Avg Order</div>
          <div class="stat-value">$${reports.totalOrders ? (reports.totalSales/reports.totalOrders).toFixed(2) : '0.00'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fdecea">⚠️</div>
          <div class="stat-label">Low Stock</div>
          <div class="stat-value">${reports.lowStock?.length||0}</div>
        </div>
      </div>
      <div class="table-card">
        <div class="table-header"><span class="table-title">Sales by Day</span></div>
        <table>
          <thead><tr><th>Date</th><th class="text-right">Revenue</th></tr></thead>
          <tbody>
            ${Object.entries(reports.byDay||{}).sort((a,b)=>b[0].localeCompare(a[0])).map(([d,v])=>`
              <tr><td>${new Date(d).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</td><td class="text-right" style="font-weight:600">$${Number(v).toFixed(2)}</td></tr>`).join('') || '<tr class="empty-row"><td colspan="2">No sales data</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}








async function viewOrder(id) {
  const o = await api('GET', `/api/orders/${id}`);
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:550px">
      <div class="modal-header">
        <span class="modal-title">Order ${o.order_num}</span>
        <button class="modal-close" onclick="this.closest('.modal-bg').remove()"><i class="ti ti-x"></i></button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:1.5rem">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Customer</div>
            <div style="font-size:14px;font-weight:600">${o.customer_name||'—'}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Phone</div>
            <div style="font-size:14px">${o.customer_phone||'—'}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Email</div>
            <div style="font-size:14px">${o.customer_email||'—'}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Status</div>
            <span class="badge ${o.status==='completed'?'badge-green':o.status==='pending'?'badge-orange':'badge-gray'}">${o.status}</span>
          </div>
          <div class="full" style="grid-column:1/-1">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Address / Notes</div>
            <div style="font-size:14px;color:var(--text2)">${o.notes||'—'}</div>
          </div>
        </div>
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:8px">Items</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--surface2)">
            <th style="padding:8px;text-align:left;font-size:11px;color:var(--text3)">Product</th>
            <th style="padding:8px;text-align:center;font-size:11px;color:var(--text3)">Qty</th>
            <th style="padding:8px;text-align:right;font-size:11px;color:var(--text3)">Price</th>
          </tr></thead>
          <tbody>
            ${(o.items||[]).map(i => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:8px;font-size:13px">${i.product_name}</td>
                <td style="padding:8px;text-align:center;font-size:13px">${i.quantity}</td>
                <td style="padding:8px;text-align:right;font-size:13px;font-weight:600">$${(i.price*i.quantity).toFixed(2)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div style="display:flex;justify-content:space-between;padding:12px 8px;font-weight:700;font-size:15px;border-top:2px solid var(--border);margin-top:8px">
          <span>TOTAL</span>
          <span>$${Number(o.total).toFixed(2)}</span>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="this.closest('.modal-bg').remove()">Close</button>
        ${o.status !== 'completed' ? `
  <button class="btn-danger" onclick="declineOrder(${o.id})">✕ Decline</button>
  <button class="btn-save" onclick="completeOrder(${o.id})">✓ Mark as Completed</button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(modal);
}





async function declineOrder(id) {
  if (!confirm('Decline and delete this order?')) return;
  await api('DELETE', `/api/orders/${id}`);
  document.querySelectorAll('.modal-bg').forEach(m => m.remove());
  toast('Order declined', 'error');
  filterOrders();
}










// ─── SETTINGS ───
async function loadSettings() {
  const s = await api('GET', '/api/settings');
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Settings</div></div>
      <button class="btn btn-primary" onclick="saveSettings()"><i class="ti ti-check"></i> Save</button>
    </div>
    <div class="page-body">
      <div class="table-card" style="padding:1.5rem">
        <div class="modal-grid2">
          <div class="form-group full"><label class="form-label">Store Name</label><input class="form-input" id="s-name" value="${s.store_name||''}"/></div>
          <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="s-email" value="${s.store_email||''}"/></div>
          <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="s-phone" value="${s.store_phone||''}"/></div>
          <div class="form-group full"><label class="form-label">Address</label><input class="form-input" id="s-address" value="${s.store_address||''}"/></div>
          <div class="form-group"><label class="form-label">Currency</label>
            <select class="form-input" id="s-currency">
              <option ${s.currency==='USD'?'selected':''}>USD</option>
              <option ${s.currency==='LBP'?'selected':''}>LBP</option>
              <option ${s.currency==='EUR'?'selected':''}>EUR</option>
              <option ${s.currency==='KWD'?'selected':''}>KWD</option>
            </select>
          </div>
        </div>
      </div>
    </div>`;
}

async function saveSettings() {
  const data = {
    store_name: document.getElementById('s-name').value,
    store_email: document.getElementById('s-email').value,
    store_phone: document.getElementById('s-phone').value,
    store_address: document.getElementById('s-address').value,
    currency: document.getElementById('s-currency').value,
  };
  const r = await api('POST', '/api/settings', data);
  if (r.success) toast('Settings saved!', 'success');
  else toast('Error saving settings', 'error');
}




async function filterOrders() {
  const from = document.getElementById('orders-from')?.value || new Date().toISOString().split('T')[0];
  const to = document.getElementById('orders-to')?.value || new Date().toISOString().split('T')[0];
  const orders = await api('GET', `/api/orders?from=${from}&to=${to}`);
  
  const tbody = document.querySelector('table tbody');
  if (tbody) {
    tbody.innerHTML = orders.length ? orders.map(o => `
      <tr>
        <td style="font-weight:600;color:var(--primary-dark);cursor:pointer" onclick="viewOrder(${o.id})">${o.order_num}</td>
        <td>${o.customer_name||'Walk-in'}</td>
        <td><span class="badge ${o.type==='in-store'?'badge-green':'badge-blue'}">${o.type}</span></td>
        <td style="color:var(--text3)">—</td>
        <td style="font-weight:600">$${Number(o.total).toFixed(2)}</td>
        <td><span class="badge ${o.status==='completed'?'badge-green':o.status==='pending'?'badge-orange':'badge-gray'}">${o.status}</span></td>
        <td style="color:var(--text3);font-size:12px">${new Date(o.created_at).toLocaleString()}</td>
      </tr>`).join('') : '<tr class="empty-row"><td colspan="7">No orders yet</td></tr>';
  }
  
  const subtitle = document.querySelector('.page-subtitle');
  if (subtitle) subtitle.textContent = `${orders.length} orders`;
}



async function showVariantPicker(productId) {
  const variations = (window._posProducts||[]).filter(p => p.parent_sku == productId || String(p.parent_sku) === String(productId));
  
  // Also check from _variations
  const allVars = (window._variations||[]).filter(v => String(v.parent_sku) === String(productId));
  const vars = allVars.length ? allVars : variations;
  
  if (!vars.length) { toast('No variants available', 'error'); return; }
  
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem';
  modal.innerHTML = `
    <div style="background:white;border-radius:16px;width:100%;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden">
      <div style="padding:1.25rem 1.5rem;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:15px;font-weight:700">Choose Variant</span>
        <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#888">×</button>
      </div>
      <div style="padding:1rem;max-height:400px;overflow-y:auto">
        ${vars.map(v => `
          <div onclick="addToCart(${JSON.stringify(v).replace(/"/g,'&quot;')});this.closest('[style*=fixed]').remove()" 
               style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1.5px solid #eee;border-radius:10px;margin-bottom:8px;cursor:pointer;transition:all 0.15s"
               onmouseover="this.style.borderColor='#c8a882';this.style.background='#fdf8f3'"
               onmouseout="this.style.borderColor='#eee';this.style.background='white'">
            <div>
              <div style="font-size:13px;font-weight:600;color:#1a1a1a">${v.variant_name||v.name}</div>
              <div style="font-size:11px;color:#888;margin-top:2px">SKU: ${v.sku||'—'} · Stock: ${v.stock}</div>
            </div>
            <div style="font-size:14px;font-weight:700;color:#c8a882">$${Number(v.sale_price||v.price).toFixed(2)}</div>
          </div>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function handlePosClick(id, type, product) {
  if (type === 'variable') {
    showVariantPicker(id);
  } else {
    addToCart(product);
  }
}






async function completeOrder(id) {
  const r = await api('PATCH', `/api/orders/${id}/status`, { status: 'completed' });
  if (r.success) { 
    toast('Order completed!', 'success'); 
    document.querySelectorAll('.modal-bg').forEach(m => m.remove());
    filterOrders(); 
  }
  else toast('Error', 'error');
}













// ─── START ───
init();