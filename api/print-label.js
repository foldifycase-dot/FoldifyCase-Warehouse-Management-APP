const https = require('https');
const BLOB_TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN || '';
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || '';

function listAllBlobs() {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'blob.vercel-storage.com',
      path: '/?limit=100',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + BLOB_TOKEN }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).blobs || []); }
        catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const orderName = (req.query.orderName || '').replace(/#/g, '').trim();
  const orderId = req.query.orderId || '';
  const debug = req.query.debug === '1';
  const searchName = (orderName || orderId).toLowerCase();

  if (!BLOB_TOKEN) return res.status(500).send('No BLOB_TOKEN');

  try {
    const blobs = await listAllBlobs();

    if (debug) {
      return res.status(200).json({
        count: blobs.length,
        searching: searchName,
        blobs: blobs.map(b => ({ pathname: b.pathname, size: b.size }))
      });
    }

    const match = blobs.find(b => (b.pathname || '').toLowerCase().includes(searchName));

    if (!match) {
      console.log('No label found for:', searchName);
      return res.status(200).send(
        '<!DOCTYPE html><html><head><title>Not Found</title>'
        + '<style>body{font-family:Arial,sans-serif;background:#F5F3E9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}'
        + '.card{background:#fff;border-radius:14px;padding:32px;max-width:480px;text-align:center;}'
        + '.btn{display:inline-block;margin-top:20px;padding:12px 24px;background:#1A1A18;color:#C8A96E;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;}</style>'
        + '</head><body><div class="card">'
        + '<div style="font-size:48px">&#128206;</div>'
        + '<h2 style="margin:16px 0 8px;color:#1A1A18;">Label Not Uploaded Yet</h2>'
        + '<p style="color:#666;font-size:13px;">Order ' + (orderName || orderId) + '</p>'
        + '<a href="https://' + SHOPIFY_DOMAIN + '/admin/orders" class="btn">Open Shopify Admin</a>'
        + '</div></body></html>'
      );
    }

    const publicUrl = match.url || '';
    const name = orderName || orderId;
    console.log('Serving label:', match.pathname);

    // Detect iOS/iPadOS from User-Agent
    const ua = req.headers['user-agent'] || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);

    if (isIOS) {
      // iOS: redirect directly to PDF URL so native PDF viewer opens
      // User can then tap Share > Print from native viewer
      res.setHeader('Location', publicUrl);
      return res.status(302).end();
    }

    // Windows/Mac/Android: serve full print page with auto-print
    const html = '<!DOCTYPE html><html>'
      + '<head><title>Shipping Label - Order ' + name + '</title>'
      + '<style>'
      + '*{margin:0;padding:0;box-sizing:border-box;}'
      + 'body{font-family:Arial,sans-serif;background:#1A1A18;}'
      + '.topbar{background:#1A1A18;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #C8A96E;}'
      + '.logo{color:#C8A96E;font-weight:800;font-size:15px;letter-spacing:.06em;}'
      + '.order{color:rgba(255,255,255,.6);font-size:12px;}'
      + '.print-btn{padding:8px 20px;background:#C8A96E;color:#1A1A18;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;}'
      + '.print-btn:hover{background:#fff;}'
      + '.pdf-wrap{width:100%;height:calc(100vh - 50px);}'
      + 'embed{width:100%;height:100%;border:none;}'
      + '@media print{.topbar{display:none;}.pdf-wrap{height:100vh;}}'
      + '</style></head>'
      + '<body>'
      + '<div class="topbar">'
      + '<div class="logo">FOLDIFYCASE</div>'
      + '<div class="order">Order ' + name + '</div>'
      + '<button class="print-btn" onclick="window.print()">&#128424; Print Label</button>'
      + '</div>'
      + '<div class="pdf-wrap">'
      + '<embed src="' + publicUrl + '" type="application/pdf" width="100%" height="100%">'
      + '</div>'
      + '<script>window.onload=function(){setTimeout(function(){window.print();},1500);};</script>'
      + '</body></html>';

    return res.status(200).send(html);

  } catch(err) {
    console.error('Error:', err.message);
    return res.status(500).send('Error: ' + err.message);
  }
};
