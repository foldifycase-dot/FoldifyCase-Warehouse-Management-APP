module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    name, customer, address1, city, province, zip, country,
    carrier, tracking, total, currency, items, date
  } = req.query;

  let parsedItems = [];
  try { parsedItems = JSON.parse(decodeURIComponent(items || '[]')); } catch(e) {}

  const orderDate = date
    ? new Date(date).toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})
    : new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'});

  const itemRows = parsedItems.map(i => {
    const imgTag = i.imageUrl
      ? `<img src="${i.imageUrl}" alt="${i.title}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #eee;display:block;">`
      : `<div style="width:70px;height:70px;background:#f5f3e9;border-radius:6px;border:1px solid #eee;display:flex;align-items:center;justify-content:center;font-size:22px;">📦</div>`;
    const imgHtml = i.productUrl
      ? `<a href="${i.productUrl}" target="_blank" style="display:block;text-decoration:none;">${imgTag}</a>`
      : imgTag;
    return `<tr>
      <td style="padding:12px 14px;border-bottom:1px solid #eee;vertical-align:middle;">
        ${imgHtml}
      </td>
      <td style="padding:12px 14px;border-bottom:1px solid #eee;vertical-align:middle;">
        <div style="font-size:13px;font-weight:600;color:#1A1A18;">${i.title}</div>
        ${i.variant ? `<div style="font-size:11px;color:#888;margin-top:3px;">${i.variant}</div>` : ''}
      </td>
      <td style="padding:12px 14px;border-bottom:1px solid #eee;text-align:center;vertical-align:middle;">
        <div style="font-size:18px;font-weight:800;color:#1A1A18;">${i.qty}</div>
      </td>

    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Packing Slip ${name || ''}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;color:#1A1A18;}
@media print{
  body{background:#fff;padding:0;}
  .no-print{display:none!important;}
  .page{box-shadow:none;border-radius:0;margin:0;padding:20px;}
}
.no-print{text-align:center;margin-bottom:20px;}
.print-btn{
  padding:14px 50px;background:#1A1A18;color:#C8A96E;
  border:none;border-radius:8px;font-size:15px;font-weight:700;
  cursor:pointer;letter-spacing:.05em;
}
.print-btn:hover{background:#333;}
.page{background:#fff;max-width:760px;margin:0 auto;padding:36px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.1);}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:2.5px solid #1A1A18;}
.brand-name{font-size:26px;font-weight:800;letter-spacing:-.02em;}
.brand-sub{font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:.15em;margin-top:4px;}
.order-num{font-size:22px;font-weight:700;color:#A6873A;text-align:right;}
.order-date{font-size:12px;color:#aaa;text-align:right;margin-top:4px;}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;padding:20px;background:#f9f7f2;border-radius:8px;}
.info-label{font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:#aaa;margin-bottom:6px;}
.info-value{font-size:13px;line-height:1.75;color:#1A1A18;}
.info-value strong{font-weight:700;}
.tracking-badge{display:inline-block;background:#1A1A18;color:#C8A96E;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:700;margin-top:5px;letter-spacing:.05em;}
table{width:100%;border-collapse:collapse;margin-bottom:16px;}
thead th{background:#f5f3e9;padding:10px 14px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:#aaa;border-bottom:2px solid #eee;}
thead th:nth-child(3){text-align:center;}
thead th:last-child{text-align:right;}
.total-row{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:#1A1A18;color:#C8A96E;font-weight:700;font-size:17px;border-radius:8px;}
.footer{margin-top:24px;padding-top:16px;border-top:1px solid #eee;text-align:center;font-size:11px;color:#ccc;letter-spacing:.05em;}
.items-count{font-size:11px;color:#aaa;margin-bottom:10px;}
</style>
</head>
<body>
<div class="no-print">
  <button class="print-btn" onclick="window.print()">🖨️ PRINT PACKING SLIP</button>
</div>
<div class="page">
  <div class="header">
    <div>
      <div class="brand-name">FOLDIFYCASE</div>
      <div class="brand-sub">Packing Slip</div>
    </div>
    <div>
      <div class="order-num">${name || 'Order'}</div>
      <div class="order-date">${orderDate}</div>
    </div>
  </div>

  <div class="info-grid">
    <div>
      <div class="info-label">Ship To</div>
      <div class="info-value">
        <strong>${decodeURIComponent(customer || '')}</strong><br>
        ${decodeURIComponent(address1 || '')}<br>
        ${city ? decodeURIComponent(city) + ', ' + decodeURIComponent(province || '') + ' ' + decodeURIComponent(zip || '') : ''}<br>
        ${decodeURIComponent(country || '')}
      </div>
    </div>
    <div>
      <div class="info-label">Shipping Method</div>
      <div class="info-value">
        <strong>${decodeURIComponent(carrier || 'Standard Shipping')}</strong><br>
        <span class="tracking-badge">${decodeURIComponent(tracking || 'Pending')}</span>
      </div>
    </div>
  </div>

  <div class="items-count">${parsedItems.length} item${parsedItems.length !== 1 ? 's' : ''} to pack</div>

  <table>
    <thead>
      <tr>
        <th style="width:90px;">Image</th>
        <th>Product</th>
        <th style="width:70px;text-align:center;">Qty</th>
        
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>



  <div class="footer">FOLDIFYCASE &mdash; Thank you for your order! Please double-check all items before sealing the package.</div>
</div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
};
