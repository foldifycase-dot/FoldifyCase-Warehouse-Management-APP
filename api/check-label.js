const https = require('https');
const BLOB_TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN || '';

// Use Vercel Blob LIST API to check if a file exists
function listBlob(prefix) {
  return new Promise((resolve) => {
    if (!BLOB_TOKEN) { resolve([]); return; }
    const path = '/?prefix=' + encodeURIComponent(prefix) + '&limit=1';
    const req = https.request({
      hostname: 'blob.vercel-storage.com',
      path: path,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + BLOB_TOKEN }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          resolve(json.blobs || []);
        } catch(e) {
          console.log('List parse error:', d.substring(0,200));
          resolve([]);
        }
      });
    });
    req.on('error', (e) => {
      console.log('List error:', e.message);
      resolve([]);
    });
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { orderName } = req.query;
  if (!orderName) return res.status(400).json({ exists: false, error: 'No orderName' });

  const nameClean = orderName.replace(/#/g, '').trim();
  const prefix = 'Shipping Labels/Order ' + nameClean;

  console.log('Checking blob prefix:', prefix);
  const blobs = await listBlob(prefix);
  console.log('Blobs found:', blobs.length, blobs.map(b => b.pathname || b.url));

  const exists = blobs.length > 0;
  return res.status(200).json({ exists, prefix, count: blobs.length });
};
