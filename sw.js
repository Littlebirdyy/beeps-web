/* Beeps service worker — PWA app shell + Web Push.
   Network-first for the app HTML with cache fallback (mở offline = thấy shell gần nhất).
   Push: handler 'push' hiện notification, 'notificationclick' mở /app.html. */
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

/* ---- Web Push: server (Vercel /api/push) gửi -> hiện notification, bấm vào mở app ---- */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { try { data = { body: event.data && event.data.text() }; } catch (e2) { data = {}; } }
  const title = data.title || 'Beeps';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/app.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/app.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if (c.url && c.url.indexOf(target) >= 0 && 'focus' in c) return c.focus();
      }
      for (const c of cs) { if ('focus' in c) { c.navigate && c.navigate(target); return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
