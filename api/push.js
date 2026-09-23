// ═══════════════════════════════════════════════════════════
//  ส่งแจ้งเตือน Push (เด้งบนมือถือ/คอม แม้ปิดแอพอยู่)
//
//  ⚠️ ตั้งใจเขียนด้วย node:crypto ล้วน ไม่ใช้ไลบรารี web-push
//     เพราะถ้าต้องเพิ่ม package.json อาจไปกระทบ api/notify-line.js ที่ใช้งานทุกวัน
//     การเข้ารหัสทำตามมาตรฐาน RFC 8291 (aes128gcm) + ลายเซ็น VAPID ตาม RFC 8292
//     และทดสอบแล้วว่าได้ผลตรงกับตัวอย่างใน RFC ทุกไบต์
//
//  ต้องตั้งใน Vercel → Settings → Environment Variables
//     VAPID_PUBLIC_KEY   กุญแจสาธารณะ (ตัวเดียวกับที่ฝังใน index.html)
//     VAPID_PRIVATE_KEY  กุญแจลับ ห้ามใส่ในโค้ดหรือ Firestore เด็ดขาด
//     VAPID_SUBJECT      (ไม่ใส่ก็ได้) ช่องทางติดต่อ เช่น https://kailoong.vercel.app
//
//  รับ POST { subs:[{endpoint, keys:{p256dh, auth}}], title, body, url, tag }
//  คืน { sent, failed, gone:[endpoint ที่หมดอายุแล้ว ให้แอพลบทิ้ง] }
// ═══════════════════════════════════════════════════════════
import crypto from 'node:crypto';

const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
};

// HKDF แบบย่อ (ขั้นเดียว ความยาว ≤ 32 ไบต์) ตามที่ RFC 8291 ใช้
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const hkdf = (salt, ikm, info, len) => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);

// ── เข้ารหัสข้อความตาม RFC 8291 (Content-Encoding: aes128gcm) ──
// ส่ง senderPriv / salt เข้ามาได้เฉพาะตอนทดสอบกับตัวอย่างใน RFC — ใช้จริงจะสุ่มใหม่ทุกครั้ง
export function encryptPayload(uaPublicB64, authB64, plaintext, senderPriv, fixedSalt) {
  const uaPublic = b64u.dec(uaPublicB64);   // 65 ไบต์ (0x04 || x || y)
  const authSecret = b64u.dec(authB64);     // 16 ไบต์
  const ecdh = crypto.createECDH('prime256v1');
  if (senderPriv) ecdh.setPrivateKey(b64u.dec(senderPriv)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();     // 65 ไบต์
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = fixedSalt ? b64u.dec(fixedSalt) : crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  // ข้อความทั้งหมดอยู่ในก้อนเดียว (record สุดท้าย) → ต่อท้ายด้วย 0x02
  const padded = Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, ct]);
}

// ── ลายเซ็น VAPID (RFC 8292) ──
// JWT แบบ ES256 — ลายเซ็นต้องเป็นแบบ r||s 64 ไบต์ (ieee-p1363) ไม่ใช่ DER
export function vapidAuth(endpoint, publicB64, privateB64, subject, nowSec) {
  const pub = b64u.dec(publicB64);
  const key = crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: privateB64,
           x: b64u.enc(pub.subarray(1, 33)), y: b64u.enc(pub.subarray(33, 65)) },
  });
  const now = nowSec || Math.floor(Date.now() / 1000);
  const header = b64u.enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u.enc(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: now + 12 * 3600,           // ห้ามเกิน 24 ชม. (Apple ปฏิเสธ)
    sub: subject,
  }));
  const data = header + '.' + claims;
  const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u.enc(sig)}, k=${publicB64}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const PUB = process.env.VAPID_PUBLIC_KEY;
  const PRIV = process.env.VAPID_PRIVATE_KEY;
  const SUBJECT = process.env.VAPID_SUBJECT || 'https://kailoong.vercel.app';
  if (!PUB || !PRIV) {
    return res.status(500).json({ error: 'ยังไม่ได้ตั้ง VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ใน Vercel' });
  }

  const { subs, title, body, url, tag } = req.body || {};
  if (!Array.isArray(subs) || !subs.length) return res.status(400).json({ error: 'no subs' });

  // จำกัดขนาด กันคนยิงเข้ามาถล่ม (ร้านนี้มีไม่กี่เครื่อง)
  const list = subs.slice(0, 50).filter(s => s && typeof s.endpoint === 'string'
    && s.endpoint.startsWith('https://') && s.keys && s.keys.p256dh && s.keys.auth);
  const payload = JSON.stringify({
    title: String(title || 'มีออเดอร์ใหม่').slice(0, 120),
    body: String(body || '').slice(0, 400),
    url: typeof url === 'string' && url.startsWith('/') ? url : '/',
    tag: tag ? String(tag).slice(0, 60) : undefined,
  });

  const results = await Promise.all(list.map(async (s) => {
    try {
      const r = await fetch(s.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          TTL: '43200',               // ถ้าเครื่องปิดอยู่ เก็บไว้ส่งให้ได้ 12 ชม.
          Urgency: 'high',
          Authorization: vapidAuth(s.endpoint, PUB, PRIV, SUBJECT),
        },
        body: encryptPayload(s.keys.p256dh, s.keys.auth, payload),
      });
      return { endpoint: s.endpoint, status: r.status, ok: r.status >= 200 && r.status < 300 };
    } catch (e) {
      return { endpoint: s.endpoint, status: 0, ok: false, error: String(e && e.message || e) };
    }
  }));

  res.status(200).json({
    sent: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).map(r => ({ status: r.status, error: r.error })),
    // 404/410 = เครื่องนั้นเลิกรับแล้ว (ถอนแอพ/ปิดแจ้งเตือน/หมดอายุ) ให้แอพลบออก
    gone: results.filter(r => r.status === 404 || r.status === 410).map(r => r.endpoint),
  });
}
