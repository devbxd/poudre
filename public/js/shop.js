// ─── STATE ───
let cart = JSON.parse(localStorage.getItem('pb_cart') || '[]');
let allProducts = [];
let currentCategory = 'all';
let shopOffset = 0;
let shopLoading = false;
let maxPrice = 500;

// ─── INIT ───
window.addEventListener('DOMContentLoaded', async () => {
  updateCartUI();
  
  // Check URL params
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
async function apiFetch(url) {
  const r = await fetch(url);
  return r.json();
}

// ─── PAGES ───
function showPage(page) {
['home', 'shop', 'checkout', 'success', 'search', 'wishlist', 'product', 'contact', 'about', 'terms'].forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.remove('hidden');
  window.scrollTo(0, 0);
}

// ─── HOME ───
async function loadHomeProducts() {
  const products = await apiFetch('/api/shop/products?limit=8');
  renderProducts(products, 'home-products');
}

// ─── CATEGORIES ───
async function showCategory(cat) {
  currentCategory = cat;
  shopOffset = 0;
  showPage('shop');
  
  // Update title
  document.getElementById('shop-title').textContent = cat === 'all' ? 'All Products' : cat;
  document.getElementById('shop-products').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem"><div class="spinner"></div></div>';
  
  // Update active sidebar
  document.querySelectorAll('.sidebar-cat').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === cat);
  });
  
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
  
  document.getElementById('shop-count').textContent = `${products.length} products`;
  
  if (append) {
    renderProducts(products, 'shop-products', true);
  } else {
    renderProducts(products, 'shop-products');
  }
  
  shopOffset += products.length;
}

async function loadSidebarCategories() {
  const cats = await apiFetch('/api/products/categories');
  const container = document.getElementById('sidebar-cats');
  container.innerHTML = `<button class="sidebar-cat active" data-cat="all" onclick="showCategory('all')">All Products</button>` +
    cats.map(c => `<button class="sidebar-cat" data-cat="${c}" onclick="showCategory('${c.replace(/'/g, "\\'")}')">${c}</button>`).join('');
}

// ─── PRODUCTS RENDER ───
async function renderProducts(products, containerId, append = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  // Get variations for variable products
  const variableIds = products.filter(p => p.product_type === 'variable').map(p => p.sku);
  
  const html = products.map(p => {
    const price = p.sale_price && p.sale_price > 0 ? p.sale_price : (p.price > 0 ? p.price : null);
    const oldPrice = p.sale_price && p.sale_price > 0 && p.price > p.sale_price ? p.price : null;
    const discount = oldPrice ? Math.round((1 - price/oldPrice) * 100) : null;
    
    return `
      <div class="product-card" onclick="openProduct(${p.id}, '${p.product_type}', '${p.sku?.replace(/'/g, "\\'")||''}')">
        <div class="product-img-wrap">
  <button class="wishlist-btn" data-id="${p.id}" onclick="toggleWishlist(${p.id}, '${p.name.replace(/'/g,"\\'")}', event)" style="position:absolute;top:8px;right:8px;background:white;border:none;border-radius:50%;width:32px;height:32px;font-size:16px;cursor:pointer;z-index:1;box-shadow:0 2px 6px rgba(0,0,0,0.1)">♡</button>
          ${p.image_url ? `<img src="${p.image_url}" alt="${p.name.replace(/"/g,'&quot;')}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=product-img-placeholder>💄</div>'"/>` : '<div class="product-img-placeholder">💄</div>'}
          ${discount ? `<span class="sale-badge">Sale</span>` : ''}
        </div>
        <div class="product-name">${p.name}</div>
        <div class="product-price">
          <span class="price-current">${price ? '$'+Number(price).toFixed(2) : 'From $'+Number(p.price||0).toFixed(2)}</span>
          ${oldPrice ? `<span class="price-old">$${Number(oldPrice).toFixed(2)}</span>` : ''}
          ${discount ? `<span class="price-discount">-${discount}%</span>` : ''}
        </div>
        ${p.product_type === 'variable' ? `<div class="product-variants" id="vars-${p.id}"><span style="font-size:11px;color:#888">Select variant →</span></div>` : ''}
        <button class="add-to-cart-btn" onclick="event.stopPropagation();quickAddToCart(${p.id}, '${p.product_type}', '${p.sku?.replace(/'/g, "\\'")||''}')">
          ${p.product_type === 'variable' ? 'Choose Options' : 'Add to Cart'}
        </button>
      </div>`;
  }).join('');
  
  if (append) {
    container.innerHTML += html;
  } else {
    container.innerHTML = html || '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#888">No products found</div>';
  }
  setTimeout(updateWishlistUI, 100);
}

// ─── PRODUCT MODAL / QUICK ADD ───
async function openProduct(id, type, sku) {
  const p = await apiFetch(`/api/products/${id}`);
  await showProductPage(p, type, sku);
}

async function showProductPage(p, type, sku) {
  const variations = type === 'variable' && sku ? await apiFetch(`/api/shop/variations/${sku}`) : [];
  
  showPage('product');
  
  const price = p.sale_price && p.sale_price > 0 ? p.sale_price : (p.price > 0 ? p.price : null);
  const oldPrice = p.sale_price && p.sale_price > 0 && p.price > p.sale_price ? p.price : null;
  const discount = oldPrice ? Math.round((1 - price/oldPrice) * 100) : null;
  
  document.getElementById('page-product').innerHTML = `
    <div class="container" style="padding:2rem 0">
      <div class="breadcrumb" style="display:flex;align-items:center;gap:8px">
  <button onclick="history.back()" style="background:none;border:none;cursor:pointer;font-size:13px;color:#888;display:flex;align-items:center;gap:4px">← Back</button>
  <span style="color:#ccc">|</span>
  Home › Products › ${p.category?.split('>').pop()?.trim() || 'Shop'} › ${p.name}
