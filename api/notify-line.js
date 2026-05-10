export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const TOKEN = process.env.LINE_CHANNEL_TOKEN;
  const GROUP_ID = process.env.LINE_GROUP_ID;

  if (!TOKEN || !GROUP_ID) {
    return res.status(500).json({ error: 'Missing LINE config' });
  }

  const { type, orderNo, customerName, items, createdAt, todayOrders } = req.body;
  // type: 'new' | 'edit' | 'delete'

  const dateStr = new Date(createdAt).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const itemList = items || [];

  // รายการสินค้า (ไม่แสดงราคา)
  const numEmoji = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  const itemLines = itemList
    .map((i, idx) => {
      const num = numEmoji[idx] || `${idx+1}.`;
      return `${num} ${i.name} × ${i.qty} ใบ`;
    })
    .join('\n');

  // สรุปรวมจำนวน
  const totalQty = itemList.reduce((s, i) => s + Number(i.qty), 0);

  // สรุปโลงแต่ละประเภท
  const coffin_summary = itemList
    .map(i => `${i.name} ${i.qty} ใบ`)
    .join(', ');

  let header, icon;
  if (type === 'edit') {
    icon = '✏️';
    header = `✏️ แก้ไขออเดอร์แล้ว (#${orderNo} แก้ไข)`;
  } else if (type === 'delete') {
    icon = '🗑️';
    header = `🗑️ ลบออเดอร์แล้ว!`;
  } else {
    icon = '📦';
    header = `📦 ออเดอร์ใหม่เข้ามาแล้ว!`;
  }

  const divider = '━━━━━━━━━━━━━━━';

  let message;
  if (type === 'delete') {
    message =
      `${header}\n` +
      `${divider}\n` +
      `🔢 เลขที่: ${orderNo}\n` +
      `👤 ลูกค้า: ${customerName}\n` +
      `📅 วันที่: ${dateStr}\n` +
      `${divider}\n` +
      `รายการที่ถูกลบ:\n` +
      itemLines.split('\n').map(l => `❌ ${l.replace(/^[0-9️⃣🔟]+\s/, '')}`).join('\n') + '\n' +
      `${divider}\n` +
      `🗑️ ลบออกทั้งหมด ${totalQty} ใบ (${coffin_summary})`;
  } else {
    message =
      `${header}\n` +
      `${divider}\n` +
      `🔢 เลขที่: ${orderNo}\n` +
      `👤 ลูกค้า: ${customerName}\n` +
      `📅 วันที่: ${dateStr}\n` +
      `${divider}\n` +
      `รายการสินค้า:\n` +
      `${itemLines}\n` +
      `${divider}\n` +
      `📊 สรุป: ${customerName} สั่ง ${coffin_summary} รวม ${totalQty} ใบ`;
  }

  // สรุปออเดอร์วันนี้ทั้งหมด (cumulative daily summary)
  let daySummary = '';
  if (todayOrders && todayOrders.length > 0) {
    // จัดกลุ่มตามชื่อลูกค้า
    const byCustomer = {};
    for (const order of todayOrders) {
      const cust = order.customerName || '?';
      if (!byCustomer[cust]) byCustomer[cust] = {};
      for (const item of (order.items || [])) {
        const n = item.name;
        byCustomer[cust][n] = (byCustomer[cust][n] || 0) + Number(item.qty);
      }
    }
    const custLines = Object.entries(byCustomer).map(([cust, coffins]) => {
      const parts = Object.entries(coffins).map(([n, q]) => `${n} ${q} ใบ`).join(', ');
      return `👤 ${cust}: ${parts}`;
    });
    const grandTotal = todayOrders.reduce(
      (sum, o) => sum + (o.items || []).reduce((s, i) => s + Number(i.qty), 0), 0
    );
    daySummary = `${divider}\n📋 สรุปออเดอร์วันนี้:\n${custLines.join('\n')}\n📦 รวมทั้งวัน ${grandTotal} ใบ`;
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
