const CACHE = 'kailoong-v90';        // ไฟล์ของแอพเอง — ล้างทิ้งทุกครั้งที่ขึ้นเวอร์ชัน
const CDN   = 'kailoong-cdn-v1';     // ไฟล์จากเน็ตนอก — คนละถัง จะได้ไม่โดนล้างตามเวอร์ชันแอพ
                                     // (URL พวกนี้มีเลขเวอร์ชันในตัวอยู่แล้ว ของใหม่ = คนละ URL)

// ไฟล์ของแอพที่เก็บไว้ใช้ตอนเน็ตช้า/หลุด
const ASSETS = [
  '/',
  '/index.html',
  '/craft.html',
  '/manifest.json',
  '/manifest-craft.json',
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
  e.waitUntil((async () => {
    // Navigation Preload — ให้เบราว์เซอร์เริ่มโหลดหน้าเว็บไปพร้อมกับตอนปลุก sw
    // มือถือรุ่นถูกปลุก sw ช้า ถ้าไม่เปิดตัวนี้ต้องรอปลุกเสร็จก่อนถึงจะเริ่มโหลด
    // (iPhone ยังไม่รองรับ — เช็คก่อนเรียก ไม่รองรับก็ข้ามไปเฉยๆ)
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    // ล้างเฉพาะถังเก่าของแอพ — ถัง CDN ต้องเก็บไว้ ไม่งั้นขึ้นเวอร์ชันทีไร
    // ก็ต้องโหลด Bootstrap/ฟอนต์/Firebase ใหม่หมดทุกที ทั้งที่ไฟล์ไม่ได้เปลี่ยน
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE && k !== CDN).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
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

// เก็บหน้าเว็บด้วย URL ที่ตัด ?... และ #... ออก
// เดิมเก็บตาม URL เต็ม เลยได้ของซ้ำๆ อย่าง /#settings, /index.html?b=123 เต็มถัง
function pageKey(url) {
  try { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; }
  catch (_) { return url; }
}

// หน้ารอ — ส่งให้ตอนเน็ตช้าเกิน 4 วิ และในเครื่องยังไม่มีหน้าเว็บเก็บไว้
// ระหว่างนี้ sw ยังโหลดของจริงต่อเบื้องหลัง พอเก็บลงเครื่องเสร็จ หน้านี้จะรีโหลดตัวเอง
// → ได้หน้าจริงจากในเครื่องทันที
const WAIT_HTML =
  '<!doctype html><html lang="th" style="background:#f0f2f5"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>กำลังโหลด</title></head>' +
  '<body style="margin:0;background:#f0f2f5;font-family:system-ui,-apple-system,sans-serif;">' +
  '<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#1a2332;text-align:center;padding:20px;">' +
  '<div style="width:34px;height:34px;border:3px solid #dbe3ec;border-top-color:#2563eb;border-radius:50%;animation:s .8s linear infinite;margin-bottom:14px"></div>' +
  '<div style="font-size:17px;font-weight:700;margin-bottom:6px">เน็ตช้าหน่อย กำลังโหลด...</div>' +
  '<div style="font-size:13px;color:#64748b">โหลดเสร็จแล้วจะเปิดให้เอง ไม่ต้องกดอะไร</div>' +
  '<button onclick="location.reload()" style="margin-top:22px;min-height:46px;padding:0 24px;border:0;border-radius:12px;background:#2563eb;color:#fff;font-size:15px;font-weight:700">ลองใหม่</button>' +
  '</div><style>@keyframes s{to{transform:rotate(360deg)}}</style>' +
  '<script>(function(){var k=location.href.split("#")[0].split("?")[0];' +
  'var t=setInterval(function(){if(!window.caches)return;caches.match(k).then(function(r){if(r){clearInterval(t);location.reload();}});},1500);' +
  'setTimeout(function(){location.reload();},30000);' +
  'window.addEventListener("online",function(){location.reload();});})();</script>' +
  '</body></html>';

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
        }).catch(() => fetch(req).catch(() =>
          // ⚠️ caches.match คืน undefined ได้ถ้าไม่มีในเครื่อง — ส่ง undefined ให้ respondWith = sw พัง
          caches.match(req).then(r => r || Response.error())));
      })
    );
    return;
  }

  const isDoc = req.mode === 'navigate' ||
                (req.headers.get('accept') || '').includes('text/html');

  if (isDoc) {
    // HTML — มีในเครื่อง: เปิดทันที แล้วโหลดตัวใหม่เงียบๆ เบื้องหลัง (ใช้รอบเปิดถัดไป)
    //        ไม่มีในเครื่อง: รอเน็ตได้ไม่เกิน 4 วิ เกินนั้นส่งหน้ารอเบาๆ ไปก่อน
    //        (เดิมไม่มีเพดานเวลา เน็ตอืดเท่าไหร่ก็ขาวค้างเท่านั้น)
    // แถบ "มีเวอร์ชันใหม่" ยังทำงานเหมือนเดิม เพราะมันดูจาก sw.js ไม่ได้ดูจากไฟล์ HTML
    const key = pageKey(req.url);

    // เริ่มโหลดของสดทันที — ใช้ preload ถ้าเบราว์เซอร์เริ่มไว้ให้แล้วตอนปลุก sw
    // ⚠️ ต้องเรียก waitUntil ก่อน await ตัวแรก ไม่งั้นบางเบราว์เซอร์ไม่ยอม
    const fresh = (async () => {
      try {
        const pre = e.preloadResponse ? await e.preloadResponse.catch(() => null) : null;
        const res = pre || await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          // ห้าม await ตรงนี้ — put ต้องรอโหลดครบทั้งไฟล์ ถ้ารอ หน้าเว็บจะไม่ได้ไหลลงมาทีละส่วน
          // แต่ต้องบอก sw ให้อยู่รอจนเก็บเสร็จ ไม่งั้นหน้ารอจะไม่มีวันเจอของในเครื่อง
          const saving = caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
          try { e.waitUntil(saving); } catch (_) {}
        }
        return res;
      } catch (_) { return null; }
    })();
    try { e.waitUntil(fresh); } catch (_) {}

    e.respondWith((async () => {
      const cached = await caches.match(key) || await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;        // มีของเก่า → ใช้เลย ไม่ต้องรอเน็ต

      const res = await Promise.race([fresh, new Promise(r => setTimeout(() => r('slow'), 4000))]);
      if (res === 'slow') {
        return new Response(WAIT_HTML,
          { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
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

// ═══════════════════════════════════════
//  แจ้งเตือน Push — เด้งแม้ปิดแอพอยู่
//  ตัวส่งคือ api/push.js · เปิด/ปิดรับได้ที่หน้าตั้งค่าของแต่ละเครื่อง
// ═══════════════════════════════════════
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  // ⚠️ ต้องโชว์แจ้งเตือนทุกครั้งที่มี push เข้ามา — ถ้าไม่โชว์ iPhone/Chrome จะตัดสิทธิ์ push ของเรา
  e.waitUntil(self.registration.showNotification(d.title || 'มีออเดอร์ใหม่', {
    body: d.body || 'แตะเพื่อดูออเดอร์',
    icon: '/icon-192.png',
    tag: d.tag || ('kl-' + Date.now()),  // คนละออเดอร์ = คนละแจ้งเตือน ไม่ทับกัน
    renotify: true,
    data: { url: d.url || '/#orders' },
    lang: 'th',
    vibrate: [150, 80, 150],
  }));
});

// แตะแจ้งเตือน → ถ้าเปิดแอพค้างไว้ ให้เด้งหน้าต่างเดิมขึ้นมาแล้วไปหน้าออเดอร์ ไม่งั้นเปิดใหม่
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/#orders', self.location.origin);
  const page = (target.hash || '').replace('#', '') || 'orders';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const isCraft = u => { try { return new URL(u).pathname.startsWith('/craft'); } catch (_) { return false; } };

    // แจ้งเตือนของช่าง → เปิดหน้าช่าง (หน้าช่างอัปเดตสดอยู่แล้ว แค่เด้งหน้าต่างขึ้นมาพอ)
    if (target.pathname.startsWith('/craft')) {
      const cw = wins.find(w => isCraft(w.url));
      if (cw) { await cw.focus(); return; }
      await self.clients.openWindow(target.href);
      return;
    }
    // แจ้งเตือนของแอดมิน → เลือกหน้าต่างแอดมิน ไม่เอาหน้าช่าง (หน้าช่างไม่มีหน้าออเดอร์)
    const admin = wins.find(w => {
      try { const u = new URL(w.url); return u.origin === target.origin && !u.pathname.includes('craft'); }
      catch (_) { return false; }
    });
    if (admin) {
      await admin.focus();
      admin.postMessage({ type: 'KL_OPEN_PAGE', page });   // index.html ฟังข้อความนี้แล้วเปลี่ยนหน้า
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});
