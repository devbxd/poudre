// ─── STATE ───
let cart = JSON.parse(localStorage.getItem('pb_cart') || '[]');
let wishlist = JSON.parse(localStorage.getItem('pb_wishlist') || '[]');
let currentUser = JSON.parse(localStorage.getItem('pb_user') || 'null');
let currentCategory = 'all';
let shopOffset = 0;
let shopLoading = false;
let maxPrice = 500;
let allVariations = {};

// ─── INIT ───
window.addEventListener('DOMContentLoaded', async () => {
  updateCartUI();
  updateWishlistUI();
  updateUserUI();
  
  const params = new URLSearchParams(window.location.search);
  const cat = params.get('cat');
  
  if (cat) {
    showCategory(cat);
  } else {
    showPage('home');
    loadHomeProducts();
  }
  
  loadSidebarCategories();
});

// ─── API ───
async function apiFetch(url, options = {}) {
  const r = await fetch(url, options);
  return r.json();
}

// ─── PAGES ───
function showPage(page) {
  ['home', 'shop', 'checkout', 'success', 'search', 'wishlist', 'product', 'contact', 'about', 'terms', 'account', 'orders-history'].forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.remove('hidden');
  window.scrollTo(0, 0);
}

// ─── HOME ───
async function loadHomeProducts() {
  const products = await apiFetch('/api/shop/products?limit=8&offset=0');
  renderProducts(products, 'home-products');
}

// ─── CATEGORIES ───
async function showCategory(cat) {
  currentCategory = cat;
  shopOffset = 0;
  showPage('shop');
  document.getElementById('shop-title').textContent = cat === 'all' ? 'All Products' : cat;
  document.getElementById('shop-products').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem"><div class="spinner"></div></div>';
  document.querySelectorAll('.sidebar-cat').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  await loadShopProducts();
}

async function loadShopProducts(append = false) {
  if (shopLoading) return;
  shopLoading = true;
  let url = `/api/shop/products?offset=${shopOffset}&limit=24`;
  if (currentCategory && currentCategory !== 'all') url += `&category=${encodeURIComponent(currentCategory)}`;
  if (maxPrice < 500) url += `&max_price=${maxPrice}`;
  const products = await apiFetch(url);
  shopLoading = false;
  const countEl = document.getElementById('shop-count');
  if (countEl) countEl.textContent = `${products.length} products`;
  if (append) renderProducts(products, 'shop-products', true);
  else renderProducts(products, 'shop-products');
  shopOffset += products.length;
}

async function loadSidebarCategories() {
  const cats = await apiFetch('/api/products/categories');
  const container = document.getElementById('sidebar-cats');
  if (!container) return;
  container.innerHTML = `<button class="sidebar-cat active" data-cat="all" onclick="showCategory('all')">All Products</button>` +
    cats.map(c => `<button class="sidebar-cat" data-cat="${c}" onclick="showCategory('${c.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">${c}</button>`).join('');
}

