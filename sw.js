/* Beeps service worker — PWA app shell (phase 1).
   Network-first for the app HTML with cache fallback (mở offline = thấy shell gần nhất).
   Push SENDING = phase 2: các handler push/notificationclick bên dưới mới là STUB. */
const CACHE = 'beeps-shell-v1';
const SHELL = ['/app.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App shell (app.html) + navigations: network-first, fall back to cached shell when offline.
  const isAppShell = req.mode === 'navigate' || url.pathname === '/app.html' || url.pathname === '/app';
  if (isAppShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/app.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/app.html').then((m) => m || caches.match(req)))
    );
    return;
  }

  // Other same-origin GETs (icons/manifest): cache-first, then network.
  event.respondWith(
    caches.match(req).then((m) => m || fetch(req).then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => m))
  );
});

/* ---- PHASE 2 STUBS (push SENDING chưa build ở bản này) ----
   Khi làm push server: tạo VAPID keys, cho client subscribe qua pushManager,
   lưu subscription, rồi server gửi Web Push → 'push' event bên dưới hiện notification. */
self.addEventListener('push', (event) => {
  // TODO phase 2: parse event.data + self.registration.showNotification(title, options)
});

self.addEventListener('notificationclick', (event) => {
  // TODO phase 2: event.notification.close(); focus/mở /app.html qua clients.openWindow
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((cs) => {
      for (const c of cs) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('/app.html');
    })
  );
});
