// Dedicated endpoint to find a supplier restock list image from Blob
// GET /api/find-restock?orderId=PO-XXXXX

const https = require('https');

function blobList(prefix, token) {
  return new Promise((resolve, reject) => {
    const url = 'https://blob.vercel-storage.com?prefix=' + encodeURIComponent(prefix) + '&limit=100';
    https.get(url, {
      headers: { Authorization: 'Bearer ' + token }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve({ blobs: [] }); }
      });
    }).on('error', reject);
  });
}

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  const TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'BLOB_TOKEN not configured' });

  console.log('[find-restock] looking for orderId:', orderId);

  let blobs = [];

  // Strategy 1: search with exact folder + orderId prefix
  try {
    const r1 = await blobList('Supplier Restock Lists/' + orderId, TOKEN);
    blobs = blobs.concat(r1.blobs || []);
    console.log('[find-restock] strategy1 found:', blobs.length);
  } catch(e) { console.error('[find-restock] strategy1 error:', e.message); }

  // Strategy 2: list entire folder and filter by orderId
  if (blobs.length === 0) {
    try {
      const r2 = await blobList('Supplier Restock Lists/', TOKEN);
      const all = r2.blobs || [];
      console.log('[find-restock] strategy2 total blobs in folder:', all.length);
      console.log('[find-restock] all pathnames:', all.map(b => b.pathname));
      const matched = all.filter(b => b.pathname && b.pathname.includes(orderId));
      blobs = blobs.concat(matched);
      console.log('[find-restock] strategy2 matched:', matched.length);
    } catch(e) { console.error('[find-restock] strategy2 error:', e.message); }
  }

  // Strategy 3: try without the folder prefix (in case blob was stored differently)
  if (blobs.length === 0) {
    try {
      const r3 = await blobList(orderId, TOKEN);
      blobs = blobs.concat(r3.blobs || []);
      console.log('[find-restock] strategy3 found:', blobs.length);
    } catch(e) { console.error('[find-restock] strategy3 error:', e.message); }
  }

  if (blobs.length > 0) {
    // Sort newest first
    blobs.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
    const blob = blobs[0];
    console.log('[find-restock] returning:', blob.pathname, blob.url);
    return res.status(200).json({
      url: blob.url,
      uploadedAt: blob.uploadedAt,
      pathname: blob.pathname
    });
  }

  console.log('[find-restock] not found for orderId:', orderId);
  return res.status(200).json({ url: null });
};

handler.config = { api: { bodyParser: false } };
module.exports = handler;