// ─── RENDER PRODUCTS ───
async function renderProducts(products, containerId, append = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const html = await Promise.all(products.map(async p => {
    const isVariable = p.product_type === 'variable';
    const price = p.sale_price && p.sale_price > 0 ? p.sale_price : p.price;
    const oldPrice = p.sale_price > 0 && p.price > p.sale_price ? p.price : null;
    const discount = oldPrice ? Math.round((1 - price/oldPrice) * 100) : null;
    const hasPrice = price > 0;

    // Get variations for variable products
    let variationsHtml = '';
    if (isVariable && p.sku) {
      const vars = await apiFetch(`/api/shop/variations/${p.sku}`);
      if (vars.length) {
        variationsHtml = `
          <div class="product-variants-list">
            ${vars.map(v => `
              <div class="variant-item" onclick="event.stopPropagation();addVariantToCart(${JSON.stringify(v).replace(/"/g,'&quot;')})">
                <span class="variant-name">${v.variant_name || v.name}</span>
                <span class="variant-price">${v.price > 0 ? '$'+Number(v.sale_price||v.price).toFixed(2) : ''}</span>
              </div>`).join('')}
          </div>`;
      }
    }

    return `
      <div class="product-card" onclick="openProduct(${p.id}, '${p.product_type}', '${(p.sku||'').replace(/'/g,"\\'")}')">
        <div class="product-img-wrap">
          <button class="wishlist-btn" data-id="${p.id}" onclick="toggleWishlist(${p.id}, '${p.name.replace(/'/g,"\\'")}', event)" style="position:absolute;top:8px;right:8px;background:white;border:none;border-radius:50%;width:32px;height:32px;font-size:16px;cursor:pointer;z-index:1;box-shadow:0 2px 6px rgba(0,0,0,0.1)">♡</button>
          ${p.image_url ? `<img src="${p.image_url}" alt="${p.name.replace(/"/g,'&quot;')}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=product-img-placeholder>💄</div>'"/>` : '<div class="product-img-placeholder">💄</div>'}
          ${discount ? `<span class="sale-badge">-${discount}%</span>` : ''}
        </div>
        <div class="product-name">${p.name}</div>
        ${hasPrice ? `
          <div class="product-price">
            <span class="price-current">$${Number(price).toFixed(2)}</span>
            ${oldPrice ? `<span class="price-old">$${Number(oldPrice).toFixed(2)}</span>` : ''}
          </div>` : ''}
        ${variationsHtml}
        ${!isVariable ? `<button class="add-to-cart-btn" onclick="event.stopPropagation();quickAddToCart(${p.id}, '${p.product_type}', '${(p.sku||'').replace(/'/g,"\\'")}')">Add to Cart</button>` : ''}
      </div>`;
  }));

  if (append) container.innerHTML += html.join('');
  else container.innerHTML = html.join('') || '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#888">No products found</div>';
  
  setTimeout(updateWishlistUI, 100);
}

// ─── PRODUCT PAGE ───
async function openProduct(id, type, sku) {
  const p = await apiFetch(`/api/products/${id}`);
  await showProductPage(p, type, sku);
}

async function quickAddToCart(id, type, sku) {
  const p = await apiFetch(`/api/products/${id}`);
  if (type === 'variable') {
    await showProductPage(p, type, sku);
  } else {
    addToCart(p);
  }
}

async function showProductPage(p, type, sku) {
  const variations = type === 'variable' && sku ? await apiFetch(`/api/shop/variations/${sku}`) : [];
  showPage('product');
  const price = p.sale_price && p.sale_price > 0 ? p.sale_price : p.price;
  const oldPrice = p.sale_price > 0 && p.price > p.sale_price ? p.price : null;
  const discount = oldPrice ? Math.round((1 - price/oldPrice) * 100) : null;
  const hasPrice = price > 0;

  document.getElementById('page-product').innerHTML = `
    <div class="container" style="padding:2rem 0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:1.5rem">
        <button onclick="showPage('shop')" style="background:none;border:none;cursor:pointer;font-size:13px;color:#888;display:flex;align-items:center;gap:4px;padding:8px 0;min-height:44px">← Back</button>
        <span style="color:#ccc">|</span>
        <span style="font-size:12px;color:#888">Home › ${p.category?.split('>').pop()?.trim() || 'Shop'} › ${p.name}</span>
      </div>
      <div class="product-page-layout">
        <div class="product-page-img">
          ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" style="width:100%;height:100%;object-fit:contain" onerror="this.parentElement.innerHTML='<div style=font-size:6rem;text-align:center>💄</div>'"/>` : '<div style="font-size:6rem;text-align:center">💄</div>'}
        </div>
        <div class="product-page-info">
          <div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#888;margin-bottom:8px">${p.category||''}</div>
          <h1 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:400;margin-bottom:1rem;line-height:1.2">${p.name}</h1>
          ${hasPrice ? `
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:1.5rem">
              <span style="font-size:1.5rem;font-weight:600">$${Number(price).toFixed(2)}</span>
              ${oldPrice ? `<span style="font-size:1.1rem;color:#888;text-decoration:line-through">$${Number(oldPrice).toFixed(2)}</span>` : ''}
              ${discount ? `<span style="background:#fdecea;color:#e74c3c;padding:3px 10px;border-radius:20px;font-size:13px;font-weight:600">-${discount}%</span>` : ''}
            </div>` : ''}
          ${variations.length ? `
            <div style="margin-bottom:1.5rem">
              <div style="font-size:13px;font-weight:600;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em">Choose Variant</div>
              <div style="display:flex;flex-direction:column;gap:8px" id="variant-list">
                ${variations.map(v => `
                  <div onclick="selectVariant(this, ${JSON.stringify(v).replace(/"/g,'&quot;')})" 
                       class="variant-row"
                       style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border:1.5px solid #eee;cursor:pointer;border-radius:4px;transition:all 0.15s;-webkit-tap-highlight-color:transparent">
                    <span style="font-size:14px;font-weight:500">${v.variant_name||v.name}</span>
                    <span style="font-size:14px;font-weight:600">${v.price > 0 ? '$'+Number(v.sale_price||v.price).toFixed(2) : '—'}</span>
                  </div>`).join('')}
              </div>
            </div>
            <button onclick="addSelectedVariant()" style="width:100%;padding:16px;border:1.5px solid #1a1a1a;background:white;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;margin-bottom:10px;-webkit-tap-highlight-color:transparent">ADD TO CART</button>
            <button onclick="buySelectedVariant()" style="width:100%;padding:16px;background:#1a1a1a;color:white;border:none;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;margin-bottom:1.5rem;">BUY IT NOW</button>
          ` : `
            <button onclick="addToCart(${JSON.stringify(p).replace(/"/g,'&quot;')})" style="width:100%;padding:16px;border:1.5px solid #1a1a1a;background:white;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;margin-bottom:10px;">ADD TO CART</button>
            <button onclick="addToCart(${JSON.stringify(p).replace(/"/g,'&quot;')});goCheckout()" style="width:100%;padding:16px;background:#1a1a1a;color:white;border:none;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;margin-bottom:1.5rem;">BUY IT NOW</button>
          `}
          <div style="border-top:1px solid #eee;padding-top:1rem;margin-top:1rem">
            <div style="display:flex;gap:1rem;margin-bottom:1rem">
              <button style="flex:1;padding:10px;border:1px solid #eee;background:white;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
                ⇄ Compare
              </button>
              <button onclick="navigator.share ? navigator.share({title:'${p.name.replace(/'/g,"\\'")}',url:window.location.href}) : showToast('Link copied!')" style="flex:1;padding:10px;border:1px solid #eee;background:white;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
                ↗ Share Products
              </button>
            </div>
            <div style="font-size:13px;color:#555;margin-bottom:8px">🕐 <strong>Estimated Delivery:</strong> ${getDeliveryDate()}</div>
            <div style="font-size:13px;color:#555;margin-bottom:8px">👁 <strong>${Math.floor(Math.random()*8)+2} People viewing this product right now!</strong></div>
            ${p.sku ? `<div style="font-size:13px;color:#888;margin-bottom:4px">SKU: ${p.sku}</div>` : ''}
            ${p.category ? `<div style="font-size:13px;color:#888">Tags: ${p.category.split(',').slice(0,3).join(', ')}</div>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  
  window._currentProduct = p;
  window._selectedVariant = null;
  
  // Related products
  const related = await apiFetch(`/api/shop/products?category=${encodeURIComponent(p.category?.split('>')[0]?.trim()||'')}&limit=5&offset=0`);
  const relatedFiltered = related.filter(r => r.id !== p.id).slice(0, 4);
  document.getElementById('page-product').innerHTML += `
    <div class="container" style="padding:0 0 3rem">
      <h2 style="font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:400;margin-bottom:1.5rem">Related Products</h2>
      <div class="products-grid" id="related-grid"></div>
    </div>`;
  renderProducts(relatedFiltered, 'related-grid');
}

function getDeliveryDate() {
  const d1 = new Date(); d1.setDate(d1.getDate() + 3);
  const d2 = new Date(); d2.setDate(d2.getDate() + 7);
  return `${d1.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${d2.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
}

function selectVariant(el, v) {
  window._selectedVariant = v;
  document.querySelectorAll('.variant-row').forEach(r => { r.style.borderColor='#eee'; r.style.background='white'; r.classList.remove('selected'); });
  el.style.borderColor = '#1a1a1a';
  el.style.background = '#f5f4f2';
  el.classList.add('selected');
}

function addSelectedVariant() {
  if (!window._selectedVariant) { showToast('Please select a variant'); return; }
  addToCart(window._selectedVariant);
}

function buySelectedVariant() {
  if (!window._selectedVariant) { showToast('Please select a variant'); return; }
  addToCart(window._selectedVariant);
  goCheckout();
}

function addVariantToCart(v) {
  addToCart(v);
}

// ─── CART ───
function addToCart(product) {
  if (product.stock !== undefined && product.stock <= 0) { showToast('Out of stock!'); return; }
  const existing = cart.find(i => i.id === product.id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id: product.id, name: product.name, variant_name: product.variant_name || null, price: Number(product.sale_price || product.price), image_url: product.image_url || '', stock: product.stock, qty: 1 });
  }
  saveCart();
  updateCartUI();
  showToast(`${product.variant_name || product.name} added ✓`);
  toggleCart(true);
}

