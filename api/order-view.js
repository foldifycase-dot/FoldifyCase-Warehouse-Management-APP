import { list } from '@vercel/blob';

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const PO_BLOB_KEY = 'History Of Restock/po_orders.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const orderId = req.query.id;
  if (!orderId) {
    return res.status(400).send('<h2>Missing order ID</h2>');
  }

  // Load orders from Blob
  let orders = [];
  try {
    const listRes = await fetch(
      `https://blob.vercel-storage.com?prefix=${encodeURIComponent(PO_BLOB_KEY)}&limit=1`,
      { headers: { 'Authorization': `Bearer ${BLOB_TOKEN}`, 'x-api-version': '7' } }
    );
    const listData = await listRes.json();
    const blobs = listData.blobs || [];
    if (blobs.length) {
      const fileRes = await fetch(blobs[0].url);
      orders = await fileRes.json();
    }
  } catch(e) {
    console.error('[order-view] Load error:', e.message);
  }

  const order = orders.find(o => o.id === orderId);
  if (!order) {
    return res.status(404).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;color:#888">
      <h2>Order not found</h2><p>Order ${orderId} could not be found.</p>
    </body></html>`);
  }

  const totalQty = order.lines.reduce((s, l) => s + l.qty, 0);
  const shipLabel = order.ship === 'air' ? 'Air — Express' : 'Sea — Standard';
  const shipColor = order.ship === 'air' ? '#2D5FA6' : '#3D7A5A';
  const date = order.orderDate || new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  const rows = order.lines.map(l => `
    <tr>
      <td style="padding:14px 20px;border-bottom:1px solid #F0EDE8;vertical-align:middle;width:72px">
        ${l.image
          ? `<img src="${l.image}" width="52" height="52" style="border-radius:6px;object-fit:cover;display:block;border:1px solid #EEE">`
          : `<div style="width:52px;height:52px;border-radius:6px;background:#F5F3EE;border:1px solid #EEE"></div>`}
      </td>
      <td style="padding:14px 20px;border-bottom:1px solid #F0EDE8;vertical-align:middle">
        <div style="font-size:14px;font-weight:600;color:#1A1A18">${l.product}</div>
        <div style="font-size:12px;color:#999;margin-top:3px">${l.variant}</div>
      </td>
      <td style="padding:14px 20px;border-bottom:1px solid #F0EDE8;vertical-align:middle;text-align:right;width:60px">
        <span style="font-size:22px;font-weight:800;color:#1A1A18;font-family:'Georgia',serif">${l.qty}</span>
      </td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Restock Order ${order.id} — FoldifyCase</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#F0EDE8;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;}
    .page{background:#fff;border-radius:12px;max-width:680px;width:100%;box-shadow:0 2px 24px rgba(0,0,0,.08);overflow:hidden;}
    .top{padding:32px 40px 24px;display:flex;justify-content:space-between;align-items:flex-start;}
    .brand{font-size:26px;font-weight:900;letter-spacing:.06em;color:#1A1A18;font-family:'Arial Black',Arial,sans-serif;}
    .brand-sub{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#999;margin-top:3px;}
    .order-id{font-size:26px;font-weight:800;color:#C8A96E;font-family:'Courier New',monospace;}
    .order-date{font-size:12px;color:#999;margin-top:4px;text-align:right;}
    .divider{height:2px;background:#1A1A18;margin:0 40px 28px;}
    .info{display:flex;gap:0;padding:0 40px 24px;}
    .info-col{flex:1;}
    .info-label{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#AAA;margin-bottom:8px;font-weight:600;}
    .info-val{font-size:13px;font-weight:600;color:#1A1A18;line-height:1.5;}
    .info-chip{display:inline-block;background:${shipColor};color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:4px;margin-top:6px;}
    .items-count{font-size:12px;color:#AAA;padding:0 40px 12px;}
    table{width:100%;border-collapse:collapse;}
    thead tr{background:#F5F3EE;}
    thead th{padding:10px 20px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#AAA;text-align:left;font-weight:600;}
    thead th:last-child{text-align:right;}
    .footer-note{padding:20px 40px;text-align:center;font-size:11px;color:#BBB;border-top:1px solid #F0EDE8;letter-spacing:.04em;}
  </style>
</head>
<body>
<div class="page">
  <div class="top">
    <div>
      <div class="brand">FOLDIFYCASE</div>
      <div class="brand-sub">Restock Order</div>
    </div>
    <div>
      <div class="order-id">${order.id}</div>
      <div class="order-date">${date}</div>
    </div>
  </div>
  <div class="divider"></div>
  <div class="info">
    <div class="info-col">
      <div class="info-label">Order Details</div>
      <div class="info-val">${order.lines.length} SKU${order.lines.length !== 1 ? 's' : ''} · ${totalQty} units total</div>
      ${order.notes ? `<div style="font-size:12px;color:#777;margin-top:4px">${order.notes}</div>` : ''}
    </div>
    <div class="info-col">
      <div class="info-label">Shipping Method</div>
      <div class="info-val">${shipLabel}</div>
      <div class="info-chip">ETA ${order.eta}</div>
    </div>
    ${order.tracking ? `<div class="info-col"><div class="info-label">Tracking</div><div class="info-val" style="font-family:'Courier New',monospace;font-size:12px;color:#2D5FA6">${order.tracking}</div></div>` : ''}
  </div>
  <div class="items-count">${order.lines.length} item${order.lines.length !== 1 ? 's' : ''} to receive</div>
  <table>
    <thead>
      <tr>
        <th style="width:72px">IMAGE</th>
        <th>PRODUCT</th>
        <th style="text-align:right">QTY</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer-note">FOLDIFYCASE — Please verify all items upon arrival and update inventory in Shopify.</div>
</div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
