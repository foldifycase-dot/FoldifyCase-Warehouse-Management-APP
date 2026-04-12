const https = require('https');

const BLOB_TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN || '';
const VERCEL_URL = 'https://warehouse-stock-management-app.vercel.app';

function uploadBlob(pathname, contentType, data) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'blob.vercel-storage.com',
      path: '/' + pathname.split('/').map(encodeURIComponent).join('/'),
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + BLOB_TOKEN,
        'Content-Type': contentType,
        'Content-Length': data.length,
        'x-vercel-blob-access': 'public',
        'cache-control': 'public, max-age=86400'
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('Blob upload status:', res.statusCode, d.substring(0, 200));
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, raw: d }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

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

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { orderId, orderName } = req.query;
  const displayName = orderName || ('#' + orderId);

  // ── GET: Upload page ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    return res.status(200).send(`<!DOCTYPE html><html>
    <head><title>Upload Label - ${displayName}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:Arial,sans-serif;background:#F5F3E9;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;}
      .card{background:#fff;border-radius:14px;padding:32px;max-width:480px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.1);}
      .logo{font-size:22px;font-weight:800;color:#1A1A18;letter-spacing:.06em;margin-bottom:4px;}
      .sub{font-size:11px;color:#C8A96E;letter-spacing:.15em;text-transform:uppercase;margin-bottom:24px;}
      h2{font-size:17px;color:#1A1A18;margin-bottom:6px;}
      .badge{display:inline-block;background:#F5F3E9;border:1px solid #EAE7D8;border-radius:6px;padding:4px 12px;font-size:13px;font-weight:700;color:#A6873A;margin-bottom:24px;}
      .drop{border:2px dashed #C8A96E;border-radius:10px;padding:40px 20px;text-align:center;cursor:pointer;transition:all .2s;background:#fdfcf8;margin-bottom:16px;}
      .drop:hover,.drop.over{background:#f0ead8;border-color:#A6873A;}
      .drop-icon{font-size:40px;margin-bottom:10px;}
      .drop-text{font-size:14px;color:#666;}
      .drop-hint{font-size:11px;color:#aaa;margin-top:6px;}
      input[type=file]{display:none;}
      .prev{display:none;margin-bottom:16px;padding:14px;background:#F5F3E9;border-radius:8px;border:1px solid #EAE7D8;text-align:center;}
      .prev-icon{font-size:36px;margin-bottom:6px;}
      .prev-name{font-size:13px;color:#333;font-weight:600;}
      .prev-size{font-size:11px;color:#888;margin-top:3px;}
      .btn{width:100%;padding:14px;background:#1A1A18;color:#C8A96E;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;transition:background .2s;}
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
      <div class="sub">Warehouse Hub</div>
      <h2>Upload Shipping Label</h2>
      <div class="badge">${displayName}</div>
      <div class="drop" id="drop" onclick="document.getElementById('fi').click()">
        <div class="drop-icon">🏷️</div>
        <div class="drop-text">Click or drag & drop label PDF here</div>
        <div class="drop-hint">PDF file from Shopify shipping label</div>
      </div>
      <input type="file" id="fi" accept="application/pdf,.pdf">
      <div class="prev" id="prev">
        <div class="prev-icon">📄</div>
        <div class="prev-name" id="prevName"></div>
        <div class="prev-size" id="prevSize"></div>
      </div>
      <button class="btn" id="btn" disabled onclick="doUpload()">Upload Label PDF</button>
      <div class="prog" id="prog"><div class="prog-bar" id="progBar"></div></div>
      <div class="msg" id="msg"></div>
    </div>
    <script>
    var file = null;
    var orderId = ${JSON.stringify(orderId || '')};
    var orderName = ${JSON.stringify(orderName || '')};
    var drop = document.getElementById('drop');
    var fi = document.getElementById('fi');

    drop.addEventListener('dragover', function(e){ e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function(){ drop.classList.remove('over'); });
    drop.addEventListener('drop', function(e){
      e.preventDefault(); drop.classList.remove('over');
      setFile(e.dataTransfer.files[0]);
    });
    fi.addEventListener('change', function(){ setFile(this.files[0]); });

    function setFile(f) {
      if (!f) return;
      if (!f.name.toLowerCase().endsWith('.pdf') && f.type !== 'application/pdf') {
        showMsg('Please select a PDF file', 'err'); return;
      }
      if (f.size > 20 * 1024 * 1024) { showMsg('File too large. Max 20MB.', 'err'); return; }
      file = f;
      document.getElementById('prev').style.display = 'block';
      document.getElementById('prevName').textContent = f.name;
      document.getElementById('prevSize').textContent = (f.size / 1024).toFixed(0) + ' KB';
      document.getElementById('btn').disabled = false;
      drop.style.display = 'none';
    }

    function doUpload() {
      if (!file) return;
      document.getElementById('btn').disabled = true;
      document.getElementById('prog').style.display = 'block';
      var pb = document.getElementById('progBar');
      pb.style.width = '20%';

      var fd = new FormData();
      fd.append('label', file);
      fd.append('orderId', orderId);
      fd.append('orderName', orderName);

      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload-label?orderId=' + encodeURIComponent(orderId) + '&orderName=' + encodeURIComponent(orderName));
      xhr.upload.onprogress = function(e){ if(e.lengthComputable) pb.style.width = Math.round(e.loaded/e.total*85)+'%'; };
      xhr.onload = function(){
        pb.style.width = '100%';
        try {
          var resp = JSON.parse(xhr.responseText);
          if (resp.success) {
            showMsg('✓ Label uploaded! You can now Send Label from the Hub.', 'ok');
            document.getElementById('btn').style.display = 'none';
          } else {
            showMsg('Upload failed: ' + (typeof resp.error === 'string' ? resp.error : JSON.stringify(resp.error)), 'err');
            document.getElementById('btn').disabled = false;
          }
        } catch(e) {
          showMsg('Upload error: ' + xhr.status, 'err');
          document.getElementById('btn').disabled = false;
        }
      };
      xhr.onerror = function(){ showMsg('Network error - please try again', 'err'); document.getElementById('btn').disabled = false; };
      xhr.send(fd);
    }

    function showMsg(t, type) {
      var m = document.getElementById('msg');
      m.textContent = t; m.className = 'msg ' + type; m.style.display = 'block';
    }
    </script>
    </body></html>`);
  }

  // ── POST: Handle upload ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on('data', c => chunks.push(c));
      req.on('end', resolve);
      req.on('error', reject);
    });
    const rawBody = Buffer.concat(chunks);
    console.log('Label upload POST, size:', rawBody.length);

    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=([^\s;]+)/);
    if (!bm) return res.status(400).json({ success: false, error: 'No boundary' });

    const parts = parseMultipart(rawBody, bm[1]);
    const labelPart = parts.find(p => p.name === 'label' && p.filename);
    if (!labelPart) return res.status(400).json({ success: false, error: 'No PDF found' });

    console.log('Label file:', labelPart.filename, 'size:', labelPart.data.length);

    if (!BLOB_TOKEN) return res.status(200).json({ success: false, error: 'Storage not configured' });

    // Match existing naming: "Shipping Label/Order 2162.pdf"
    const nameClean = (orderName || orderId || 'unknown').replace(/[^a-z0-9 ]/gi, ' ').trim();
    const blobPath = 'Shipping Labels/Order ' + nameClean + '.pdf';
    console.log('Saving to blob:', blobPath);

    const result = await uploadBlob(blobPath, 'application/pdf', labelPart.data);

    if (result.status === 200 || result.status === 201) {
      return res.status(200).json({ success: true, path: blobPath });
    } else {
      const errMsg = (result.body && result.body.error) || result.raw || ('HTTP ' + result.status);
      return res.status(200).json({ success: false, error: errMsg });
    }
  }

  return res.status(405).end();
};

handler.config = { api: { bodyParser: false, sizeLimit: '20mb' } };
module.exports = handler;