function updateCartUI() {
  const count = cart.reduce((a, i) => a + i.qty, 0);
  const countEl = document.getElementById('cart-count');
  if (countEl) countEl.textContent = count;
  const total = cart.reduce((a, i) => a + (i.price * i.qty), 0);
  const totalEl = document.getElementById('cart-total-drawer');
  if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
  const itemsEl = document.getElementById('cart-items-drawer');
  if (!itemsEl) return;
  if (!cart.length) { itemsEl.innerHTML = '<div class="cart-empty">Your cart is empty</div>'; return; }
  itemsEl.innerHTML = cart.map((item, i) => `
    <div class="cart-item">
      ${item.image_url ? `<img class="cart-item-img" src="${item.image_url}" onerror="this.style.display='none'"/>` : '<div class="cart-item-img" style="background:#f5f4f2;display:flex;align-items:center;justify-content:center;font-size:1.5rem">💄</div>'}
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        ${item.variant_name ? `<div class="cart-item-variant">${item.variant_name}</div>` : ''}
        <div class="cart-item-price">$${(item.price * item.qty).toFixed(2)}</div>
        <div class="cart-item-qty">
          <button onclick="updateQty(${i}, -1)">−</button>
          <span>${item.qty}</span>
          <button onclick="updateQty(${i}, 1)">+</button>
        </div>
      </div>
      <button class="cart-item-remove" onclick="removeFromCart(${i})">✕</button>
    </div>`).join('');
}

