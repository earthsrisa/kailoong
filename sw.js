const CACHE = 'kailoong-v9';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Firebase และ CDN — ให้ผ่านเน็ตเสมอ ไม่ cache
  const url = e.request.url;
  if (url.includes('firestore') || url.includes('firebase') ||
      url.includes('googleapis') || url.includes('cdn.jsdelivr') ||
      url.includes('cloudflare') || url.includes('fonts.google')) {
    return;
  }
  // Assets ของแอพ — cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
