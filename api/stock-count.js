import { put, list, del } from '@vercel/blob';

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || process.env.PUBLIC_BLOB_READ_WRITE_TOKEN;
const BLOB_PREFIX = 'Stock Counts/';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, action } = req.query;

  // ── SAVE new stock count session (called from app before email) ──────────
  if (action === 'save' && req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const sessionId = body.sessionId;
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      const key = `${BLOB_PREFIX}${sessionId}.json`;
      await put(key, JSON.stringify(body), {
        access: 'public',
        token: BLOB_TOKEN,
        allowOverwrite: false,
        addRandomSuffix: false
      });
      return res.status(200).json({ success: true, sessionId });
    } catch (e) {
      console.error('[stock-count save]', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── SUBMIT count results (called from the browser page) ─────────────────
  if (action === 'submit' && req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const sessionId = body.sessionId;
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      const key = `${BLOB_PREFIX}${sessionId}.json`;

      // Load existing session
      let session = null;
      try {
        const listRes = await list({ prefix: key, token: BLOB_TOKEN });
        if (listRes.blobs && listRes.blobs.length > 0) {
          const r = await fetch(listRes.blobs[0].url);
          session = await r.json();
        }
      } catch (e) {}

      if (!session) return res.status(404).json({ error: 'Session not found' });

      // Merge submitted counts into session
      session.counts = body.counts; // { variantId: countedQty, ... }
      session.submittedAt = new Date().toISOString();
      session.submittedBy = body.submittedBy || 'Warehouse Team';
      session.status = 'submitted';

      await put(key, JSON.stringify(session), {
        access: 'public',
        token: BLOB_TOKEN,
        allowOverwrite: true,
        addRandomSuffix: false
      });

      return res.status(200).json({ success: true });
    } catch (e) {
      console.error('[stock-count submit]', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE a stock count session ─────────────────────────────────────────
  if (action === 'delete' && req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const sessionId = body.sessionId;
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      if (!BLOB_TOKEN) return res.status(500).json({ error: 'BLOB_TOKEN not set' });

      const key = `${BLOB_PREFIX}${sessionId}.json`;
      console.log('[stock-count delete] looking for key:', key);

      const listRes = await list({ prefix: key, token: BLOB_TOKEN });
      console.log('[stock-count delete] blobs found:', listRes.blobs?.length ?? 0);

      if (!listRes.blobs || listRes.blobs.length === 0) {
        // Nothing in blob — still return success (already gone)
        console.log('[stock-count delete] blob not found, treating as already deleted');
        return res.status(200).json({ success: true, note: 'blob not found' });
      }

      // Delete all matching blobs (should only be one)
      for (const blob of listRes.blobs) {
        console.log('[stock-count delete] deleting:', blob.url);
        await del(blob.url, { token: BLOB_TOKEN });
      }

      console.log('[stock-count delete] done');
      return res.status(200).json({ success: true, deleted: listRes.blobs.length });
    } catch (e) {
      console.error('[stock-count delete] ERROR:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── FIND restock list image for a PO order ──────────────────────────────
  if (action === 'find-restock' && req.method === 'GET') {
    try {
      const orderId = req.query.orderId;
      if (!orderId) return res.status(400).json({ error: 'orderId required' });
      if (!BLOB_TOKEN) return res.status(500).json({ error: 'BLOB_TOKEN not set' });

      // Try two prefixes — with and without URL encoding of spaces
      const prefix1 = 'Supplier Restock Lists/' + orderId;
      const prefix2 = 'Supplier_Restock_Lists/' + orderId;
      console.log('[find-restock] searching for orderId:', orderId);

      let allBlobs = [];
      for (const prefix of [prefix1, prefix2]) {
        let cursor;
        do {
          const listRes = await list({ prefix, token: BLOB_TOKEN, cursor });
          allBlobs = allBlobs.concat(listRes.blobs || []);
          cursor = listRes.cursor;
        } while (cursor);
        if (allBlobs.length > 0) break;
      }

      // Also try listing the whole folder and filtering manually
      if (allBlobs.length === 0) {
        console.log('[find-restock] prefix search empty, trying full folder list');
        let cursor;
        do {
          const listRes = await list({ prefix: 'Supplier Restock Lists/', token: BLOB_TOKEN, cursor });
          const matched = (listRes.blobs || []).filter(b =>
            b.pathname && b.pathname.includes(orderId)
          );
          allBlobs = allBlobs.concat(matched);
          cursor = listRes.cursor;
        } while (cursor);
      }

      console.log('[find-restock] blobs found:', allBlobs.length, allBlobs.map(b => b.pathname));

      if (allBlobs.length > 0) {
        allBlobs.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
        const blob = allBlobs[0];
        return res.status(200).json({
          url: blob.url,
          uploadedAt: blob.uploadedAt,
          pathname: blob.pathname
        });
      }
      return res.status(200).json({ url: null });
    } catch (e) {
      console.error('[find-restock] ERROR:', e.message, e.stack);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── LOAD all sessions (called from app to show results) ─────────────────
  if (action === 'list' && req.method === 'GET') {
    try {
      // Paginate through all blobs
      let allBlobs = [];
      let cursor;
      do {
        const listRes = await list({ prefix: BLOB_PREFIX, token: BLOB_TOKEN, cursor });
        allBlobs = allBlobs.concat(listRes.blobs || []);
        cursor = listRes.cursor;
      } while (cursor);
      const sessions = [];
      for (const blob of allBlobs) {
        try {
          const r = await fetch(blob.url);
          const data = await r.json();
          sessions.push(data);
        } catch (e) {}
      }
      sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.status(200).json({ sessions });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── SERVE the interactive stock count page ───────────────────────────────
  if (!id) return res.status(400).send('<h2>Missing session ID</h2>');

  // Load session from Blob
  let session = null;
  try {
    const key = `${BLOB_PREFIX}${id}.json`;
    const listRes = await list({ prefix: key, token: BLOB_TOKEN });
    if (listRes.blobs && listRes.blobs.length > 0) {
      const r = await fetch(listRes.blobs[0].url);
      session = await r.json();
    }
  } catch (e) {
    console.error('[stock-count load]', e);
  }

  if (!session) {
    return res.status(404).send(`
      <html><body style="font-family:Arial;padding:40px;text-align:center;background:#F0EDE8;">
        <h2 style="color:#C94040;">Stock count sheet not found</h2>
        <p style="color:#888;">This link may have expired or the session ID is invalid.</p>
      </body></html>`);
  }

  const already = session.status === 'submitted';
  const products = session.products || [];
  const opts = session.opts || {};
  const whLabel = session.whLabel || 'Warehouse';
  const createdAt = new Date(session.createdAt).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Build rows
  let rows = '';
  let rowNum = 0;
  products.forEach(p => {
    const variants = p.variantData && p.variantData.length > 1 ? p.variantData : null;
    if (variants) {
      variants.forEach((v, vi) => {
        rowNum++;
        const isFirst = vi === 0;
        const bg = rowNum % 2 === 0 ? '#FAFAF7' : '#fff';
        const sc = v.status === 'critical' ? '#C94040' : v.status === 'low' ? '#B87D2A' : '#3D7A5A';
        const sl = v.status === 'critical' ? 'Critical' : v.status === 'low' ? 'Low' : 'OK';
        const submittedCount = already && session.counts ? (session.counts[v.id] !== undefined ? session.counts[v.id] : '') : '';
        const diff = already && submittedCount !== '' ? (parseInt(submittedCount) - v.qty) : null;
        const diffStyle = diff === null ? '' : diff < 0 ? 'color:#C94040;font-weight:700;' : diff > 0 ? 'color:#2D5FA6;font-weight:700;' : 'color:#3D7A5A;font-weight:700;';
        const diffText = diff === null ? '' : diff === 0 ? '✓' : (diff > 0 ? '+' : '') + diff;

        rows += `<tr style="background:${bg}">
          ${opts.image ? `<td style="padding:10px 12px;vertical-align:middle;width:56px;border-bottom:1px solid #EDEAE0;">${isFirst && p.image ? `<img src="${p.image}" width="40" height="40" style="border-radius:5px;object-fit:cover;border:1px solid #E0DDD4;display:block;">` : (isFirst ? '<div style="width:40px;height:40px;border-radius:5px;background:#F0EDE8;"></div>' : '')}</td>` : ''}
          <td style="padding:10px 12px;vertical-align:middle;border-bottom:1px solid #EDEAE0;">
            ${isFirst ? `<div style="font-size:12px;font-weight:700;color:#1A1A18;margin-bottom:2px;">${p.title}</div>` : ''}
            <div style="font-size:11px;color:rgba(26,26,24,.55);">${v.title}</div>
          </td>
          ${opts.qty ? `<td style="padding:10px 16px;text-align:center;vertical-align:middle;border-bottom:1px solid #EDEAE0;font-family:'Courier New',monospace;font-weight:700;font-size:13px;">${v.qty}</td>` : ''}
          ${opts.status ? `<td style="padding:10px 12px;text-align:center;vertical-align:middle;border-bottom:1px solid #EDEAE0;"><span style="background:${sc}18;color:${sc};font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;border:1px solid ${sc}33;">${sl}</span></td>` : ''}
          ${opts.cost ? `<td style="padding:10px 12px;text-align:center;vertical-align:middle;border-bottom:1px solid #EDEAE0;font-family:'Courier New',monospace;font-size:11px;color:rgba(26,26,24,.5);">${v.cost ? '$' + parseFloat(v.cost).toFixed(2) : '—'}</td>` : ''}
          <td style="padding:8px 12px;vertical-align:middle;border-bottom:1px solid #EDEAE0;">
            ${already
              ? `<span style="font-family:'Courier New',monospace;font-weight:700;font-size:14px;">${submittedCount !== '' ? submittedCount : '—'}</span>`
              : `<input type="number" min="0" class="count-input" data-id="${v.id}" placeholder="—"
                  style="width:72px;padding:6px 8px;border:2px solid #DDD;border-radius:6px;font-size:13px;font-family:'Courier New',monospace;font-weight:700;text-align:center;outline:none;transition:border-color .15s;"
                  onfocus="this.style.borderColor='#C8A96E'" onblur="this.style.borderColor='#DDD'">`}
          </td>
          ${already ? `<td style="padding:10px 12px;text-align:center;border-bottom:1px solid #EDEAE0;"><span style="${diffStyle}">${diffText}</span></td>` : ''}
        </tr>`;
      });
    } else {
      rowNum++;
      const v = p.variantData ? p.variantData[0] : { qty: p.qty, status: p.status, cost: null, id: p.id };
      const bg = rowNum % 2 === 0 ? '#FAFAF7' : '#fff';
      const sc = (v || p).status === 'critical' ? '#C94040' : (v || p).status === 'low' ? '#B87D2A' : '#3D7A5A';
      const sl = (v || p).status === 'critical' ? 'Critical' : (v || p).status === 'low' ? 'Low' : 'OK';
      const vid = v ? v.id : p.id;
      const submittedCount = already && session.counts ? (session.counts[vid] !== undefined ? session.counts[vid] : '') : '';
      const diff = already && submittedCount !== '' ? (parseInt(submittedCount) - (v ? v.qty : p.qty)) : null;
      const diffStyle = diff === null ? '' : diff < 0 ? 'color:#C94040;font-weight:700;' : diff > 0 ? 'color:#2D5FA6;font-weight:700;' : 'color:#3D7A5A;font-weight:700;';
      const diffText = diff === null ? '' : diff === 0 ? '✓' : (diff > 0 ? '+' : '') + diff;

      rows += `<tr style="background:${bg}">
        ${opts.image ? `<td style="padding:10px 12px;vertical-align:middle;width:56px;border-bottom:1px solid #EDEAE0;">${p.image ? `<img src="${p.image}" width="40" height="40" style="border-radius:5px;object-fit:cover;border:1px solid #E0DDD4;display:block;">` : '<div style="width:40px;height:40px;border-radius:5px;background:#F0EDE8;"></div>'}</td>` : ''}
        <td style="padding:10px 12px;vertical-align:middle;border-bottom:1px solid #EDEAE0;">
          <div style="font-size:12px;font-weight:700;color:#1A1A18;">${p.title}</div>
        </td>
        ${opts.qty ? `<td style="padding:10px 16px;text-align:center;vertical-align:middle;border-bottom:1px solid #EDEAE0;font-family:'Courier New',monospace;font-weight:700;font-size:13px;">${v ? v.qty : p.qty}</td>` : ''}
        ${opts.status ? `<td style="padding:10px 12px;text-align:center;vertical-align:middle;border-bottom:1px solid #EDEAE0;"><span style="background:${sc}18;color:${sc};font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;border:1px solid ${sc}33;">${sl}</span></td>` : ''}
        ${opts.cost ? `<td style="padding:10px 12px;text-align:center;vertical-align:middle;border-bottom:1px solid #EDEAE0;font-family:'Courier New',monospace;font-size:11px;color:rgba(26,26,24,.5);">${v && v.cost ? '$' + parseFloat(v.cost).toFixed(2) : '—'}</td>` : ''}
        <td style="padding:8px 12px;vertical-align:middle;border-bottom:1px solid #EDEAE0;">
          ${already
            ? `<span style="font-family:'Courier New',monospace;font-weight:700;font-size:14px;">${submittedCount !== '' ? submittedCount : '—'}</span>`
            : `<input type="number" min="0" class="count-input" data-id="${vid}" placeholder="—"
                style="width:72px;padding:6px 8px;border:2px solid #DDD;border-radius:6px;font-size:13px;font-family:'Courier New',monospace;font-weight:700;text-align:center;outline:none;transition:border-color .15s;"
                onfocus="this.style.borderColor='#C8A96E'" onblur="this.style.borderColor='#DDD'">`}
        </td>
        ${already ? `<td style="padding:10px 12px;text-align:center;border-bottom:1px solid #EDEAE0;"><span style="${diffStyle}">${diffText}</span></td>` : ''}
      </tr>`;
    }
  });

  const imgH = opts.image ? '<th style="padding:10px 12px;width:56px;"></th>' : '';
  const qtyH = opts.qty ? '<th style="padding:10px 16px;text-align:center;white-space:nowrap;">SYSTEM QTY</th>' : '';
  const statusH = opts.status ? '<th style="padding:10px 12px;text-align:center;">STATUS</th>' : '';
  const costH = opts.cost ? '<th style="padding:10px 12px;text-align:center;">COST/UNIT</th>' : '';
  const diffH = already ? '<th style="padding:10px 12px;text-align:center;">VARIANCE</th>' : '';

  const submitSection = already ? `
    <div style="text-align:center;padding:24px;background:#EAF3DE;border-top:2px solid #C5DFA8;">
      <div style="font-size:20px;margin-bottom:6px;">✅</div>
      <div style="font-size:14px;font-weight:700;color:#2A5C0A;margin-bottom:4px;">Stock count submitted</div>
      <div style="font-size:12px;color:#3D7A2A;">Submitted by ${session.submittedBy || 'Warehouse Team'} · ${session.submittedAt ? new Date(session.submittedAt).toLocaleString('en-AU') : ''}</div>
      <div style="font-size:11px;color:#3D7A2A;margin-top:8px;">Results are now visible in the FoldifyCase Warehouse App.</div>
    </div>` : `
    <div style="padding:20px 24px;background:#F5F3EE;border-top:1px solid #EDEAE0;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <input type="text" id="submitterName" placeholder="Your name (optional)"
          style="padding:8px 12px;border:1.5px solid #DDD;border-radius:7px;font-size:12px;font-family:Arial,sans-serif;flex:1;min-width:160px;outline:none;">
        <button onclick="submitCount()" id="submitBtn"
          style="padding:11px 28px;background:#1A1A18;color:#C8A96E;border:none;border-radius:7px;font-size:13px;font-weight:700;font-family:Arial,sans-serif;cursor:pointer;letter-spacing:.04em;white-space:nowrap;transition:all .18s;">
          ✓ &nbsp;Submit Count
        </button>
      </div>
      <div style="font-size:10px;color:rgba(26,26,24,.4);line-height:1.6;">
        Fill in the <strong>Count</strong> column for each item. Leave blank if not counted. Click <strong>Submit Count</strong> when done — results will appear in the app.
      </div>
      <div id="submitStatus" style="margin-top:8px;font-size:12px;"></div>
    </div>`;

  const baseUrl = process.env.APP_URL || 'https://foldify-case-warehouse-management-a.vercel.app';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Stock Count — ${whLabel} — ${createdAt}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: #F0EDE8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; }
    .count-input::-webkit-inner-spin-button { opacity: 1; }
    @media (max-width: 600px) {
      table { font-size: 11px; }
      .count-input { width: 56px !important; }
    }
  </style>
</head>
<body>
  <div style="max-width:780px;margin:0 auto;padding:16px;">

    <!-- Header -->
    <div style="background:#1A1A18;border-radius:10px 10px 0 0;padding:20px 24px;border-bottom:3px solid #C8A96E;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <div>
        <div style="color:#fff;font-size:18px;font-weight:800;letter-spacing:.08em;font-family:Arial,sans-serif;">FOLDIFYCASE</div>
        <div style="color:#C8A96E;font-size:9px;letter-spacing:.2em;text-transform:uppercase;margin-top:3px;">STOCK COUNT SHEET — ${whLabel.toUpperCase()}</div>
      </div>
      <div style="text-align:right;">
        <div style="color:rgba(255,255,255,.5);font-size:10px;">${createdAt}</div>
        <div style="color:rgba(255,255,255,.3);font-size:9px;margin-top:2px;">${products.length} products · ${rowNum} variants</div>
      </div>
    </div>

    ${already ? '' : `
    <!-- Instruction banner -->
    <div style="background:#FFF8E8;border:1px solid #EDD98A;border-top:none;padding:10px 16px;">
      <div style="font-size:11px;color:#7A5A00;line-height:1.6;">
        📋 <strong>How to use:</strong> Walk through the warehouse and physically count each item. Enter the actual quantity in the <strong>Count</strong> column. Leave blank if not counted. Submit when complete.
      </div>
    </div>`}

    <!-- Table -->
    <div style="background:#fff;overflow:hidden;border-radius:${already ? '0' : '0'} 0 10px 10px;">
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#EAE7D8;">
              ${imgH}
              <th style="padding:10px 12px;text-align:left;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#888;font-weight:600;">PRODUCT / VARIANT</th>
              ${qtyH}
              ${statusH}
              ${costH}
              <th style="padding:10px 12px;text-align:left;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#888;font-weight:600;">COUNT <span style="font-size:8px;color:#C8A96E;font-weight:500;">${already ? '(submitted)' : '(enter here)'}</span></th>
              ${diffH}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      ${submitSection}
    </div>

    <div style="padding:12px 0;font-size:10px;color:rgba(26,26,24,.35);text-align:center;">
      FoldifyCase Warehouse App · Stock Count · ${createdAt}
    </div>
  </div>

  ${!already ? `<script>
    async function submitCount(){
      const inputs = document.querySelectorAll('.count-input');
      const counts = {};
      inputs.forEach(inp => {
        if(inp.value.trim() !== '') counts[inp.dataset.id] = parseInt(inp.value);
      });
      const submitterName = document.getElementById('submitterName').value.trim() || 'Warehouse Team';
      const btn = document.getElementById('submitBtn');
      const status = document.getElementById('submitStatus');
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      status.innerHTML = '<span style="color:#888;">Saving your count…</span>';
      try {
        const r = await fetch('/api/stock-count?action=submit', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ sessionId: '${session.sessionId}', counts, submittedBy: submitterName })
        });
        const d = await r.json();
        if(r.ok && d.success){
          status.innerHTML = '<span style="color:#2A5C0A;font-weight:600;">✅ Count submitted successfully! Results are now visible in the app.</span>';
          btn.textContent = '✓ Submitted';
          btn.style.background = '#3D7A5A';
          btn.style.color = '#fff';
          // Disable all inputs
          document.querySelectorAll('.count-input').forEach(i => { i.disabled = true; i.style.background = '#F5F3EE'; });
          setTimeout(() => location.reload(), 1800);
        } else {
          throw new Error(d.error || 'Submit failed');
        }
      } catch(e){
        status.innerHTML = '<span style="color:#C94040;">✗ Failed: ' + e.message + '</span>';
        btn.disabled = false;
        btn.textContent = '✓ Submit Count';
      }
    }
  </script>` : ''}
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