function updateQty(i, delta) { cart[i].qty += delta; if (cart[i].qty <= 0) cart.splice(i, 1); saveCart(); updateCartUI(); }
function removeFromCart(i) { cart.splice(i, 1); saveCart(); updateCartUI(); }
function saveCart() { localStorage.setItem('pb_cart', JSON.stringify(cart)); }

function toggleCart(forceOpen = false) {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-overlay');
  const isOpen = drawer.classList.contains('open');
  if (forceOpen || !isOpen) { drawer.classList.add('open'); drawer.classList.remove('hidden'); overlay.classList.remove('hidden'); }
  else { drawer.classList.remove('open'); setTimeout(() => drawer.classList.add('hidden'), 300); overlay.classList.add('hidden'); }
}

// ─── WISHLIST ───
function toggleWishlist(productId, productName, e) {
  e.stopPropagation();
  const idx = wishlist.findIndex(i => i.id === productId);
  if (idx >= 0) { wishlist.splice(idx, 1); showToast('Removed from wishlist'); }
  else { wishlist.push({ id: productId, name: productName }); showToast('Added to wishlist ♡'); }
  localStorage.setItem('pb_wishlist', JSON.stringify(wishlist));
  updateWishlistUI();
}

function updateWishlistUI() {
  document.querySelectorAll('.wishlist-btn').forEach(btn => {
    const id = parseInt(btn.dataset.id);
    const isWished = wishlist.some(i => i.id === id);
    btn.innerHTML = isWished ? '♥' : '♡';
    btn.style.color = isWished ? '#e74c3c' : '#888';
  });
  const countEl = document.getElementById('wishlist-count');
  if (countEl) countEl.textContent = wishlist.length;
}

