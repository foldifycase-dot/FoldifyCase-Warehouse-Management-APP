const crypto = require('crypto');
const https = require('https');

const BLOB_TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN || '';

// Fetch stored label from Vercel Blob
function fetchLabelFromBlob(orderId, orderName) {
  return new Promise((resolve) => {
    if (!BLOB_TOKEN) { resolve(null); return; }
    const nameClean = (orderName || '').replace(/#/g, '').replace(/[^a-z0-9 ]/gi, ' ').trim();
    const prefix = 'Shipping Labels/Order ' + (nameClean || orderId);
    const listPath = '/?prefix=' + encodeURIComponent(prefix) + '&limit=1';
    const listReq = https.request({
      hostname: 'blob.vercel-storage.com',
      path: listPath,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + BLOB_TOKEN }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          const blobs = json.blobs || [];
          if (!blobs.length) { console.log('No label in blob for:', prefix); resolve(null); return; }
          const blobUrl = blobs[0].url || blobs[0].downloadUrl || '';
          console.log('Found label:', blobs[0].pathname, 'downloading...');
          if (!blobUrl) { resolve(null); return; }
          const u = new URL(blobUrl);
          const getReq = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'GET'
          }, (getRes) => {
            const chunks = [];
            getRes.on('data', c => chunks.push(c));
            getRes.on('end', () => {
              const buf = Buffer.concat(chunks);
              console.log('Label PDF size:', buf.length);
              if (buf.length > 100) resolve({ body: buf.toString('base64'), contentType: 'application/pdf' });
              else resolve(null);
            });
          });
          getReq.on('error', (e) => { console.log('Get error:', e.message); resolve(null); });
          getReq.end();
        } catch(e) { console.log('Parse error:', e.message); resolve(null); }
      });
    });
    listReq.on('error', (e) => { console.log('List error:', e.message); resolve(null); });
    listReq.end();
  });
}

const WAREHOUSE_EMAIL = process.env.WAREHOUSE_EMAIL || 'uswarehousefoldifycase@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'warehouse@foldifycase.com.au';
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || '';
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const VERCEL_URL = 'https://warehouse-stock-management-app.vercel.app';

function getCountryCode(addr) {
  if (addr.country_code) return addr.country_code.toUpperCase();
  const map = {
    'United States': 'US', 'USA': 'US', 'Australia': 'AU',
    'United Kingdom': 'UK', 'Great Britain': 'UK', 'Canada': 'CA',
    'New Zealand': 'NZ', 'Germany': 'DE', 'France': 'FR',
    'Japan': 'JP', 'Singapore': 'SG', 'Malaysia': 'MY',
  };
  return map[addr.country] || (addr.country ? addr.country.substring(0,2).toUpperCase() : '??');
}

