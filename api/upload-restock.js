const https = require('https');

function parseMultipart(body, boundary) {
  const parts = [];
  const sep = Buffer.from('\r\n--' + boundary);
  let pos = body.indexOf(Buffer.from('--' + boundary));
  while (pos !== -1) {
    const headerStart = pos + boundary.length + 4;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headers = body.slice(headerStart, headerEnd).toString();
    const dataStart = headerEnd + 4;
    let dataEnd = body.indexOf(sep, dataStart);
    if (dataEnd === -1) dataEnd = body.length;
    const nameMatch = headers.match(/name="([^"]+)"/);
    const fileMatch = headers.match(/filename="([^"]+)"/);
    const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: fileMatch ? fileMatch[1] : null,
        contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
        data: body.slice(dataStart, dataEnd)
      });
    }
    pos = body.indexOf(Buffer.from('--' + boundary), dataStart);
  }
  return parts;
}

function uploadBlob(pathname, contentType, data, token) {
  return new Promise((resolve, reject) => {
    const safePath = pathname.replace(/[^a-zA-Z0-9._\/\-]/g, '_');
    const opts = {
      hostname: 'blob.vercel-storage.com',
      path: '/' + safePath,
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': contentType,
        'Content-Length': data.length,
        'x-vercel-blob-access': 'public',
        'cache-control': 'public, max-age=31536000'
      }
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('Blob response status:', res.statusCode);
        console.log('Blob response body:', d.substring(0, 300));
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, raw: d }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Save uploaded URL back to PO orders blob
async function saveRestockUrl(orderId, imageUrl, token) {
  try {
    const PO_KEY = 'History Of Restock/po_orders.json';
    // List blobs to find the current PO orders file URL
    const listRes = await fetch(
      'https://blob.vercel-storage.com?prefix=' + encodeURIComponent(PO_KEY) + '&limit=1',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const listJson = await listRes.json();
    console.log('[upload-restock] PO blob list:', JSON.stringify(listJson).substring(0, 200));
    if (!listJson.blobs || !listJson.blobs.length) {
      console.log('[upload-restock] PO orders file not found in blob');
      return;
    }
    // Fetch current orders
    const ordersRes = await fetch(listJson.blobs[0].url);
    let orders = await ordersRes.json();
    console.log('[upload-restock] loaded', orders.length, 'orders, looking for', orderId);
    // Update the matching order
    const order = orders.find(o => o.id === orderId);
    if (!order) {
      console.log('[upload-restock] order', orderId, 'not found in PO list');
      return;
    }
    order.restockListUrl = imageUrl;
    order.restockListUploadedAt = new Date().toISOString();
    // Save back using blob REST API with correct headers
    const body = Buffer.from(JSON.stringify(orders));
    const safePOKey = PO_KEY.replace(/ /g, '%20');
    const putRes = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'blob.vercel-storage.com',
        path: '/' + safePOKey,
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          'x-vercel-blob-access': 'public',
          'x-vercel-blob-add-random-suffix': 'false',
          'x-vercel-blob-allow-overwrite': 'true',
          'cache-control': 'no-cache'
        }
      };
      const r = https.request(opts, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      r.on('error', reject);
      r.write(body);
      r.end();
    });
    console.log('[upload-restock] PO save result:', putRes.status, putRes.body.substring(0, 100));
  } catch(e) {
    console.error('[upload-restock] saveRestockUrl failed:', e.message);
  }
}

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { orderId } = req.query;

  // ── GET: Upload page ───────────────────────────────────────────────────────
  if (req.method === 'GET') {
    return res.status(200).send(`<!DOCTYPE html><html>
    <head><title>Upload Restock List - ${orderId}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:Arial,sans-serif;background:#F5F3E9;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;}
      .card{background:#fff;border-radius:14px;padding:32px;max-width:480px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.1);}
      .logo{font-size:22px;font-weight:800;color:#1A1A18;letter-spacing:.06em;margin-bottom:4px;}
      .sub{font-size:11px;color:#C8A96E;letter-spacing:.15em;text-transform:uppercase;margin-bottom:24px;}
      h2{font-size:17px;color:#1A1A18;margin-bottom:6px;}
      .badge{display:inline-block;background:#F5F3E9;border:1px solid #EAE7D8;border-radius:6px;padding:4px 12px;font-size:13px;font-weight:700;color:#A6873A;margin-bottom:8px;}
      .hint{font-size:12px;color:rgba(26,26,24,.5);margin-bottom:24px;line-height:1.6;}
      .drop{border:2px dashed #C8A96E;border-radius:10px;padding:40px 20px;text-align:center;cursor:pointer;transition:all .2s;background:#fdfcf8;margin-bottom:16px;}
      .drop:hover,.drop.over{background:#f0ead8;border-color:#A6873A;}
      .drop-icon{font-size:40px;margin-bottom:10px;}
      .drop-text{font-size:14px;color:#666;}
      .drop-hint{font-size:11px;color:#aaa;margin-top:6px;}
      input[type=file]{display:none;}
      .prev{display:none;margin-bottom:16px;text-align:center;}
      .prev img{max-width:100%;max-height:280px;border-radius:8px;border:1px solid #EAE7D8;}
      .prev-name{font-size:12px;color:#666;margin-top:8px;}
      .btn{width:100%;padding:14px;background:#1A1A18;color:#C8A96E;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;letter-spacing:.04em;}
      .btn:hover{background:#C8A96E;color:#1A1A18;}
      .btn:disabled{opacity:.5;cursor:not-allowed;background:#999;color:#fff;}
      .prog{display:none;margin-top:16px;background:#EAE7D8;border-radius:4px;height:8px;overflow:hidden;}
      .prog-bar{height:100%;background:#C8A96E;width:0%;transition:width .3s;}
      .msg{display:none;margin-top:16px;padding:12px 16px;border-radius:8px;font-size:13px;font-weight:600;text-align:center;}
      .msg.ok{background:rgba(61,122,90,.1);color:#27500A;border:1px solid rgba(61,122,90,.3);}
      .msg.err{background:rgba(201,64,64,.1);color:#C94040;border:1px solid rgba(201,64,64,.3);}
    </style>
    </head><body>
    <div class="card">
      <div class="logo">FOLDIFYCASE</div>
      <div class="sub">Supplier Portal</div>
      <h2>Upload Restock List</h2>
      <div class="badge">Purchase Order: ${orderId}</div>
      <div class="hint">Please take a photo or upload an image of your restock list / confirmation document for this order. This will be sent directly to the FoldifyCase team.</div>
      <div class="drop" id="drop" onclick="document.getElementById('fi').click()">
        <div class="drop-icon">&#128247;</div>
        <div class="drop-text">Click or drag &amp; drop photo here</div>
        <div class="drop-hint">JPG, PNG, PDF up to 10MB &bull; Phone camera works too</div>
      </div>
      <input type="file" id="fi" accept="image/*,application/pdf" capture="environment">
      <div class="prev" id="prev">
        <img id="prevImg" src="" alt="">
        <div class="prev-name" id="prevName"></div>
      </div>
      <button class="btn" id="btn" disabled onclick="doUpload()">&#128196; Upload Restock List</button>
      <div class="prog" id="prog"><div class="prog-bar" id="progBar"></div></div>
      <div class="msg" id="msg"></div>
    </div>
    <script>
    var file = null;
    var orderId = ${JSON.stringify(orderId || '')};
    var drop = document.getElementById('drop');
    var fi = document.getElementById('fi');

    drop.addEventListener('dragover', function(e){ e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function(){ drop.classList.remove('over'); });
    drop.addEventListener('drop', function(e){ e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer.files[0]); });
    fi.addEventListener('change', function(){ setFile(this.files[0]); });

    function setFile(f) {
      if (!f) return;
      var isImg = f.type.startsWith('image/');
      var isPdf = f.type === 'application/pdf';
      if (!isImg && !isPdf) { showMsg('Please select an image or PDF file', 'err'); return; }
      if (f.size > 20 * 1024 * 1024) { showMsg('File too large. Max 20MB.', 'err'); return; }
      if (isImg) {
        var reader = new FileReader();
        reader.onload = function(e) {
          var img = new Image();
          img.onload = function() {
            var canvas = document.createElement('canvas');
            var MAX = 1800;
            var w = img.width, h = img.height;
            if (w > MAX || h > MAX) {
              if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
              else { w = Math.round(w * MAX / h); h = MAX; }
            }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            canvas.toBlob(function(blob) {
              file = new File([blob], f.name.replace(/\\.[^.]+$/, '.jpg'), {type:'image/jpeg'});
              document.getElementById('prevImg').src = e.target.result;
              document.getElementById('prev').style.display = 'block';
              document.getElementById('prevName').textContent = f.name + ' — ' + (file.size/1024).toFixed(0) + ' KB';
              document.getElementById('btn').disabled = false;
              drop.style.display = 'none';
            }, 'image/jpeg', 0.85);
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(f);
      } else {
        file = f;
        document.getElementById('prev').style.display = 'block';
        document.getElementById('prevImg').style.display = 'none';
        document.getElementById('prevName').textContent = '📄 ' + f.name + ' — ' + (f.size/1024).toFixed(0) + ' KB';
        document.getElementById('btn').disabled = false;
        drop.style.display = 'none';
      }
    }

    function doUpload() {
      if (!file) return;
      document.getElementById('btn').disabled = true;
      document.getElementById('prog').style.display = 'block';
      var pb = document.getElementById('progBar');
      pb.style.width = '20%';
      var fd = new FormData();
      fd.append('image', file);
      fd.append('orderId', orderId);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload-restock?orderId=' + encodeURIComponent(orderId));
      xhr.upload.onprogress = function(e){ if(e.lengthComputable) pb.style.width = Math.round(e.loaded/e.total*85)+'%'; };
      xhr.onload = function(){
        pb.style.width = '100%';
        try {
          var resp = JSON.parse(xhr.responseText);
          if (resp.success) {
            showMsg('✓ Restock list uploaded! Thank you — FoldifyCase team has been notified.', 'ok');
            document.getElementById('btn').style.display = 'none';
          } else {
            showMsg('Upload failed: ' + (resp.error || 'Server error'), 'err');
            document.getElementById('btn').disabled = false;
          }
        } catch(e) {
          showMsg('Upload error: ' + xhr.status, 'err');
          document.getElementById('btn').disabled = false;
        }
      };
      xhr.onerror = function(){ showMsg('Network error — please try again', 'err'); document.getElementById('btn').disabled = false; };
      xhr.send(fd);
    }

    function showMsg(t, type) {
      var m = document.getElementById('msg');
      m.textContent = t; m.className = 'msg ' + type; m.style.display = 'block';
    }
    </script>
    </body></html>`);
  }

  // ── POST: Handle upload ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const BLOB_TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN || '';
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on('data', c => chunks.push(c));
      req.on('end', resolve);
      req.on('error', reject);
    });
    const rawBody = Buffer.concat(chunks);
    console.log('[upload-restock] POST body size:', rawBody.length, 'has token:', !!BLOB_TOKEN);

    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=([^\s;]+)/);
    if (!bm) return res.status(400).json({ success: false, error: 'No boundary' });

    const parts = parseMultipart(rawBody, bm[1]);
    const imgPart = parts.find(p => p.name === 'image' && p.filename);
    if (!imgPart) return res.status(400).json({ success: false, error: 'No file found' });

    const ext = (imgPart.filename.split('.').pop() || 'jpg').toLowerCase();
    const cleanId = (orderId || 'unknown').replace(/[^a-z0-9\-]/gi, '_');
    const now = new Date();
    const stamp = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
    const blobPath = 'Supplier Restock Lists/' + cleanId + '_' + stamp + '.' + ext;
    console.log('[upload-restock] saving to:', blobPath);

    if (!BLOB_TOKEN) return res.status(200).json({ success: false, error: 'Storage not configured' });

    const result = await uploadBlob(blobPath, imgPart.contentType, imgPart.data, BLOB_TOKEN);
    console.log('[upload-restock] blob result:', result.status);

    if (result.status === 200 || result.status === 201) {
      const url = (result.body && (result.body.url || result.body.downloadUrl)) || '';
      // Save URL back into PO orders data
      if (url && orderId) await saveRestockUrl(orderId, url, BLOB_TOKEN);
      return res.status(200).json({ success: true, url, path: blobPath });
    } else {
      const errMsg = (result.body && result.body.error) || result.raw || ('HTTP ' + result.status);
      return res.status(200).json({ success: false, error: errMsg });
    }
  }

  return res.status(405).end();
};

handler.config = { api: { bodyParser: false, sizeLimit: '20mb' } };
module.exports = handler;