</div>
      <div class="product-page-layout">
        <div class="product-page-img">
          ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" style="width:100%;height:100%;object-fit:contain" onerror="this.parentElement.innerHTML='<div style=font-size:6rem;text-align:center>💄</div>'"/>` : '<div style="font-size:6rem;text-align:center">💄</div>'}
        </div>
        <div class="product-page-info">
          <div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#888;margin-bottom:8px">${p.category||''}</div>
          <h1 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:400;margin-bottom:1rem;line-height:1.2">${p.name}</h1>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:1.5rem">
            <span style="font-size:1.5rem;font-weight:600">$${Number(price).toFixed(2)}</span>
            ${oldPrice ? `<span style="font-size:1.1rem;color:#888;text-decoration:line-through">$${Number(oldPrice).toFixed(2)}</span>` : ''}
            ${discount ? `<span style="background:#fdecea;color:#e74c3c;padding:3px 10px;border-radius:20px;font-size:13px;font-weight:600">-${discount}%</span>` : ''}
          </div>
          ${variations.length ? `
            <div style="margin-bottom:1.5rem">
              <div style="font-size:13px;font-weight:600;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">Choose Variant</div>
              <div style="display:flex;flex-direction:column;gap:8px" id="variant-list">
                ${variations.map(v => `
                  <div onclick="selectVariant(${JSON.stringify(v).replace(/"/g,'&quot;')})" 
                       class="variant-row"
                       style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1.5px solid #eee;cursor:pointer;border-radius:4px;transition:all 0.15s"
                       onmouseover="this.style.borderColor='#1a1a1a'"
                       onmouseout="this.style.borderColor=this.classList.contains('selected')?'#1a1a1a':'#eee'">
                    <span style="font-size:14px;font-weight:500">${v.variant_name||v.name}</span>
                    <span style="font-size:14px;font-weight:600">$${Number(v.sale_price||v.price).toFixed(2)}</span>
                  </div>`).join('')}
              </div>
            </div>` : ''}
          <button onclick="${variations.length ? 'addSelectedVariant()' : `addToCart(${JSON.stringify(p).replace(/"/g,'&quot;')})`}" 
                  style="width:100%;padding:14px;border:1.5px solid #1a1a1a;background:white;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;margin-bottom:10px;transition:all 0.2s"
                  onmouseover="this.style.background='#f5f4f2'"
                  onmouseout="this.style.background='white'">
            ADD TO CART
          </button>
          <button onclick="${variations.length ? 'buySelectedVariant()' : `addToCart(${JSON.stringify(p).replace(/"/g,'&quot;')});goCheckout()`}"
                  style="width:100%;padding:14px;background:#1a1a1a;color:white;border:none;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;margin-bottom:1.5rem;transition:background 0.2s"
                  onmouseover="this.style.background='#c8a882'"
                  onmouseout="this.style.background='#1a1a1a'">
            BUY IT NOW
          </button>
          <div style="border-top:1px solid #eee;padding-top:1rem">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;color:#555">
              🕐 <span><strong>Estimated Delivery:</strong> ${getDeliveryDate()}</span>
            </div>
            ${p.sku ? `<div style="font-size:13px;color:#888;margin-top:8px">SKU: ${p.sku}</div>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  
  window._currentProduct = p;
  window._selectedVariant = null;
}

function getDeliveryDate() {
  const d1 = new Date(); d1.setDate(d1.getDate() + 3);
  const d2 = new Date(); d2.setDate(d2.getDate() + 7);
  return `${d1.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${d2.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
}

function selectVariant(v) {
  window._selectedVariant = v;
  document.querySelectorAll('.variant-row').forEach(r => {
    r.style.borderColor = '#eee';
    r.classList.remove('selected');
  });
  event.currentTarget.style.borderColor = '#1a1a1a';
  event.currentTarget.classList.add('selected');
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

async function quickAddToCart(id, type, sku) {
  if (type === 'variable') {
    showVariantModal(id, sku);
  } else {
    const p = await apiFetch(`/api/products/${id}`);
    addToCart(p);
  }
}

async function showVariantModal(productId, sku) {
  const variations = await apiFetch(`/api/shop/variations/${sku}`);
  if (!variations.length) { showToast('No variants available'); return; }
  
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:500;padding:1rem';
  modal.innerHTML = `
    <div style="background:white;width:100%;max-width:480px;max-height:80vh;overflow-y:auto;border-radius:4px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:1.25rem 1.5rem;border-bottom:1px solid #eee">
        <span style="font-family:'Cormorant Garamond',serif;font-size:1.2rem">Choose Variant</span>
        <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#888">✕</button>
      </div>
      <div style="padding:1.25rem 1.5rem">
        ${variations.map(v => `
          <div onclick="addToCart(${JSON.stringify(v).replace(/"/g,'&quot;')});this.closest('[style*=fixed]').remove()"
               style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1.5px solid #eee;margin-bottom:8px;cursor:pointer;border-radius:4px;transition:all 0.15s"
               onmouseover="this.style.borderColor='#1a1a1a'"
               onmouseout="this.style.borderColor='#eee'">
            <div style="display:flex;align-items:center;gap:12px">
              ${v.image_url ? `<img src="${v.image_url}" style="width:50px;height:50px;object-fit:cover" onerror="this.style.display='none'"/>` : ''}
              <div>
                <div style="font-size:14px;font-weight:500">${v.variant_name || v.name}</div>
                <div style="font-size:12px;color:#888;margin-top:2px">Stock: ${v.stock}</div>
              </div>
            </div>
            <div style="font-size:14px;font-weight:600">$${Number(v.sale_price||v.price).toFixed(2)}</div>
          </div>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ─── CART ───
function addToCart(product) {
  if (product.stock <= 0) { showToast('Out of stock!'); return; }
  
  const existing = cart.find(i => i.id === product.id);
  if (existing) {
    if (existing.qty >= product.stock) { showToast('Not enough stock!'); return; }
    existing.qty++;
  } else {
    cart.push({ 
      id: product.id, 
      name: product.name, 
      variant_name: product.variant_name || null,
      price: Number(product.sale_price || product.price), 
      image_url: product.image_url || '',
      stock: product.stock,
      qty: 1 
    });
  }
  
  saveCart();
  updateCartUI();
  showToast(`${product.variant_name || product.name} added to cart ✓`);
  
  // Open cart drawer
  toggleCart(true);
}

function updateCartUI() {
  const count = cart.reduce((a, i) => a + i.qty, 0);
  document.getElementById('cart-count').textContent = count;
  
  const total = cart.reduce((a, i) => a + (i.price * i.qty), 0);
  document.getElementById('cart-total-drawer').textContent = `$${total.toFixed(2)}`;
  
  const itemsEl = document.getElementById('cart-items-drawer');
  if (!itemsEl) return;
  
  if (!cart.length) {
    itemsEl.innerHTML = '<div class="cart-empty">Your cart is empty</div>';
    return;
  }
  
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

function updateQty(i, delta) {
  cart[i].qty += delta;
  if (cart[i].qty <= 0) cart.splice(i, 1);
  saveCart();
  updateCartUI();
}

function removeFromCart(i) {
  cart.splice(i, 1);
  saveCart();
  updateCartUI();
}

function saveCart() {
  localStorage.setItem('pb_cart', JSON.stringify(cart));
}

function toggleCart(forceOpen = false) {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-overlay');
  const isOpen = drawer.classList.contains('open');
  
  if (forceOpen || !isOpen) {
    drawer.classList.add('open');
    drawer.classList.remove('hidden');
    overlay.classList.remove('hidden');
  } else {
    drawer.classList.remove('open');
    setTimeout(() => drawer.classList.add('hidden'), 300);
    overlay.classList.add('hidden');
  }
}

// ─── SEARCH ───
function toggleSearch() {
  const bar = document.getElementById('search-bar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) {
    document.getElementById('search-input').focus();
  }
}

let searchTimeout;
async function handleSearch(val) {
  clearTimeout(searchTimeout);
  if (!val.trim()) return;
  searchTimeout = setTimeout(async () => {
    const products = await apiFetch(`/api/shop/products?search=${encodeURIComponent(val)}&limit=24`);
    showPage('search');
    document.getElementById('search-title').textContent = `Results for "${val}" (${products.length})`;
    renderProducts(products, 'search-products');
  }, 400);
}

// ─── CHECKOUT ───
function goCheckout() {
  toggleCart();
  showPage('checkout');
  renderSummary();
}

function renderSummary() {
  const items = document.getElementById('summary-items');
  const subtotal = cart.reduce((a, i) => a + (i.price * i.qty), 0);
  
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
  
  document.getElementById('summary-delivery').textContent = shipping === 0 ? 'Free' : `$${shipping.toFixed(2)}`;
  document.getElementById('summary-total').textContent = `$${total.toFixed(2)}`;
}

function setDelivery(type, btn) {
  document.querySelectorAll('.delivery-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  
  const shippingSection = document.getElementById('shipping-section');
  if (type === 'pickup') {
    shippingSection.style.display = 'none';
  } else {
    shippingSection.style.display = 'block';
  }
}

function toggleNote() {
  const note = document.getElementById('co-note');
  note.classList.toggle('hidden');
}

async function placeOrder() {
  if (!cart.length) { showToast('Your cart is empty!'); return; }
  
  const email = document.getElementById('co-email').value;
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
  
  const items = cart.map(i => ({
    product_id: i.id,
    product_name: i.name + (i.variant_name ? ` — ${i.variant_name}` : ''),
    price: i.price,
    quantity: i.qty
  }));
  
  // Get next order num
  const numR = await apiFetch('/api/orders/next-num');
  
  const r = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_num: numR.num,
      customer_name: `${firstName} ${lastName}`.trim(),
      customer_email: email,
      customer_phone: phone,
      type: 'online',
      status: 'pending',
      items,
      discount: 0,
      notes: `Address: ${address}, ${city}${note ? '\n' + note : ''}`
    })
  });
  
  const result = await r.json();
  
  if (result.id) {
    cart = [];
    saveCart();
    updateCartUI();
    showPage('success');
  } else {
    showToast('Error placing order. Please try again.');
  }
}

// ─── SORT / FILTER ───
function sortProducts(val) {
  const grid = document.getElementById('shop-products');
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
function toggleMobileMenu() {
  const nav = document.getElementById('main-nav');
  nav.style.display = nav.style.display === 'flex' ? 'none' : 'flex';
  nav.style.flexDirection = 'column';
  nav.style.position = 'fixed';
  nav.style.top = '120px';
  nav.style.left = '0';
  nav.style.right = '0';
  nav.style.background = 'white';
  nav.style.padding = '1rem';
  nav.style.zIndex = '99';
  nav.style.borderBottom = '1px solid #eee';
}

// ─── INFINITE SCROLL ───
window.addEventListener('scroll', () => {
  if (document.getElementById('page-shop').classList.contains('hidden')) return;
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400) {
    loadShopProducts(true);
  }
});




async function sendContact() {
  const name = document.getElementById('ct-name').value;
  const email = document.getElementById('ct-email').value;
  const msg = document.getElementById('ct-msg').value;
  if (!name || !email || !msg) { showToast('Please fill all fields'); return; }
  showToast('Message sent! We will contact you soon ✓');
  ['ct-name','ct-email','ct-phone','ct-msg'].forEach(id => document.getElementById(id).value = '');
}
// ─── TOAST ───
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}


// ─── WISHLIST ───
let wishlist = JSON.parse(localStorage.getItem('pb_wishlist') || '[]');

function toggleWishlist(productId, productName, e) {
  e.stopPropagation();
  const idx = wishlist.findIndex(i => i.id === productId);
  if (idx >= 0) {
    wishlist.splice(idx, 1);
    showToast('Removed from wishlist');
  } else {
    wishlist.push({ id: productId, name: productName });
    showToast('Added to wishlist ♡');
  }
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
  if (!wishlist.length) {
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#888">Your wishlist is empty</div>';
    return;
  }
  container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem"><div class="spinner"></div></div>';
  const ids = wishlist.map(i => i.id).join(',');
  const products = await apiFetch(`/api/shop/wishlist?ids=${ids}`);
  renderProducts(products, 'wishlist-products');
}