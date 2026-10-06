// Dashboard & POS offline shell: the app itself opens without a connection (the POS then works from the products
// and sales kept on the device). Pages: network first, falling back to the saved copy. Built files: saved once.
// API calls are never cached here — sales are handled by the POS offline queue.
const CACHE = 'poudre-dashboard-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.add('/dashboard/'))); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // the app page (every dashboard URL serves the same index.html)
  if (req.mode === 'navigate' && url.pathname.startsWith('/dashboard')) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put('/dashboard/', res.clone()));
      return res;
    }).catch(() => caches.match('/dashboard/')));
    return;
  }
  // built JS/CSS (names change with each version) and product thumbnails
  if (url.pathname.startsWith('/dashboard/assets/') || /^\/wp-content\/uploads\/.+-(150x150|500x500)\./.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
