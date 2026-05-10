export default async function handler(req, res) {
  // รับเฉพาะ POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const TOKEN = process.env.LINE_CHANNEL_TOKEN;
  const GROUP_ID = process.env.LINE_GROUP_ID;

  if (!TOKEN || !GROUP_ID) {
    return res.status(500).json({ error: 'Missing LINE config' });
  }

  const { orderNo, customerName, items, total, createdAt } = req.body;

  // สร้างข้อความแจ้งเตือน
  const dateStr = new Date(createdAt).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const itemLines = (items || [])
    .map(i => `  • ${i.name} × ${i.qty} = ${Number(i.total).toLocaleString('th-TH')} ฿`)
    .join('\n');

  const message =
    `📦 ออเดอร์ใหม่เข้ามาแล้ว!\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🔢 เลขที่: ${orderNo}\n` +
    `👤 ลูกค้า: ${customerName}\n` +
    `📅 วันที่: ${dateStr}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${itemLines}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💰 รวม: ${Number(total).toLocaleString('th-TH')} ฿`;

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
