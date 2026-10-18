// Shoot Radar service worker: offline app shell, last-known forecasts, and push notifications.
const VERSION = 'sr-v6';
const SHELL = ['./', './index.html', './engine.js', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png', './icons/badge-96.png'];
const IMAGE_HOSTS = ['tysonwaldron.com', 'www.tysonwaldron.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const DATA_HOSTS = ['api.open-meteo.com', 'marine-api.open-meteo.com', 'services.swpc.noaa.gov', 'geocoding-api.open-meteo.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION + '-shell').then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first with a time limit; fall back to the last saved copy.
async function networkFirst(req, cacheName, timeoutMs, markCached) {
  const cache = await caches.open(cacheName);
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(req, { signal: ctl.signal }); clearTimeout(timer);
    if (res.type === 'opaque') cache.put(req, res.clone()); // cross-site images (no CORS): keep as-is
    else if (res.ok) {
      const copy = res.clone(); const headers = new Headers(copy.headers); headers.set('x-sr-saved', String(Date.now()));
      cache.put(req, new Response(await copy.blob(), { status: copy.status, headers }));
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreVary: true });
    if (!hit) throw err;
    if (!markCached) return hit;
    const headers = new Headers(hit.headers); headers.set('x-sr-cached', hit.headers.get('x-sr-saved') || '1');
    return new Response(await hit.blob(), { status: hit.status, headers });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (/\/(history|ratings|devices|state)\.json$/.test(url.pathname)) return; // always live
    e.respondWith(networkFirst(req, VERSION + '-shell', 6000, false));
  } else if (IMAGE_HOSTS.includes(url.hostname)) {
    e.respondWith(networkFirst(req, VERSION + '-img', 8000, false));
  } else if (DATA_HOSTS.includes(url.hostname)) {
    e.respondWith(networkFirst(req, VERSION + '-data', 12000, true));
  }
});

// ---------- push notifications
self.addEventListener('push', (e) => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data && e.data.text() }; }
  const title = m.title || 'Shoot Radar';
  const opts = { body: m.body || '', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: m.tag || 'shoot-radar', renotify: true, data: { url: m.url || './#today' } };
  const jobs = [self.registration.showNotification(title, opts)];
  if (typeof m.badge === 'number' && self.navigator.setAppBadge) jobs.push(m.badge > 0 ? self.navigator.setAppBadge(m.badge).catch(() => {}) : self.navigator.clearAppBadge().catch(() => {}));
  e.waitUntil(Promise.all(jobs));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './#today', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if (w.url.startsWith(self.registration.scope)) { await w.focus(); w.postMessage({ type: 'open', url: target }); return; } }
    await self.clients.openWindow(target);
  })());
});
