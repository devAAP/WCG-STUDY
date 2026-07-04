// WCG Study — Service Worker v4 (scripture audio)
const CACHE_NAME = 'wcg-study-v4';
const CACHE_URLS = [
  './', './index.html', './manifest.json',
  './WCG_Interactive_Timeline.html',
  './icons/icon-192.png', './icons/icon-512.png'
];
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(CACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Pass JW CDN audio requests straight through (never cache large MP3s)
  if (e.request.url.includes('jw-cdn.org') || e.request.url.includes('jw.org')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', {status: 503})));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(r => {
        if (!r || r.status !== 200) return r;
        caches.open(CACHE_NAME).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : null);
    })
  );
});
