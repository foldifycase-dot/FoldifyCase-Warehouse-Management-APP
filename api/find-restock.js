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

  // The folder name may be stored with spaces OR underscores
  // because uploadBlob's safePath regex converts spaces to underscores
  const FOLDERS = [
    'Supplier_Restock_Lists/',   // spaces → underscores (what uploadBlob actually saves)
    'Supplier Restock Lists/',   // with spaces (correct folder name)
  ];

  let blobs = [];

  // Strategy 1: prefix search with orderId in both folder variants
  for (const folder of FOLDERS) {
    if (blobs.length > 0) break;
    try {
      const r = await blobList(folder + orderId, TOKEN);
      const found = r.blobs || [];
      console.log('[find-restock] prefix search "' + folder + orderId + '" found:', found.length);
      blobs = blobs.concat(found);
    } catch(e) { console.error('[find-restock] prefix error:', e.message); }
  }

  // Strategy 2: list whole folder (both variants) and filter by orderId
  if (blobs.length === 0) {
    for (const folder of FOLDERS) {
      if (blobs.length > 0) break;
      try {
        const r = await blobList(folder, TOKEN);
        const all = r.blobs || [];
        console.log('[find-restock] folder "' + folder + '" total:', all.length,
          'pathnames:', JSON.stringify(all.map(b => b.pathname)));
        const matched = all.filter(b => b.pathname && b.pathname.includes(orderId));
        console.log('[find-restock] matched:', matched.length);
        blobs = blobs.concat(matched);
      } catch(e) { console.error('[find-restock] folder list error:', e.message); }
    }
  }

  // Strategy 3: bare orderId (no folder)
  if (blobs.length === 0) {
    try {
      const r = await blobList(orderId, TOKEN);
      blobs = blobs.concat(r.blobs || []);
      console.log('[find-restock] bare search found:', blobs.length);
    } catch(e) { console.error('[find-restock] bare search error:', e.message); }
  }

  if (blobs.length > 0) {
    blobs.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
    const blob = blobs[0];
    console.log('[find-restock] FOUND:', blob.pathname, '→', blob.url);
    return res.status(200).json({
      url: blob.url,
      uploadedAt: blob.uploadedAt,
      pathname: blob.pathname
    });
  }

  console.log('[find-restock] NOT FOUND for orderId:', orderId);
  return res.status(200).json({ url: null });
};

handler.config = { api: { bodyParser: false } };
module.exports = handler;
