import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ToastProvider, Spinner } from './components/ui.jsx';
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
        <Route path="/pos" element={<Pos />} />
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
    <BrowserRouter basename="/admin">
      <AuthProvider>
        <ToastProvider>
          <Guard />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
