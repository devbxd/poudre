import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ToastProvider, Spinner, ErrorBoundary } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';

const page = (name) => lazy(() => import(`./pages/${name}.jsx`));
const Overview = page('Overview');
const Orders = page('Orders');
const OrderDetail = page('OrderDetail');
const OrderNew = page('OrderNew');
const Products = page('Products');
const ProductEdit = page('ProductEdit');
const Categories = page('Categories');
const Brands = page('Brands');
const Stock = page('Stock');
const PurchaseOrders = page('PurchaseOrders');
const PurchaseOrderEdit = page('PurchaseOrderEdit');
const Suppliers = page('Suppliers');
const Customers = page('Customers');
const CustomerDetail = page('CustomerDetail');
const Coupons = page('Coupons');
const Reviews = page('Reviews');
const Reports = page('Reports');
const Media = page('Media');
const Messages = page('Messages');
const Pages = page('Pages');
const Menus = page('Menus');
const Homepage = page('Homepage');
const Settings = page('Settings');
const Pos = lazy(() => import('./pos/Pos.jsx'));

function Guard() {
  const { staff } = useAuth();
  if (staff === undefined) return <Spinner className="h-screen items-center" />;
  if (!staff) return <Login />;
  return (
    <Suspense fallback={<Spinner className="h-screen items-center" />}>
      <Routes>
        <Route path="/pos" element={<ErrorBoundary><Pos /></ErrorBoundary>} />
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/new" element={<OrderNew />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="products" element={<Products />} />
          <Route path="products/:id" element={<ProductEdit />} />
          <Route path="categories" element={<Categories />} />
          <Route path="brands" element={<Brands />} />
          <Route path="stock" element={<Stock />} />
          <Route path="purchase-orders" element={<PurchaseOrders />} />
          <Route path="purchase-orders/:id" element={<PurchaseOrderEdit />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="coupons" element={<Coupons />} />
          <Route path="reviews" element={<Reviews />} />
          <Route path="reports" element={<Reports />} />
          <Route path="media" element={<Media />} />
          <Route path="messages" element={<Messages />} />
          <Route path="website/pages" element={<Pages kind="pages" />} />
          <Route path="website/blog" element={<Pages kind="posts" />} />
          <Route path="website/menus" element={<Menus />} />
          <Route path="website/homepage" element={<Homepage />} />
          <Route path="settings/*" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename="/dashboard">
      <AuthProvider>
        <ToastProvider>
          <Guard />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);

// offline shell for the dashboard / POS (see public/sw.js)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/dashboard/sw.js', { scope: '/dashboard/' }).catch(() => {}));
}

// New version published: the till stays open for weeks, so it kept running old code. Every 5 minutes the app compares
// its own script with the one the server now serves. The POS reloads by itself between sales (window.__poudreBusy
// is set while a sale is in progress); other pages show a bar with a Reload button, so a form being typed is not lost.
const ownScript = () => [...document.scripts].map((s) => s.getAttribute('src') || '').find((s) => /\/dashboard\/assets\/index-[^/]+\.js$/.test(s));
let updateBar = null;
async function checkForUpdate() {
  const mine = ownScript();
  if (!mine || !navigator.onLine) return;
  try {
    const html = await (await fetch('/dashboard/', { cache: 'no-store' })).text();
    const served = (html.match(/\/dashboard\/assets\/index-[^"']+\.js/) || [])[0];
    if (!served || served === mine) return;
    if (location.pathname.startsWith('/dashboard/pos') && !window.__poudreBusy) { location.reload(); return; }
    if (updateBar) return;
    updateBar = document.createElement('div');
    updateBar.setAttribute('role', 'status');
    updateBar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;display:flex;gap:12px;align-items:center;background:#18181b;color:#fff;padding:10px 12px 10px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);font:500 14px system-ui,sans-serif';
    updateBar.innerHTML = '<span>A new version of the dashboard is ready.</span><button type="button" style="background:#fff;color:#18181b;border:0;border-radius:6px;padding:6px 12px;font:600 13px system-ui,sans-serif;cursor:pointer">Reload</button>';
    updateBar.querySelector('button').addEventListener('click', () => location.reload());
    document.body.appendChild(updateBar);
  } catch { /* offline or server busy: try again later */ }
}
setInterval(checkForUpdate, 5 * 60e3);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