function sendResendEmail(to, subject, html) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      from: 'FoldifyCase <' + FROM_EMAIL + '>', to, subject, html,
      headers: {}, tags: [], click_tracking: false
    });
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function buildPackingSlipURL(order, items, addr) {
  const fulfillment = (order.fulfillments || [])[0] || {};
  const safeOrderName = (order.name || '').replace(/#/g, '');
  const params = new URLSearchParams({
    name: safeOrderName,
    customer: addr.name || '',
    address1: addr.address1 || '',
    city: addr.city || '',
    province: addr.province || '',
    zip: addr.zip || '',
    country: addr.country || '',
    carrier: fulfillment.tracking_company || 'Standard Shipping',
    tracking: fulfillment.tracking_number || 'Pending',
    total: order.total_price || '0',
    currency: order.currency || 'USD',
    date: order.created_at || new Date().toISOString(),
    items: JSON.stringify(items.map(i => ({
      title: i.title || '',
      variant: i.variant_title || i.variant || '',
      qty: i.quantity || i.qty || 1,
      price: i.price || '0',
      imageUrl: i.imageUrl || '',
      productUrl: i.productUrl || ''
    })))
  });
  return `${VERCEL_URL}/api/packing-slip?${params.toString()}`;
}

function buildEmailHTML(order, labelURL, isTest, toEmail, packingSlipURL, items, addr, uploadURL, labelData) {
  const countryCode = getCountryCode(addr);

  const itemRows = items.map(i => {
    // Get image URL - check all possible field names
    const rawImg = i.imageUrl || i.image_url || (i.image && i.image.src) || '';
    // Strip size suffix only (e.g. _600x600) - keep ?v= param intact
    const fullImg = rawImg ? rawImg.replace(/_\d+x\d*/g, '') : '';
    const itemUrl = i.productUrl || '';
    const itemVariant = i.variant_title || i.variant || '';
    const itemQty = i.quantity || i.qty || 1;

    // Build image or placeholder
    let imgHtml;
    if (fullImg) {
      const imgTag = `<img src="${fullImg}" width="80" height="80" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #EAE7D8;display:block;" alt="">`;
      imgHtml = itemUrl
        ? `<a href="${itemUrl}" target="_blank" style="display:block;text-decoration:none;">${imgTag}</a>`
        : imgTag;
    } else {
      imgHtml = itemUrl
        ? `<a href="${itemUrl}" target="_blank" style="display:flex;width:80px;height:80px;background:#EAE7D8;border-radius:8px;align-items:center;justify-content:center;text-decoration:none;flex-direction:column;gap:4px;border:1.5px dashed #C8A96E;"><span style="font-size:22px;">&#128230;</span><span style="font-size:8px;color:#A6873A;font-weight:700;">VIEW</span></a>`
        : `<div style="width:80px;height:80px;background:#EAE7D8;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:28px;">&#128230;</div>`;
    }
    const urlLink = itemUrl
      ? `<br><a href="${itemUrl}" target="_blank" style="font-size:10px;color:#A6873A;text-decoration:none;">View product ↗</a>`
      : '';
    return `<tr>
      <td style="padding:10px 14px;border-bottom:1px solid #EAE7D8;vertical-align:middle;width:90px;">${imgHtml}</td>
      <td style="padding:10px 10px;font-size:13px;border-bottom:1px solid #EAE7D8;vertical-align:middle;">${i.title || ''}${itemVariant ? '<br><span style="font-size:11px;color:#888;">' + itemVariant + '</span>' : ''}${urlLink}</td>
      <td style="padding:10px 14px;text-align:center;border-bottom:1px solid #EAE7D8;font-size:13px;vertical-align:middle;">${itemQty}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:20px;color:#1A1A18;">
${isTest ? `<div style="background:#FFF3CD;border:1px solid #F0AD4E;border-radius:8px;padding:10px 16px;margin-bottom:16px;font-size:12px;color:#856404;"><strong>TEST EMAIL</strong> — Real warehouse: ${WAREHOUSE_EMAIL}</div>` : ''}

<div style="background:#1A1A18;padding:20px 24px;border-radius:10px;margin-bottom:20px;border-bottom:3px solid #C8A96E;">
  <div style="font-size:22px;font-weight:800;color:#C8A96E;">FOLDIFYCASE</div>
  <div style="font-size:10px;color:#C8A96E;letter-spacing:.15em;text-transform:uppercase;margin-top:3px;">${countryCode} — Warehouse Fulfillment — ${order.name}</div>
</div>

<div style="background:#eaf3de;border:1px solid #3B6D11;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
  <div style="font-size:14px;font-weight:700;color:#27500A;">📦 New order ready to ship</div>
  <div style="font-size:12px;color:#3B6D11;margin-top:3px;">Please print the label and packing slip below, then ship ASAP.</div>
</div>

<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
  <tr>
    <td style="padding-right:8px;" width="50%">
      <a href="${labelURL}" target="_blank" style="display:block;padding:14px 16px;background:#1A1A18;color:#C8A96E;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;text-align:center;">
        🏷️ Print Shipping Label
      </a>
    </td>
    <td width="50%">
      <a href="${packingSlipURL}" style="display:block;padding:14px 16px;background:#C8A96E;color:#1A1A18;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;text-align:center;">
        📋 View Packing Slip
      </a>
    </td>
  </tr>
</table>



<div style="border:1.5px solid #EAE7D8;border-radius:10px;overflow:hidden;margin-bottom:20px;">
  <div style="background:#F5F3E9;padding:14px 18px;border-bottom:1px solid #EAE7D8;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><div style="font-size:16px;font-weight:800;">FoldifyCase</div><div style="font-size:10px;color:rgba(26,26,24,.4);text-transform:uppercase;letter-spacing:.1em;">Packing Slip</div></td>
      <td style="text-align:right;"><div style="font-size:14px;font-weight:700;color:#A6873A;">${order.name}</div></td>
    </tr></table>
  </div>
  <div style="padding:14px 18px;border-bottom:1px solid #EAE7D8;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%">
        <div style="font-size:9px;text-transform:uppercase;color:rgba(26,26,24,.4);margin-bottom:5px;">Ship To</div>
        <div style="font-size:13px;line-height:1.7;"><strong>${addr.name || ''}</strong><br>${addr.address1 || ''}<br>${addr.city || ''}, ${addr.province || ''} ${addr.zip || ''}<br>${addr.country || ''}</div>
      </td>
      <td width="50%">
        <div style="font-size:9px;text-transform:uppercase;color:rgba(26,26,24,.4);margin-bottom:5px;">Carrier</div>
        <div style="font-size:13px;font-weight:600;">${(order.fulfillments && order.fulfillments[0] && order.fulfillments[0].tracking_company) || 'Standard Shipping'}</div>
        <div style="font-size:11px;color:rgba(26,26,24,.5);margin-top:4px;">Tracking: ${(order.fulfillments && order.fulfillments[0] && order.fulfillments[0].tracking_number) || 'Pending'}</div>
      </td>
    </tr></table>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <thead><tr style="background:#F5F3E9;">
      <th style="padding:7px 14px;text-align:left;font-size:9px;text-transform:uppercase;color:rgba(26,26,24,.4);width:90px;">Image</th>
      <th style="padding:7px 10px;text-align:left;font-size:9px;text-transform:uppercase;color:rgba(26,26,24,.4);">Item</th>
      <th style="padding:7px 14px;text-align:center;font-size:9px;text-transform:uppercase;color:rgba(26,26,24,.4);width:50px;">Qty</th>
    </tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
</div>

<div style="background:#F5F3E9;border:1.5px solid #EAE7D8;border-radius:10px;padding:20px;margin-bottom:20px;text-align:center;">
  <div style="font-size:13px;font-weight:700;color:#1A1A18;margin-bottom:6px;">📸 After packing, upload a photo</div>
  <div style="font-size:12px;color:#666;margin-bottom:14px;">Take a photo of the packed box before shipping and upload it here.</div>
  <a href="${uploadURL}" style="display:inline-block;padding:12px 28px;background:#3D7A5A;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.03em;">
    📷 Upload Packing Image
  </a>
</div>

<div style="font-size:11px;color:rgba(26,26,24,.4);border-top:1px solid #EAE7D8;padding-top:14px;line-height:1.8;">
  🤖 Sent automatically by FoldifyCase Warehouse Hub &mdash; ${toEmail}
</div>
</body></html>`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-shopify-hmac-sha256');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const isDirectSend = payload.direct_send === true;
    const toEmail = payload.to_email || WAREHOUSE_EMAIL;
    const isTest = payload.is_test || false;

    console.log('Webhook received. To:', toEmail);

    let order;
    if (isDirectSend && payload.order) {
      order = payload.order;
    } else {
      const orderId = payload.order_id || payload.id;
      if (!orderId) return res.status(400).json({ error: 'No order ID' });
      const result = await new Promise((resolve, reject) => {
        const options = {
          hostname: SHOPIFY_DOMAIN,
          path: `/admin/api/2024-01/orders/${orderId}.json`,
          method: 'GET',
          headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN }
        };
        https.get(options, (r) => {
          let d = '';
          r.on('data', chunk => d += chunk);
          r.on('end', () => resolve(JSON.parse(d)));
        }).on('error', reject);
      });
      order = result.order;
    }

    const addr = order.shipping_address || {};
    const items = order.line_items || [];
    const fulfillment = (order.fulfillments || [])[0] || {};
    const orderId = order.id || order.shopifyOrderId;
    const safeName = (order.name || '').replace(/#/g, '');
    const fulfillmentId = fulfillment.id || order.shopifyFulfillmentId || '';

    // Label URL - opens in Shopify admin (requires one-time login)
    // Use our print-label endpoint which serves PDF directly from Vercel Blob
    // Falls back to Shopify admin if no label uploaded yet
    const safeNameForUrl = (order.name || '').replace(/#/g, '').trim();
    const finalLabelURL = `${VERCEL_URL}/api/print-label?orderName=${encodeURIComponent(safeNameForUrl)}&orderId=${encodeURIComponent(orderId)}`;

    const packingSlipURL = buildPackingSlipURL(order, items, addr);
    const uploadURL = VERCEL_URL + '/api/upload-image?orderId=' + encodeURIComponent(orderId) + '&orderName=' + encodeURIComponent(safeName);

    // Check if label was pre-stored in Blob when purchased
    const labelData = await fetchLabelFromBlob(String(orderId), order.name || '');
    if (labelData) {
      console.log('Using stored label from blob:', labelData.path);
    } else {
      console.log('No stored label found in blob for order:', orderId);
    }

    const subject = `Order ${order.name || safeName} - Packing Slip and Shipping Label${isTest ? ' [TEST]' : ''}`;
    const html = buildEmailHTML(order, finalLabelURL, isTest, toEmail, packingSlipURL, items, addr, uploadURL, labelData);

    console.log('Sending email to:', toEmail);
    const result = await sendResendEmail(toEmail, subject, html);
    const resendOk = result.status === 200 || result.status === 201;
    console.log('Resend result:', result.status, resendOk ? 'OK emailId:' + (result.data && result.data.id) : 'FAILED:' + JSON.stringify(result.data));

    if (resendOk) {
      return res.status(200).json({ success: true, order: order.name, emailId: result.data.id });
    } else {
      const errMsg = (result.data && result.data.message) || JSON.stringify(result.data);
      console.error('Resend error:', errMsg);
      return res.status(200).json({ success: false, error: errMsg });
    }

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
