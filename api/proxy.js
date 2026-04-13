const { put, list, head } = require('@vercel/blob');

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_TOKEN;
const RESEND_KEY = process.env.RESEND_API_KEY;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const API_VERSION = '2024-01';
const PO_BLOB_KEY = 'History Of Restock/po_orders.json';

const shopifyHeaders = {
  'X-Shopify-Access-Token': TOKEN,
  'Content-Type': 'application/json',
};

const ALLOWED_ORIGINS = [
  process.env.APP_URL,
  'http://localhost:3000',
].filter(Boolean);

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { service, action } = req.query;

  try {

    // ── SHOPIFY ──────────────────────────────────────────────────────────────
    if (service === 'shopify') {

      if (action === 'products') {
        const limit = req.query.limit || 250;
        const url = `https://${STORE}/admin/api/${API_VERSION}/products.json?limit=${limit}&fields=id,title,handle,tags,variants,images,image`;
        const r = await fetch(url, { headers: shopifyHeaders });
        const d = await r.json();
        return res.status(200).json(d);
      }

      if (action === 'orders') {
        const days = parseInt(req.query.days) || 90;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const limit = req.query.limit || 250;
        const url = `https://${STORE}/admin/api/${API_VERSION}/orders.json?status=any&created_at_min=${since}&limit=${limit}&fields=id,created_at,line_items`;
        const r = await fetch(url, { headers: shopifyHeaders });
        const d = await r.json();
        return res.status(200).json(d);
      }

      if (action === 'locations') {
        const url = `https://${STORE}/admin/api/${API_VERSION}/locations.json`;
        const r = await fetch(url, { headers: shopifyHeaders });
        const d = await r.json();
        return res.status(200).json(d);
      }

      if (action === 'inventory_levels') {
        // Fetch inventory levels for given location IDs
        // Returns all variant inventory across those locations
        const locationIds = req.query.location_ids || '';
        if (!locationIds) return res.status(400).json({ error: 'location_ids required' });

        // Shopify limits to 250 per page — paginate if needed
        let allLevels = [];
        let pageUrl = `https://${STORE}/admin/api/${API_VERSION}/inventory_levels.json?location_ids=${locationIds}&limit=250`;

        // Fetch up to 10 pages (2500 inventory records)
        for (let page = 0; page < 10; page++) {
          const r = await fetch(pageUrl, { headers: shopifyHeaders });
          const d = await r.json();
          const levels = d.inventory_levels || [];
          allLevels = allLevels.concat(levels);

          // Check for next page via Link header
          const linkHeader = r.headers.get('link') || '';
          const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          if (!nextMatch || levels.length < 250) break;
          pageUrl = nextMatch[1];
        }

        return res.status(200).json({ inventory_levels: allLevels });
      }

      // Set inventory quantity at a specific location
      if (action === 'set_inventory') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { inventory_item_id, location_id, available } = body;
        if (!inventory_item_id || !location_id || available === undefined) {
          return res.status(400).json({ error: 'inventory_item_id, location_id, available required' });
        }
        const r = await fetch(`https://${STORE}/admin/api/${API_VERSION}/inventory_levels/set.json`, {
          method: 'POST',
          headers: shopifyHeaders,
          body: JSON.stringify({ inventory_item_id, location_id, available: parseInt(available) })
        });
        const d = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: d.errors || 'Shopify error', detail: d });
        return res.status(200).json({ success: true, inventory_level: d.inventory_level });
      }

      // Get inventory item ID for a variant (needed to set inventory)
      if (action === 'inventory_item') {
        const variantId = req.query.variant_id;
        if (!variantId) return res.status(400).json({ error: 'variant_id required' });
        const r = await fetch(`https://${STORE}/admin/api/${API_VERSION}/variants/${variantId}.json?fields=id,inventory_item_id`, { headers: shopifyHeaders });
        const d = await r.json();
        return res.status(200).json(d);
      }

      // ── SET COST (unit cost on inventory item) ────────────────────────────
      if (action === 'set_cost') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { inventory_item_id, cost } = body;
        if (!inventory_item_id || cost === undefined) {
          return res.status(400).json({ error: 'inventory_item_id and cost required' });
        }
        const r = await fetch(
          `https://${STORE}/admin/api/${API_VERSION}/inventory_items/${inventory_item_id}.json`,
          {
            method: 'PUT',
            headers: { ...shopifyHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inventory_item: { id: inventory_item_id, cost: parseFloat(cost).toFixed(2) } })
          }
        );
        const d = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: d.errors || 'Shopify error' });
        return res.status(200).json({ success: true, cost: d.inventory_item?.cost });
      }

      // ── GET COSTS BATCH (fetch costs for multiple inventory items) ──────────
      if (action === 'inventory_items_cost') {
        const ids = req.query.ids;
        if (!ids) return res.status(400).json({ error: 'ids required' });
        const r = await fetch(
          `https://${STORE}/admin/api/${API_VERSION}/inventory_items.json?ids=${ids}&fields=id,cost`,
          { headers: shopifyHeaders }
        );
        const d = await r.json();
        return res.status(200).json({ inventory_items: d.inventory_items || [] });
      }

      // ── GET COST (fetch cost for an inventory item) ───────────────────────
      if (action === 'get_cost') {
        const iid = req.query.inventory_item_id;
        if (!iid) return res.status(400).json({ error: 'inventory_item_id required' });
        const r = await fetch(
          `https://${STORE}/admin/api/${API_VERSION}/inventory_items/${iid}.json?fields=id,cost`,
          { headers: shopifyHeaders }
        );
        const d = await r.json();
        return res.status(200).json({ cost: d.inventory_item?.cost || null });
      }

      return res.status(400).json({ error: `Unknown shopify action: ${action}` });
    }

    // ── EMAIL via Resend ─────────────────────────────────────────────────────
    if (service === 'alert') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'POST required' });
      }

      // Parse body — handle both string and object, and large payloads
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {
          return res.status(400).json({ error: 'Invalid JSON body' });
        }
      }
      if (!body) {
        return res.status(400).json({ error: 'Empty request body' });
      }

      const { to, from_name, from_email, subject, type, warehouse, products } = body;

      if (!to || !to.length) {
        return res.status(400).json({ error: 'No recipients provided' });
      }
      if (!RESEND_KEY) {
        return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
      }

      // Use custom_html if provided (supplier PO emails), otherwise build stock alert html
      const html = body.custom_html
        ? body.custom_html
        : buildEmailHTML({ type, warehouse, products, from_name });

      const fromAddress = `${from_name || 'FoldifyCase Warehouse'} <${from_email || 'warehouse@foldifycase.com.au'}>`;
      const emailSubject = subject || `FoldifyCase Stock Alert — ${warehouse}`;

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: Array.isArray(to) ? to : [to],
          subject: emailSubject,
          html,
        }),
      });

      const result = await resendRes.json();

      if (!resendRes.ok) {
        console.error('Resend error:', result);
        return res.status(resendRes.status).json({
          error: result.message || result.name || 'Resend rejected the request',
          detail: result,
        });
      }

      return res.status(200).json({ success: true, id: result.id });
    }

    // ── BLOB: save/load PO order history via @vercel/blob SDK ───────────────
    if (service === 'blob') {

      if (action === 'save_po') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { orders } = body;
        if (!Array.isArray(orders)) return res.status(400).json({ error: 'orders array required' });
        if (!BLOB_TOKEN) return res.status(500).json({ error: 'BLOB_TOKEN not configured' });

        try {
          // Use SDK put() with addRandomSuffix:false and allowOverwrite:true
          // This guarantees a stable, predictable filename every time
          const blob = await put(PO_BLOB_KEY, JSON.stringify(orders), {
            access: 'public',
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: 'application/json',
            token: BLOB_TOKEN,
          });
          console.log('[save_po] Saved to:', blob.url);
          return res.status(200).json({ success: true, url: blob.url });
        } catch(e) {
          console.error('[save_po] Error:', e.message);
          return res.status(500).json({ error: e.message });
        }
      }

      if (action === 'load_po') {
        if (!BLOB_TOKEN) return res.status(500).json({ error: 'BLOB_TOKEN not configured' });

        try {
          // Use SDK head() to check if file exists and get its URL
          const blob = await head(PO_BLOB_KEY, { token: BLOB_TOKEN });
          console.log('[load_po] Found file:', blob.url);

          // Fetch its content directly using the stable URL
          const r = await fetch(blob.url + '?t=' + Date.now());
          if (!r.ok) throw new Error('fetch failed: ' + r.status);

          const orders = await r.json();
          console.log('[load_po] Loaded', orders.length, 'orders');
          return res.status(200).json({ orders: Array.isArray(orders) ? orders : [] });

        } catch(e) {
          // head() throws if file not found — that means no orders yet
          if (e.message && (e.message.includes('not found') || e.message.includes('404') || e.message.includes('BlobNotFoundError'))) {
            console.log('[load_po] No orders file yet');
            return res.status(200).json({ orders: [] });
          }
          console.error('[load_po] Error:', e.message);
          return res.status(200).json({ orders: [], error: e.message });
        }
      }

      // Save a standalone HTML file to Blob (for printable order pages)
      if (action === 'list_restock') {
        // List all blobs and find one matching orderId
        if (!BLOB_TOKEN) return res.status(500).json({ error: 'BLOB_TOKEN not configured' });
        const orderId = req.query.orderId || (req.body && req.body.orderId) || '';
        if (!orderId) return res.status(400).json({ error: 'orderId required' });
        try {
          // List everything — no prefix filter so we find regardless of folder name
          let allBlobs = [];
          let cursor;
          let pages = 0;
          do {
            const result = await list({ token: BLOB_TOKEN, cursor, limit: 1000 });
            allBlobs = allBlobs.concat(result.blobs || []);
            cursor = result.cursor;
            pages++;
            console.log('[list_restock] page', pages, 'total so far:', allBlobs.length);
            if (pages > 10) break;
          } while (cursor);

          console.log('[list_restock] all pathnames:', allBlobs.map(b => b.pathname));

          // Filter by orderId (case-insensitive)
          const matched = allBlobs.filter(b =>
            b.pathname && b.pathname.toLowerCase().includes(orderId.toLowerCase())
          );
          console.log('[list_restock] matched for', orderId, ':', matched.map(b => b.pathname));

          if (matched.length > 0) {
            matched.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
            const blob = matched[0];
            return res.status(200).json({ url: blob.url, uploadedAt: blob.uploadedAt, pathname: blob.pathname });
          }

          // Also try with public token if private found nothing
          const PUBLIC_TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN;
          if (PUBLIC_TOKEN && PUBLIC_TOKEN !== BLOB_TOKEN) {
            let pubBlobs = [];
            let pubCursor;
            do {
              const r = await list({ token: PUBLIC_TOKEN, cursor: pubCursor, limit: 1000 });
              pubBlobs = pubBlobs.concat(r.blobs || []);
              pubCursor = r.cursor;
            } while (pubCursor);
            console.log('[list_restock] public store blobs:', pubBlobs.length);
            const pubMatched = pubBlobs.filter(b =>
              b.pathname && b.pathname.toLowerCase().includes(orderId.toLowerCase())
            );
            if (pubMatched.length > 0) {
              pubMatched.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
              const blob = pubMatched[0];
              return res.status(200).json({ url: blob.url, uploadedAt: blob.uploadedAt, pathname: blob.pathname, store: 'public' });
            }
          }

          return res.status(200).json({
            url: null,
            debug: { total: allBlobs.length, pathnames: allBlobs.map(b => b.pathname) }
          });
        } catch(e) {
          console.error('[list_restock] error:', e.message);
          return res.status(500).json({ error: e.message });
        }
      }

      if (action === 'find_packing') {
        // Find packing image for a fulfillment order by orderName
        if (!BLOB_TOKEN) return res.status(500).json({ error: 'BLOB_TOKEN not configured' });
        const orderName = req.query.orderName || '';
        if (!orderName) return res.status(400).json({ error: 'orderName required' });

        // Clean the orderName the same way upload-image.js does
        const nameClean = orderName.replace(/[^a-z0-9]/gi, '_').replace(/^_+|_+$/g, '');
        console.log('[find_packing] searching for orderName:', orderName, '→ nameClean:', nameClean);

        try {
          // List ALL blobs and filter — same approach that works for restock list
          let allBlobs = [];
          let cursor;
          let pages = 0;
          do {
            const result = await list({ token: BLOB_TOKEN, cursor, limit: 1000 });
            allBlobs = allBlobs.concat(result.blobs || []);
            cursor = result.cursor;
            pages++;
            if (pages > 10) break;
          } while (cursor);

          console.log('[find_packing] total blobs:', allBlobs.length);
          console.log('[find_packing] all pathnames:', allBlobs.map(b => b.pathname));

          // Match against Packing_Images/Order_XXXX_* — try exact nameClean first
          // upload-image.js stores as: Packing_Images/Order_{nameClean}_{DD}_{MM}_{YYYY}.{ext}
          const matched = allBlobs.filter(b => {
            if (!b.pathname) return false;
            const p = b.pathname.toLowerCase();
            // Match by nameClean OR original orderName (both numeric/alphanumeric)
            return (
              p.includes('packing') &&
              (p.includes(nameClean.toLowerCase()) || p.includes(orderName.toLowerCase().replace(/[^a-z0-9]/gi, '_')))
            );
          });

          console.log('[find_packing] matched:', matched.map(b => b.pathname));

          if (matched.length > 0) {
            matched.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
            const blob = matched[0];
            return res.status(200).json({ url: blob.url, uploadedAt: blob.uploadedAt, pathname: blob.pathname });
          }

          // Also try public token if private returned nothing
          const PUBLIC_TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN;
          if (PUBLIC_TOKEN && PUBLIC_TOKEN !== BLOB_TOKEN) {
            let pubBlobs = [];
            let pubCursor;
            do {
              const r = await list({ token: PUBLIC_TOKEN, cursor: pubCursor, limit: 1000 });
              pubBlobs = pubBlobs.concat(r.blobs || []);
              pubCursor = r.cursor;
            } while (pubCursor);
            const pubMatched = pubBlobs.filter(b =>
              b.pathname && b.pathname.toLowerCase().includes('packing') &&
              b.pathname.toLowerCase().includes(nameClean.toLowerCase())
            );
            if (pubMatched.length > 0) {
              pubMatched.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
              const blob = pubMatched[0];
              return res.status(200).json({ url: blob.url, uploadedAt: blob.uploadedAt, pathname: blob.pathname, store: 'public' });
            }
          }

          return res.status(200).json({ url: null, debug: { total: allBlobs.length } });
        } catch(e) {
          console.error('[find_packing] error:', e.message);
          return res.status(500).json({ error: e.message });
        }
      }

      if (action === 'save_html') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { filename, content } = body;
        if (!filename || !content) return res.status(400).json({ error: 'filename and content required' });
        if (!BLOB_TOKEN) return res.status(500).json({ error: 'BLOB_TOKEN not configured' });

        try {
          const blob = await put(`Restock Order Lists/${filename}`, content, {
            access: 'public',
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: 'text/html;charset=utf-8',
            token: BLOB_TOKEN,
          });
          console.log('[save_html] Saved:', blob.url);
          return res.status(200).json({ success: true, url: blob.url });
        } catch(e) {
          console.error('[save_html] Error:', e.message);
          return res.status(500).json({ error: e.message });
        }
      }

      return res.status(400).json({ error: `Unknown blob action: ${action}` });
    }

    return res.status(400).json({ error: `Unknown service: ${service}` });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Stock alert email builder ─────────────────────────────────────────────────
