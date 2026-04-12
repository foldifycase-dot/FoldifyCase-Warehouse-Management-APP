const https = require('https');
const BLOB_TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN || '';
const SENT_FILE = 'sent-orders/sent_order_ids.json';

// Read sent orders from blob
function readSentOrders() {
  return new Promise((resolve) => {
    const encoded = SENT_FILE.split('/').map(encodeURIComponent).join('/');
    const req = https.request({
      hostname: 'blob.vercel-storage.com',
      path: '/?prefix=' + encodeURIComponent(SENT_FILE) + '&limit=1',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + BLOB_TOKEN }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const blobs = JSON.parse(d).blobs || [];
          if (blobs.length === 0) { resolve([]); return; }
          // Fetch the actual file content
          const url = blobs[0].url || '';
          if (!url) { resolve([]); return; }
          const u = new URL(url);
          const req2 = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'GET'
          }, (res2) => {
            let data = '';
            res2.on('data', c => data += c);
            res2.on('end', () => {
              try { resolve(JSON.parse(data) || []); }
              catch(e) { resolve([]); }
            });
          });
          req2.on('error', () => resolve([]));
          req2.end();
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// Write sent orders to blob
function writeSentOrders(ids) {
  return new Promise((resolve) => {
    const body = JSON.stringify(ids);
    const req = https.request({
      hostname: 'blob.vercel-storage.com',
      path: '/' + SENT_FILE.split('/').map(encodeURIComponent).join('/') + '?allowOverwrite=1',
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + BLOB_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-vercel-blob-access': 'public',
        'x-vercel-blob-add-random-suffix': '0'
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!BLOB_TOKEN) return res.status(500).json({ error: 'No BLOB_TOKEN' });

  // GET - load all sent order IDs
  if (req.method === 'GET') {
    const ids = await readSentOrders();
    console.log('Loaded sent orders:', ids.length);
    return res.status(200).json({ success: true, ids });
  }

  // POST - add new sent order ID(s)
  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    await new Promise(r => req.on('end', r));

    try {
      const { orderId, orderIds } = JSON.parse(body);
      // Load existing
      const existing = await readSentOrders();
      const existingSet = new Set(existing.map(String));

      // Add new IDs
      const toAdd = orderIds || (orderId ? [orderId] : []);
      toAdd.forEach(id => existingSet.add(String(id)));

      const updated = Array.from(existingSet);
      await writeSentOrders(updated);
      console.log('Saved sent orders:', updated.length);
      return res.status(200).json({ success: true, total: updated.length });
    } catch(e) {
      return res.status(400).json({ error: e.message });
    }
  }

  return res.status(405).end();
};
