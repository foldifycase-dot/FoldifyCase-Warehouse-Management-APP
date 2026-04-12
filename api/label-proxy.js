const https = require('https');

const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || '';
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN || '';

function shopifyGraphQL(query, version) {
  version = version || '2024-01';
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: SHOPIFY_DOMAIN,
      path: '/admin/api/' + version + '/graphql.json',
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: null, raw: d.substring(0,300) }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function printPage(b64, mime) {
  return `<!DOCTYPE html><html>
  <head><title>Shipping Label</title>
  <style>
    body{margin:0;padding:20px;display:flex;flex-direction:column;align-items:center;background:#f5f5f5;font-family:Arial,sans-serif;}
    img{max-width:100%;background:#fff;border:1px solid #ddd;display:block;}
    .btn{margin-bottom:20px;padding:14px 32px;background:#1A1A18;color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:700;cursor:pointer;}
    .btn:hover{background:#C8A96E;color:#1A1A18;}
    @media print{.btn{display:none;}body{padding:0;background:#fff;}}
  </style>
  <script>window.onload=function(){window.print();}</script>
  </head><body>
  <button class="btn" onclick="window.print()">&#128424; Print Label</button>
  <img src="data:${mime};base64,${b64}" alt="Shipping Label">
  </body></html>`;
}

function htmlPage(title, body) {
  return `<!DOCTYPE html><html><head><title>${title}</title>
  <style>body{font-family:Arial,sans-serif;max-width:640px;margin:60px auto;text-align:center;color:#1A1A18;padding:20px;}
  .btn{display:inline-block;margin-top:20px;padding:12px 28px;background:#1A1A18;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;}
  .btn:hover{background:#C8A96E;color:#1A1A18;}</style>
  </head><body>${body}</body></html>`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { fulfillmentId, orderId } = req.query;
  const shopifyAdminUrl = `https://${SHOPIFY_DOMAIN}/admin/orders/${orderId || ''}`;

  try {
    // Use 2024-01 API - last version that supports ShippingLabel with body field
    const query = `{
      order(id: "gid://shopify/Order/${orderId}") {
        fulfillments {
          id
          shippingLabel {
            body
            contentType
          }
        }
      }
    }`;

    const result = await shopifyGraphQL(query, '2024-01');
    console.log('GraphQL 2024-01 status:', result.status);
    console.log('Response:', JSON.stringify(result.body).substring(0, 500));

    const orderData = result.body && result.body.data && result.body.data.order;
    if (orderData && orderData.fulfillments && orderData.fulfillments.length > 0) {
      // Find matching fulfillment or use first one
      const fu = orderData.fulfillments.find(f =>
        f.id === 'gid://shopify/Fulfillment/' + fulfillmentId
      ) || orderData.fulfillments[0];

      if (fu && fu.shippingLabel && fu.shippingLabel.body) {
        console.log('Got shippingLabel.body! contentType:', fu.shippingLabel.contentType);
        const ct = fu.shippingLabel.contentType || 'application/pdf';
        const labelBody = fu.shippingLabel.body;

        if (ct.includes('pdf')) {
          const buf = Buffer.from(labelBody, 'base64');
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'inline; filename="shipping-label.pdf"');
          res.setHeader('Cache-Control', 'no-cache');
          return res.status(200).end(buf);
        } else {
          // PNG or image
          res.setHeader('Content-Type', 'text/html');
          return res.status(200).send(printPage(labelBody, ct.includes('png') ? 'image/png' : ct));
        }
      }
    }

    // Check for GraphQL errors
    const errors = result.body && result.body.errors;
    if (errors) {
      console.log('GraphQL errors:', JSON.stringify(errors));
    }

    // Nothing found - show helpful fallback with Shopify admin link
    console.log('No shippingLabel.body found, showing fallback');
    return res.status(200).send(htmlPage('Print Shipping Label', `
      <div style="font-size:48px;margin-bottom:16px;">&#127991;</div>
      <h2>Print your shipping label</h2>
      <p>Click below to open this order in Shopify admin where the label is ready to print.<br>
      Sign in once and your browser will keep you logged in for future labels.</p>
      <a href="${shopifyAdminUrl}" target="_blank" class="btn">Open Order in Shopify Admin</a>
      <p style="font-size:11px;color:#aaa;margin-top:30px;">
        Order: ${orderId || 'unknown'} | Fulfillment: ${fulfillmentId || 'unknown'}
      </p>
    `));

  } catch(err) {
    console.error('Label proxy error:', err.message);
    res.status(500).send(htmlPage('Error', `<h2>Error loading label</h2><p>${err.message}</p>
      <a href="${shopifyAdminUrl}" target="_blank" class="btn">Open in Shopify Admin</a>`));
  }
};
