const https = require('https');

const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || '';
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN || '';
const BLOB_TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN || '';
const WAREHOUSE_EMAIL = process.env.WAREHOUSE_EMAIL || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const VERCEL_URL = process.env.APP_URL || '';

// Download a URL following redirects, return buffer + content-type
function downloadURL(urlStr, reqHeaders, maxRedirects) {
  maxRedirects = maxRedirects === undefined ? 8 : maxRedirects;
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: reqHeaders || {}
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : 'https://' + u.hostname + res.headers.location;
        const isExternal = next.includes('amazonaws') || next.includes('cloudfront');
        downloadURL(next, isExternal ? {} : reqHeaders, maxRedirects - 1).then(resolve).catch(reject);
      } else {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'] || 'application/pdf',
          buffer: Buffer.concat(chunks)
        }));
      }
    });
    req.on('error', reject);
    req.end();
  });
}

// Save buffer to Vercel Blob
function saveToBlob(pathname, contentType, buffer) {
  return new Promise((resolve, reject) => {
    // Clean path - keep forward slashes for folders
    const safePath = pathname.replace(/[^a-zA-Z0-9._/\-]/g, '_');
    const encodedPath = safePath.split('/').map(encodeURIComponent).join('/');
    console.log('Saving to blob path:', encodedPath, 'size:', buffer.length, 'type:', contentType);
    const req = https.request({
      hostname: 'blob.vercel-storage.com',
      path: '/' + encodedPath,
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + BLOB_TOKEN,
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'x-vercel-blob-access': 'public',
        'cache-control': 'public, max-age=86400'
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('Blob save response status:', res.statusCode, 'body:', d.substring(0, 200));
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, raw: d }); }
      });
    });
    req.on('error', (e) => {
      console.log('Blob save error:', e.message);
      reject(e);
    });
    req.write(buffer);
    req.end();
  });
}

// Send auto email via our webhook endpoint
function checkLabelInBlob(orderName, token) {
  return new Promise((resolve) => {
    const nameClean = (orderName || '').replace(/#/g, '').trim();
    const prefix = 'Shipping Labels/Order ' + nameClean;
    const req = https.request({
      hostname: 'blob.vercel-storage.com',
      path: '/?prefix=' + encodeURIComponent(prefix) + '&limit=1',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          resolve((json.blobs || []).length > 0);
        } catch(e) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function triggerAutoEmail(orderId, orderName) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      auto_trigger: true,
      order_id: orderId,
      order_name: orderName
    });
    const req = https.request({
      hostname: 'warehouse-stock-management-app.vercel.app',
      path: '/api/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', e => resolve('error: ' + e.message));
    req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const fulfillment = req.body;

    // Shopify sends fulfillment object directly in webhook payload
    const labelUrl = fulfillment.label_url || '';
    const orderId = fulfillment.order_id || '';
    const fulfillmentId = fulfillment.id || '';
    const orderName = fulfillment.name || ('Order #' + orderId);
    const trackingCompany = fulfillment.tracking_company || '';

    // Log the FULL payload so we can see exactly what Shopify sends
    console.log('=== FULFILLMENT WEBHOOK ===');
    console.log('Order:', orderId, 'Fulfillment:', fulfillmentId);
    console.log('Carrier:', trackingCompany);
    console.log('label_url value:', JSON.stringify(labelUrl));
    console.log('All payload keys:', Object.keys(fulfillment).join(', '));
    // Log any key that might contain a URL
    Object.keys(fulfillment).forEach(k => {
      const v = fulfillment[k];
      if (typeof v === 'string' && (v.includes('http') || v.includes('label') || v.includes('pdf'))) {
        console.log('URL-like field [' + k + ']:', v.substring(0, 100));
      }
    });

    if (!labelUrl) {
      console.log('No label_url in payload - skipping');
      return res.status(200).json({ success: true, message: 'No label URL in payload' });
    }

    if (!BLOB_TOKEN) {
      console.log('No BLOB_TOKEN - cannot store label');
      return res.status(200).json({ success: true, message: 'No blob token configured' });
    }

    // Download the label PDF/image immediately while the URL is fresh
    console.log('Downloading label from:', labelUrl.substring(0, 80));
    const downloaded = await downloadURL(labelUrl, {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'User-Agent': 'FoldifyCase/1.0'
    });

    console.log('Download status:', downloaded.status, 'Content-Type:', downloaded.contentType, 'Size:', downloaded.buffer.length);

    if (downloaded.status !== 200 || downloaded.buffer.length < 100) {
      console.log('Download failed or empty');
      return res.status(200).json({ success: false, message: 'Label download failed' });
    }

    // Save to Vercel Blob with order ID as key
    const ext = downloaded.contentType.includes('pdf') ? 'pdf' : 'png';
    const blobPath = 'labels/order_' + orderId + '_fulfillment_' + fulfillmentId + '.' + ext;
    const saved = await saveToBlob(blobPath, downloaded.contentType, downloaded.buffer);

    console.log('Blob save status:', saved.status, 'Path:', blobPath);

    // Check AUTO_SEND env var — if enabled, check label exists before sending
    const autoSend = process.env.AUTO_SEND === 'true';
    if (autoSend && orderId) {
      const orderNameClean = (orderName || String(orderId)).replace(/#/g, '').trim();
      const labelReady = await checkLabelInBlob(orderNameClean, BLOB_TOKEN);
      if (labelReady) {
        console.log('Auto-send: label confirmed in Blob — triggering warehouse email');
        await triggerAutoEmail(orderId, orderName);
      } else {
        console.log('Auto-send skipped: label not yet in Blob for order:', orderNameClean);
      }
    }

    return res.status(200).json({
      success: true,
      blobPath,
      labelSize: downloaded.buffer.length,
      contentType: downloaded.contentType,
      autoSent: autoSend
    });

  } catch(err) {
    console.error('Fulfillment webhook error:', err.message);
    return res.status(200).json({ success: false, error: err.message });
  }
};