function buildEmailHTML({ type, warehouse, products, from_name }) {
  const critical = (products || []).filter(p => p.status === 'critical');
  const low = (products || []).filter(p => p.status === 'low');
  const now = new Date().toLocaleString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const productRow = (p, urgency) => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f0ede4;font-size:13px;color:#1a1a1a;max-width:280px">${p.title}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0ede4;font-size:13px;color:#1a1a1a;text-align:center;font-weight:600">${p.qty}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0ede4;text-align:center">
        <span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:11px;font-weight:600;background:${urgency === 'critical' ? '#FCEBEB' : '#FAEEDA'};color:${urgency === 'critical' ? '#791F1F' : '#633806'}">
          ${urgency === 'critical' ? 'Critical' : 'Low'}
        </span>
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0ede4;font-size:12px;color:#666;text-align:center">${Math.max(50 - (p.qty || 0), 10)} units</td>
    </tr>`;

  let tableBody = '';
  if (type === 'critical') {
    tableBody = critical.map(p => productRow(p, 'critical')).join('');
  } else if (type === 'low') {
    tableBody = [
      ...critical.map(p => productRow(p, 'critical')),
      ...low.map(p => productRow(p, 'low')),
    ].join('');
  } else {
    tableBody = (products || []).map(p => productRow(p, p.status)).join('');
  }

  if (!tableBody) {
    tableBody = `<tr><td colspan="4" style="padding:20px;text-align:center;color:#888;font-size:13px">No products match this alert type.</td></tr>`;
  }

  const alertCount = type === 'critical'
    ? critical.length
    : type === 'low'
    ? critical.length + low.length
    : (products || []).length;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3e9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:620px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e4d9">
    <div style="background:#111;padding:24px 32px">
      <div style="color:#fff;font-size:15px;font-weight:600">FoldifyCase Warehouse</div>
      <div style="color:#888;font-size:12px;margin-top:2px">Stock alert — ${warehouse || ''}</div>
    </div>
    <div style="background:${critical.length > 0 ? '#FAEEDA' : '#EAF3DE'};border-bottom:1px solid ${critical.length > 0 ? '#FAC775' : '#C0DD97'};padding:14px 32px;font-size:13px;color:${critical.length > 0 ? '#633806' : '#27500A'}">
      <strong>${alertCount} product${alertCount !== 1 ? 's' : ''}</strong> at ${warehouse || ''} require attention
    </div>
    <div style="padding:28px 32px">
      <table width="100%" style="border-collapse:collapse;border:1px solid #e8e4d9;border-radius:8px;overflow:hidden;margin-bottom:20px">
        <thead>
          <tr style="background:#F5F3E9">
            <th style="padding:10px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#888;text-align:left">Product</th>
            <th style="padding:10px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#888;text-align:center">Units</th>
            <th style="padding:10px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#888;text-align:center">Status</th>
            <th style="padding:10px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#888;text-align:center">Suggest order</th>
          </tr>
        </thead>
        <tbody>${tableBody}</tbody>
      </table>
      <p style="margin:0;font-size:12px;color:#aaa;text-align:center">
        Sent by FoldifyCase Warehouse Manager · ${from_name || 'FoldifyCase'}
      </p>
    </div>
  </div>
</body>
</html>`;
}

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};