async function showWishlistPage() {
  showPage('wishlist');
  const container = document.getElementById('wishlist-products');
  if (!wishlist.length) { container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#888">Your wishlist is empty</div>'; return; }
  container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem"><div class="spinner"></div></div>';
  const ids = wishlist.map(i => i.id).join(',');
  const products = await apiFetch(`/api/shop/wishlist?ids=${ids}`);
  renderProducts(products, 'wishlist-products');
}

// ─── SEARCH ───
function toggleSearch() {
  const bar = document.getElementById('search-bar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) document.getElementById('search-input').focus();
}

let searchTimeout;
async function handleSearch(val) {
  clearTimeout(searchTimeout);
  if (!val.trim()) return;
  searchTimeout = setTimeout(async () => {
    const products = await apiFetch(`/api/shop/products?search=${encodeURIComponent(val)}&limit=24&offset=0`);
    showPage('search');
    document.getElementById('search-title').textContent = `Results for "${val}" (${products.length})`;
    renderProducts(products, 'search-products');
  }, 400);
}

// ─── USER ACCOUNT ───
function updateUserUI() {
  const btn = document.getElementById('account-btn');
  if (!btn) return;
  if (currentUser) {
    btn.title = currentUser.name;
    btn.style.color = '#c8a882';
  }
}

function showAccountPage() {
  if (currentUser) {
    showUserDashboard();
  } else {
    showPage('account');
  }
}

function showUserDashboard() {
  showPage('account');
  document.getElementById('page-account').innerHTML = `
    <div class="container" style="padding:3rem 0;max-width:600px">
      <h2 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:400;margin-bottom:2rem">My Account</h2>
      <div style="background:#f5f4f2;padding:1.5rem;border-radius:8px;margin-bottom:1.5rem">
        <div style="font-weight:600;margin-bottom:4px">${currentUser.name}</div>
        <div style="color:#888;font-size:13px">${currentUser.email}</div>
      </div>
      <button onclick="showOrderHistory()" style="width:100%;padding:14px;border:1.5px solid #1a1a1a;background:white;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:10px;">View Order History</button>
      <button onclick="logoutUser()" style="width:100%;padding:14px;background:#f5f4f2;border:none;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;cursor:pointer;color:#888;">Sign Out</button>
    </div>`;
}

async function showOrderHistory() {
  showPage('orders-history');
  const container = document.getElementById('page-orders-history');
  container.innerHTML = '<div style="text-align:center;padding:3rem"><div class="spinner"></div></div>';
  const orders = await apiFetch(`/api/shop/my-orders?email=${encodeURIComponent(currentUser.email)}`);
  container.innerHTML = `
    <div class="container" style="padding:3rem 0;max-width:700px">
      <button onclick="showAccountPage()" style="background:none;border:none;cursor:pointer;color:#888;font-size:13px;margin-bottom:1.5rem">← Back</button>
      <h2 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:400;margin-bottom:1.5rem">Order History</h2>
      ${orders.length ? orders.map(o => `
        <div style="border:1px solid #eee;border-radius:8px;padding:1.25rem;margin-bottom:1rem">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px">
            <span style="font-weight:600">${o.order_num}</span>
            <span class="badge ${o.status==='completed'?'badge-green':'badge-orange'}">${o.status}</span>
          </div>
          <div style="font-size:13px;color:#888">${new Date(o.created_at).toLocaleDateString()}</div>
          <div style="font-size:15px;font-weight:600;margin-top:8px">$${Number(o.total).toFixed(2)}</div>
        </div>`).join('') : '<div style="text-align:center;color:#888;padding:2rem">No orders yet</div>'}
    </div>`;
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem('pb_user');
  updateUserUI();
  showPage('home');
  showToast('Signed out successfully');
}

// ─── CHECKOUT ───
function goCheckout() {
  toggleCart();
  showPage('checkout');
  renderSummary();
  
  // Pre-fill if logged in
  if (currentUser) {
    const emailEl = document.getElementById('co-email');
    const firstEl = document.getElementById('co-first');
    const lastEl = document.getElementById('co-last');
    const phoneEl = document.getElementById('co-phone');
    if (emailEl) emailEl.value = currentUser.email;
    if (firstEl) firstEl.value = currentUser.name.split(' ')[0] || '';
    if (lastEl) lastEl.value = currentUser.name.split(' ')[1] || '';
    if (phoneEl) phoneEl.value = currentUser.phone || '';
  }
}

function renderSummary() {
  const items = document.getElementById('summary-items');
  const subtotal = cart.reduce((a, i) => a + (i.price * i.qty), 0);
  if (!items) return;
  items.innerHTML = cart.map(item => `
    <div class="summary-item">
      <div style="position:relative">
        ${item.image_url ? `<img class="summary-item-img" src="${item.image_url}" onerror="this.style.display='none'"/>` : '<div class="summary-item-img" style="background:#f5f4f2;display:flex;align-items:center;justify-content:center;font-size:1.5rem">💄</div>'}
        <span class="summary-item-qty">${item.qty}</span>
      </div>
      <div class="summary-item-info">
        <div class="summary-item-name">${item.name}${item.variant_name ? ` — ${item.variant_name}` : ''}</div>
        <div class="summary-item-price">$${(item.price * item.qty).toFixed(2)}</div>
      </div>
    </div>`).join('');
  document.getElementById('summary-subtotal').textContent = `$${subtotal.toFixed(2)}`;
  updateTotal();
}

function updateTotal() {
  const subtotal = cart.reduce((a, i) => a + (i.price * i.qty), 0);
  const shippingVal = document.querySelector('input[name="shipping"]:checked')?.value || 'free';
  const shipping = shippingVal === '4' ? 4 : 0;
  const total = subtotal + shipping;
  const deliveryEl = document.getElementById('summary-delivery');
  const totalEl = document.getElementById('summary-total');
  if (deliveryEl) deliveryEl.textContent = shipping === 0 ? 'Free' : `$${shipping.toFixed(2)}`;
  if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
}

function setDelivery(type, btn) {
  document.querySelectorAll('.delivery-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const shippingSection = document.getElementById('shipping-section');
  if (shippingSection) shippingSection.style.display = type === 'pickup' ? 'none' : 'block';
}

function toggleNote() {
  const note = document.getElementById('co-note');
  if (note) note.classList.toggle('hidden');
}

async function placeOrder() {
  if (!cart.length) { showToast('Your cart is empty!'); return; }
  const email = document.getElementById('co-email')?.value;
  const firstName = document.getElementById('co-first')?.value || '';
  const lastName = document.getElementById('co-last')?.value || '';
  const phone = document.getElementById('co-phone')?.value || '';
  const address = document.getElementById('co-address')?.value || '';
  const city = document.getElementById('co-city')?.value || '';
  const note = document.getElementById('co-note')?.value || '';
  const shippingVal = document.querySelector('input[name="shipping"]:checked')?.value || 'free';
  if (!email) { showToast('Please enter your email'); return; }
  if (!firstName || !phone) { showToast('Please fill in required fields'); return; }
  const subtotal = cart.reduce((a, i) => a + (i.price * i.qty), 0);
  const shipping = shippingVal === '4' ? 4 : 0;
  const total = subtotal + shipping;
  const items = cart.map(i => ({ product_id: i.id, product_name: i.name + (i.variant_name ? ` — ${i.variant_name}` : ''), price: i.price, quantity: i.qty }));
  const numR = await apiFetch('/api/orders/next-num');
  const r = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_num: numR.num, customer_name: `${firstName} ${lastName}`.trim(), customer_email: email, customer_phone: phone, type: 'online', status: 'pending', items, discount: 0, notes: `Address: ${address}, ${city}${note ? '\n' + note : ''}` })
  });
  const result = await r.json();
  if (result.id) {
    // Save order to user account
    if (currentUser) {
      const orders = JSON.parse(localStorage.getItem(`pb_orders_${currentUser.email}`) || '[]');
      orders.unshift({ order_num: numR.num, total, status: 'pending', created_at: new Date().toISOString() });
      localStorage.setItem(`pb_orders_${currentUser.email}`, JSON.stringify(orders));
    }
    cart = []; saveCart(); updateCartUI(); showPage('success');
  } else { showToast('Error placing order. Please try again.'); }
}

