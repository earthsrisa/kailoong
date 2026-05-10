export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const TOKEN = process.env.LINE_CHANNEL_TOKEN;
  const GROUP_ID = process.env.LINE_GROUP_ID;

  if (!TOKEN || !GROUP_ID) {
    return res.status(500).json({ error: 'Missing LINE config' });
  }

  const { type, customerName, items, createdAt, todayOrders } = req.body;
  // type: 'new' | 'edit' | 'delete'

  const dateStr = new Date(createdAt).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const itemList = items || [];

  // รายการสินค้า (รวม สีโลง + สีเส้น)
  const numEmoji = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  const itemLines = itemList
    .map((i, idx) => {
      const parts = [i.name, i.color, i.trimColor].filter(Boolean);
      if (type === 'edit') {
        // แสดง icon ตามประเภทการเปลี่ยนแปลง
        const icon = i.changeType === 'added' ? '➕' : i.changeType === 'removed' ? '➖' : '✏️';
        return `${icon} ${parts.join(' ')} × ${i.qty} ใบ`;
      }
      const num = numEmoji[idx] || `${idx+1}.`;
      return `${num} ${parts.join(' ')} × ${i.qty} ใบ`;
    })
    .join('\n');

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
  if (type === 'delete') {
    // รายการที่ถูกลบ — แสดงสีโลง + สีเส้นด้วย
    const deleteItemLines = itemList.map(i => {
      const parts = [i.name, i.color, i.trimColor].filter(Boolean);
      return `❌ ${parts.join(' ')} × ${i.qty} ใบ`;
    }).join('\n');

    message =
      `${header}\n` +
      `${divider}\n` +
      `👤 ลูกค้า: ${customerName}\n` +
      `📅 วันที่: ${dateStr}\n` +
      `${divider}\n` +
      `รายการที่ถูกลบ:\n` +
      deleteItemLines;
  } else {
    const sectionLabel = type === 'edit' ? 'รายการที่เปลี่ยนแปลง:' : 'รายการสินค้า:';
    message =
      `${header}\n` +
      `${divider}\n` +
      `👤 ลูกค้า: ${customerName}\n` +
      `📅 วันที่: ${dateStr}\n` +
      `${divider}\n` +
      `${sectionLabel}\n` +
      `${itemLines}`;
  }

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
    const custBlocks = custOrder.map(cust => {
      const lines = byCustomer[cust].map(i => {
        const parts = [i.name, i.color, i.trimColor].filter(Boolean);
        return `${parts.join(' ')} × ${i.qty} ใบ`;
      }).join('\n');
      return `${cust}\n${lines}`;
    });
    const grandTotal = todayOrders.reduce(
      (sum, o) => sum + (o.items || []).reduce((s, i) => s + Number(i.qty), 0), 0
    );
    daySummary =
      `${divider}\n` +
      `สรุปรายการทั้งหมด\n\n` +
      `${custBlocks.join('\n\n')}\n\n` +
      `รวม ${grandTotal} ใบ`;
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
