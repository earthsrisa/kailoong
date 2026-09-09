const CACHE = 'kailoong-v47';

// ไฟล์ของแอพที่เก็บไว้ใช้ตอนเน็ตช้า/หลุด
const ASSETS = [
  '/',
  '/index.html',
  '/craft.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/craft-icon-180.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // ใส่ทีละไฟล์ ถ้าไฟล์ใดหาย install จะไม่ล้มทั้งชุด (addAll ล้มทั้งชุด)
      Promise.all(ASSETS.map(u => c.add(u).catch(() => {})))
    )
    // ไม่เรียก skipWaiting() ที่นี่ — รอให้หน้าเว็บถามผู้ใช้ก่อน
    // (ดู handler 'SKIP_WAITING' ข้างล่าง) กันข้อมูลในฟอร์มหายกลางทาง
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// หน้าเว็บสั่งให้อัปเดตทันที (ผู้ใช้กดปุ่ม "อัปเดต")
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isPassThrough(url) {
  return url.includes('firestore')     || url.includes('firebase')  ||
         url.includes('googleapis')    || url.includes('gstatic')   ||
         url.includes('cdn.jsdelivr')  || url.includes('cloudflare') ||
         url.includes('fonts.google')  || url.includes('/api/');
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // POST/PUT ปล่อยผ่าน
  if (isPassThrough(req.url)) return;               // Firebase / CDN / API — ผ่านเน็ตเสมอ

  const isDoc = req.mode === 'navigate' ||
                (req.headers.get('accept') || '').includes('text/html');

  if (isDoc) {
    // HTML — เอาของใหม่ก่อน (โค้ดแอพจะไม่ค้างเวอร์ชันเก่า)
    // ถ้าเน็ตหลุดค่อยใช้ของที่เก็บไว้
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() =>
        caches.match(req).then(hit => hit || caches.match('/index.html'))
      )
    );
    return;
  }

  // ไอคอน / manifest — เอาของที่เก็บไว้ก่อน เร็วกว่า
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
