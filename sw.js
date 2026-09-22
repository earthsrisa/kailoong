const CACHE = 'kailoong-v86';        // ไฟล์ของแอพเอง — ล้างทิ้งทุกครั้งที่ขึ้นเวอร์ชัน
const CDN   = 'kailoong-cdn-v1';     // ไฟล์จากเน็ตนอก — คนละถัง จะได้ไม่โดนล้างตามเวอร์ชันแอพ
                                     // (URL พวกนี้มีเลขเวอร์ชันในตัวอยู่แล้ว ของใหม่ = คนละ URL)

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
      // ล้างเฉพาะถังเก่าของแอพ — ถัง CDN ต้องเก็บไว้ ไม่งั้นขึ้นเวอร์ชันทีไร
      // ก็ต้องโหลด Bootstrap/ฟอนต์/Firebase ใหม่หมดทุกที ทั้งที่ไฟล์ไม่ได้เปลี่ยน
      Promise.all(keys.filter(k => k !== CACHE && k !== CDN).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// หน้าเว็บสั่งให้อัปเดตทันที (ผู้ใช้กดปุ่ม "อัปเดต")
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── ข้อมูลสดจาก Firestore — ห้ามเก็บ ต้องผ่านเน็ตเสมอ ──
function isLiveData(url) {
  return url.includes('firestore.googleapis.com') ||
         url.includes('firebaseinstallations')    ||
         url.includes('identitytoolkit')          ||
         url.includes('/api/');
}

// ── ไฟล์ไลบรารีจากเน็ตนอก — เก็บได้ URL มีเลขเวอร์ชันในตัวอยู่แล้ว ──
function isLibrary(url) {
  return url.includes('cdn.jsdelivr.net')      ||   // Bootstrap
         url.includes('cdnjs.cloudflare.com')  ||   // FontAwesome, qrcodejs
         url.includes('fonts.googleapis.com')  ||   // Google Fonts (ตัว CSS)
         url.includes('fonts.gstatic.com')     ||   // Google Fonts (ไฟล์ฟอนต์)
         url.includes('www.gstatic.com/firebasejs');
}

const OFFLINE_HTML =
  '<meta charset="utf-8"><div style="font-family:sans-serif;text-align:center;padding:60px 20px;color:#374151">' +
  '<div style="font-size:40px">📶</div><h3>ออฟไลน์</h3>' +
  '<p style="color:#6b7280">ต่อเน็ตแล้วกดรีเฟรชอีกครั้ง</p>' +
  '<button onclick="location.reload()" style="padding:10px 22px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-size:16px">รีเฟรช</button></div>';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;          // POST/PUT ปล่อยผ่าน
  if (isLiveData(req.url)) return;           // ข้อมูล Firestore — ผ่านเน็ตเสมอ

  // ── ไลบรารีภายนอก: มีในเครื่องใช้เลย ไม่มีค่อยโหลดแล้วเก็บไว้ ──
  // เดิมปล่อยผ่านหมด เลยต้องพึ่งแคชของเบราว์เซอร์ล้วนๆ ซึ่งมือถือชอบลบทิ้งเอง
  // → บางครั้งเปิดแอพแล้วต้องโหลดใหม่ทั้ง 500 KB
  if (isLibrary(req.url)) {
    e.respondWith(
      caches.match(req).then(hit => {
        if (hit) return hit;
        // ขอแบบ cors เพื่อให้เช็คได้ว่าโหลดสำเร็จจริง — ถ้าเก็บ opaque ไว้
        // แล้วบังเอิญเป็น 404 จะเสิร์ฟไฟล์เสียค้างไปตลอด
        return fetch(req.url, { mode: 'cors', credentials: 'omit' }).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CDN).then(c => c.put(req, copy)).catch(() => {});
            return res;
          }
          return fetch(req);            // cors ไม่ผ่าน — เอาแบบปกติไปก่อน ไม่ต้องเก็บ
        }).catch(() => fetch(req).catch(() => caches.match(req)));
      })
    );
    return;
  }

  const isDoc = req.mode === 'navigate' ||
                (req.headers.get('accept') || '').includes('text/html');

  if (isDoc) {
    // HTML — เปิดจากของที่เก็บไว้ทันที แล้วค่อยโหลดตัวใหม่เงียบๆ เบื้องหลัง
    // (เดิมรอเน็ตให้เสร็จก่อนเสมอ = ทุกครั้งที่เปิดแอพต้องรอ 120 KB)
    // ได้ของใหม่แล้วจะถูกใช้รอบเปิดถัดไป ส่วนแถบ "มีเวอร์ชันใหม่" ยังทำงานเหมือนเดิม
    // เพราะมันดูจาก sw.js ไม่ได้ดูจากไฟล์ HTML
    e.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      const fresh = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => null);

      if (cached) {
        // กันเบราว์เซอร์ฆ่า sw ก่อนโหลดเสร็จ — บางตัวไม่ยอมให้เรียกหลัง await เลยต้อง try
        try { e.waitUntil(fresh); } catch (_) {}
        return cached;                  // มีของเก่า → ใช้เลย ไม่ต้องรอเน็ต
      }
      const res = await fresh;          // เปิดครั้งแรก ยังไม่มีอะไรเก็บไว้
      return res || new Response(OFFLINE_HTML,
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    })());
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
