// ── รับเฉพาะคำขอที่มาจากเว็บของร้าน (กันคนนอกยิงมาส่ง LINE/แจ้งเตือนขยะ) ──
// kailoong.vercel.app + ลิงก์ของโปรเจกต์ (kailoong-...vercel.app) ทั้งเว็บจริงและเว็บทดสอบ
function fromOurSite(req) {
  const o = req.headers.origin || req.headers.referer || '';
  try { const h = new URL(o).hostname; return h === 'kailoong.vercel.app' || /^kailoong-[a-z0-9-]+\.vercel\.app$/.test(h) || h === 'localhost'; }
  catch (e) { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!fromOurSite(req)) return res.status(403).json({ error: 'Forbidden' });

  const TOKEN = process.env.LINE_CHANNEL_TOKEN;
  const GROUP_ID = process.env.LINE_GROUP_ID;

  if (!TOKEN || !GROUP_ID) {
    return res.status(500).json({ error: 'Missing LINE config' });
  }

  const { type, customerName, items, createdAt, todayOrders, takenBy } = req.body;
  // type: 'new' | 'edit' | 'delete'

  const dateStr = new Date(createdAt).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const itemList = items || [];

  // ── แยกหีบ กับ อุปกรณ์เสริม ──
  // แอพส่ง acc (true = อุปกรณ์เสริม) + unit (หน่วยของสินค้า) มาให้แต่ละรายการ
  // แอพรุ่นเก่าที่ยังค้างในเครื่องไม่ได้ส่งมา → เดาจากชื่อ (ต้องตรงกับ ACC_HINTS ใน index/craft)
  const ACC_HINTS = ['เทพ','นางฟ้า','มุม','กางเขน','ดอกพิกุล','พลาสติก','ม้วน'];
  const isAcc = i => typeof i.acc === 'boolean' ? i.acc
    : (i.name === 'เส้น' || ACC_HINTS.some(k => String(i.name || '').includes(k)));
  const unitOf = i => isAcc(i) ? (String(i.unit || '').trim() || 'ชิ้น') : 'ใบ';
  // ชื่อ + สีโลง + สีเส้น (ไม่เอา "-" ที่แปลว่าไม่มี)
  const label = i => [i.name, i.color, i.trimColor].filter(x => x && x !== '-').join(' ');
  const coffins = itemList.filter(i => !isAcc(i));
  const accs    = itemList.filter(i => isAcc(i));

  const numEmoji = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  const lineOf = (i, idx, bullet) => {
    if (type === 'edit') {
      // แสดง icon ตามประเภทการเปลี่ยนแปลง
      const icon = i.changeType === 'added' ? '➕' : i.changeType === 'removed' ? '➖' : '✏️';
      return `${icon} ${label(i)} × ${i.qty} ${unitOf(i)}`;
    }
    if (type === 'delete') return `❌ ${label(i)} × ${i.qty} ${unitOf(i)}`;
    return `${bullet ? '▫️' : (numEmoji[idx] || `${idx+1}.`)} ${label(i)} × ${i.qty} ${unitOf(i)}`;
  };
  // หีบมาก่อน ตามด้วยหัวข้อ "อุปกรณ์เสริม" (มีเฉพาะเมื่อมีของ)
  const itemsBlock = (coffinTitle) => {
    const out = [];
    if (coffins.length) out.push(coffinTitle, ...coffins.map((i, idx) => lineOf(i, idx, false)));
    if (accs.length) {
      if (out.length) out.push('');
      out.push('🔧 อุปกรณ์เสริม:', ...accs.map((i, idx) => lineOf(i, idx, true)));
    }
    return out.join('\n');
  };

  let header;
  if (type === 'edit') {
    header = `✏️ แก้ไขออเดอร์แล้ว`;
  } else if (type === 'delete') {
    header = `🗑️ ลบออเดอร์แล้ว!`;
  } else {
    header = `📦 ออเดอร์ใหม่เข้ามาแล้ว!`;
  }

  const divider = '━━━━━━━━━━━━━━━';

  let message;
  const coffinTitle = type === 'delete' ? 'หีบที่ถูกลบ:' : type === 'edit' ? 'หีบที่เปลี่ยนแปลง:' : 'รายการหีบ:';
  message =
    `${header}\n` +
    `👤 ลูกค้า: ${customerName}\n` +
    (takenBy ? `🔨 รับโดย: ${takenBy}\n` : '') +
    `📅 วันที่: ${dateStr}\n` +
    `${divider}\n` +
    itemsBlock(coffinTitle);

  // สรุปออเดอร์วันนี้ทั้งหมด (cumulative daily summary)
  let daySummary = '';
  if (todayOrders && todayOrders.length > 0) {
    // จัดกลุ่มตามชื่อลูกค้า รักษาลำดับการเข้ามา
    const byCustomer = {};
    const custOrder = [];
    for (const order of todayOrders) {
      const cust = order.customerName || '?';
      if (!byCustomer[cust]) { byCustomer[cust] = []; custOrder.push(cust); }
      for (const item of (order.items || [])) {
        byCustomer[cust].push(item);
      }
    }
    // แต่ละลูกค้า: หีบก่อน แล้วอุปกรณ์เสริม (ขึ้นต้น 🔧)
    const sumLine = i => {
      // แสดง (ใหม่)/(แก้ไข) ต่อท้ายบรรทัดสินค้า
      const actionLabel = i.action === 'new' ? ' (ใหม่)' : i.action === 'edit' ? ' (แก้ไข)' : '';
      return `${isAcc(i) ? '🔧 ' : ''}${label(i)} × ${i.qty} ${unitOf(i)}${actionLabel}`;
    };
    const custBlocks = custOrder.map(cust => {
      const list = byCustomer[cust];
      const lines = [...list.filter(i => !isAcc(i)), ...list.filter(i => isAcc(i))].map(sumLine).join('\n');
      return `${cust}\n${lines}`;
    });
    // ยอดรวม: นับ "ใบ" เฉพาะหีบ · อุปกรณ์เสริมรวมแยกตามชื่อ+หน่วย
    let coffinTotal = 0;
    const accTotal = {};   // 'กางเขน|ชิ้น' → 5
    for (const o of todayOrders) for (const i of (o.items || [])) {
      if (!isAcc(i)) { coffinTotal += Number(i.qty) || 0; continue; }
      const k = (i.name || '?') + '|' + unitOf(i);
      accTotal[k] = (accTotal[k] || 0) + (Number(i.qty) || 0);
    }
    const accSum = Object.entries(accTotal).map(([k, q]) => { const [n, u] = k.split('|'); return `${n} ${q} ${u}`; });
    daySummary =
      `\n${divider}\n` +
      `สรุปยอดค้างส่งทั้งหมด\n\n` +
      `${custBlocks.join('\n\n')}\n\n` +
      `รวมหีบ ${coffinTotal} ใบ` +
      (accSum.length ? `\n🔧 อุปกรณ์เสริม: ${accSum.join(', ')}` : '');
  }

  message += daySummary ? '\n' + daySummary : '';

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({
        to: GROUP_ID,
        messages: [{ type: 'text', text: message }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: err });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
