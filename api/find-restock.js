// GET /api/find-restock?orderId=PO-XXXXX
// Lists ALL blobs and filters by orderId — works regardless of folder name variant

const https = require('https');

function blobListPage(token, cursor) {
  return new Promise((resolve, reject) => {
    let url = 'https://blob.vercel-storage.com?limit=1000';
    if (cursor) url += '&cursor=' + encodeURIComponent(cursor);
    https.get(url, {
      headers: { Authorization: 'Bearer ' + token }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) {
          console.error('[find-restock] JSON parse error:', d.substring(0, 200));
          resolve({ blobs: [], cursor: null });
        }
      });
    }).on('error', err => {
      console.error('[find-restock] request error:', err.message);
      resolve({ blobs: [], cursor: null });
    });
  });
}

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  const TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'BLOB_TOKEN not configured' });

  console.log('[find-restock] searching for orderId:', orderId);

  try {
    // Fetch ALL blobs (paginated) and filter by orderId
    let allBlobs = [];
    let cursor = null;
    let pages = 0;
    do {
      const page = await blobListPage(TOKEN, cursor);
      const blobs = page.blobs || [];
      allBlobs = allBlobs.concat(blobs);
      cursor = page.cursor || null;
      pages++;
      console.log('[find-restock] page', pages, '— blobs so far:', allBlobs.length, 'has more:', !!cursor);
      if (pages > 20) break; // safety limit
    } while (cursor);

    console.log('[find-restock] total blobs fetched:', allBlobs.length);

    // Log all pathnames containing "restock" or "supplier" for debugging
    const relatedBlobs = allBlobs.filter(b =>
      b.pathname && (
        b.pathname.toLowerCase().includes('restock') ||
        b.pathname.toLowerCase().includes('supplier')
      )
    );
    console.log('[find-restock] restock/supplier blobs:', relatedBlobs.map(b => b.pathname));

    // Filter by orderId (case-insensitive, anywhere in pathname)
    const matched = allBlobs.filter(b =>
      b.pathname && b.pathname.toLowerCase().includes(orderId.toLowerCase())
    );
    console.log('[find-restock] matched for', orderId, ':', matched.map(b => b.pathname));

    if (matched.length > 0) {
      // Sort newest first
      matched.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
      const blob = matched[0];
      console.log('[find-restock] RETURNING:', blob.pathname, blob.url);
      return res.status(200).json({
        url: blob.url,
        uploadedAt: blob.uploadedAt,
        pathname: blob.pathname
      });
    }

    console.log('[find-restock] NO MATCH for orderId:', orderId);
    return res.status(200).json({ url: null, debug: { totalBlobs: allBlobs.length, relatedBlobs: relatedBlobs.map(b => b.pathname) } });

  } catch (e) {
    console.error('[find-restock] ERROR:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
};

handler.config = { api: { bodyParser: false } };
module.exports = handler;