// ─── SORT / FILTER ───
function sortProducts(val) {
  const grid = document.getElementById('shop-products');
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll('.product-card'));
  cards.sort((a, b) => {
    const nameA = a.querySelector('.product-name')?.textContent || '';
    const nameB = b.querySelector('.product-name')?.textContent || '';
    const priceA = parseFloat(a.querySelector('.price-current')?.textContent?.replace('$','') || 0);
    const priceB = parseFloat(b.querySelector('.price-current')?.textContent?.replace('$','') || 0);
    if (val === 'price-asc') return priceA - priceB;
    if (val === 'price-desc') return priceB - priceA;
    if (val === 'name') return nameA.localeCompare(nameB);
    return 0;
  });
  cards.forEach(c => grid.appendChild(c));
}

function filterByPrice(val) {
  maxPrice = parseInt(val);
  document.getElementById('price-max-label').textContent = `$${val}`;
  shopOffset = 0;
  loadShopProducts();
}

// ─── MOBILE MENU ───
function openMobileMenu() {
  document.getElementById('mob-menu').classList.add('open');
  document.getElementById('mob-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeMobileMenu() {
  document.getElementById('mob-menu').classList.remove('open');
  document.getElementById('mob-overlay').classList.remove('open');
  document.body.style.overflow = '';
}
function toggleMobileSub(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}
function mobileCat(cat) {
  closeMobileMenu();
  showCategory(cat);
}
// ─── INFINITE SCROLL ───
window.addEventListener('scroll', () => {
  if (document.getElementById('page-shop')?.classList.contains('hidden')) return;
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400) loadShopProducts(true);
});

// ─── TOAST ───
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}