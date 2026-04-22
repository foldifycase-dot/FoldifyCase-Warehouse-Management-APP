const https = require('https');

const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || '';
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN || '';
const STORE_URL = 'https://www.foldifycase.com.au';

function shopifyGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SHOPIFY_DOMAIN,
      path,
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers }); }
        catch(e) { reject(new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getProductData(productId) {
  try {
    const [imgResult, prodResult] = await Promise.all([
      shopifyGet(`/admin/api/2024-01/products/${productId}/images.json?fields=id,src,variant_ids,position`),
      shopifyGet(`/admin/api/2024-01/products/${productId}.json?fields=id,handle,image,images,title`)
    ]);
    const prod = (prodResult.status === 200 && prodResult.data.product) ? prodResult.data.product : null;
    const handle = prod ? (prod.handle || '') : '';
    const productMainImage = prod && prod.image ? prod.image.src : null;
    if (imgResult.status !== 200 || !imgResult.data.images || imgResult.data.images.length === 0) {
      return { images: [], firstImage: productMainImage, handle };
    }
    const images = imgResult.data.images.sort((a, b) => a.position - b.position);
    const firstImage = images.length > 0 ? images[0].src : (productMainImage || null);
    return { images, firstImage, handle };
  } catch(e) {
    return { images: [], firstImage: null, handle: '' };
  }
}

// Fetch image from a single variant (fallback for archived/deleted products)
async function getVariantImage(variantId) {
  try {
    const result = await shopifyGet(`/admin/api/2024-01/variants/${variantId}.json?fields=id,image,product_id,title`);
    if (result.status === 200 && result.data.variant) {
      const v = result.data.variant;
      return {
        imageUrl: v.image ? v.image.src : null,
        productId: v.product_id
      };
    }
  } catch(e) {}
  return { imageUrl: null, productId: null };
}

async function fetchOrderBatch(path) {
  const result = await shopifyGet(path);
  if (result.status !== 200) return { orders: [], nextLink: null };
  // Check for Link header for pagination (not available in https module easily)
  return { orders: result.data.orders || [], nextLink: null };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return res.status(400).json({ error: 'Shopify not configured' });
    }

    // Fetch 120 latest orders across ALL statuses (any = open + closed + cancelled)
    // Shopify max per page is 250, so one call is enough for 120
    const fields = 'id,name,created_at,fulfillment_status,financial_status,customer,shipping_address,line_items,total_price,currency,fulfillments';
    // Calculate date 4 months ago
    const fourMonthsAgo = new Date();
    fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);
    const sinceDate = fourMonthsAgo.toISOString();

    // Fetch all orders using Shopify cursor-based pagination (page_info)
    let rawOrders = [];
    let pageInfo = null;
    let pageCount = 0;
    const baseOrderUrl = `/admin/api/2024-01/orders.json?status=any&limit=250&order=created_at+desc&fields=${fields}&created_at_min=${sinceDate}`;

    while (pageCount < 20) {
      // Build URL - first page uses date filter, subsequent pages use page_info cursor
      const url = pageInfo
        ? `/admin/api/2024-01/orders.json?limit=250&fields=${fields}&page_info=${pageInfo}`
        : baseOrderUrl;

      const result = await shopifyGet(url);
      if (result.status !== 200) {
        console.log('Shopify error on page', pageCount, result.status);
        break;
      }

      const pageOrders = result.data.orders || [];
      rawOrders = rawOrders.concat(pageOrders);
      pageCount++;

      console.log('Page', pageCount, '- fetched', pageOrders.length, 'orders, total:', rawOrders.length);

      // Stop if fewer than 250 returned (last page)
      if (pageOrders.length < 250) break;

      // Extract page_info cursor from Link header for next page
      const linkHeader = (result.headers && result.headers['link']) || '';
      const nextMatch = linkHeader.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
      if (nextMatch) {
        pageInfo = nextMatch[1];
      } else {
        break; // No next page
      }
    }

    // rawOrders built above via pagination
    console.log(`Fetched ${rawOrders.length} orders`);

    // Collect unique product IDs (filter out nulls)
    const productIds = [...new Set(
      rawOrders.flatMap(o => (o.line_items || []).map(i => i.product_id).filter(Boolean))
    )];

    // Collect ALL variant IDs (for image fallback lookup)
    const allVariantIds = [...new Set(
      rawOrders.flatMap(o => (o.line_items || []).map(i => i.variant_id).filter(Boolean))
    )];

    // Collect variant IDs for line items with no product_id (orphans)
    const orphanVariantIds = [...new Set(
      rawOrders.flatMap(o => (o.line_items || []).filter(i => !i.product_id && i.variant_id).map(i => i.variant_id))
    )];

    // Step 1: Fetch all product data
    const productDataMap = {};
    const variantToProductMap = {};

    await Promise.all([
      ...productIds.map(async (pid) => {
        productDataMap[pid] = await getProductData(pid);
      }),
      ...orphanVariantIds.map(async (vid) => {
        try {
          const vResult = await shopifyGet(`/admin/api/2024-01/variants/${vid}.json?fields=id,product_id,image`);
          if (vResult.status === 200 && vResult.data.variant) {
            const v = vResult.data.variant;
            const realPid = v.product_id;
            if (realPid && !productDataMap[realPid]) {
              productDataMap[realPid] = await getProductData(realPid);
            }
            variantToProductMap[vid] = realPid;
          }
        } catch(e) {}
      })
    ]);

    // Step 2: For products that came back with no images, fetch variant images directly
    // This handles archived/deleted products that still appear in order history
    const variantImageMap = {};
    const variantsNeedingImageLookup = [...new Set(
      rawOrders.flatMap(o => (o.line_items || []).filter(i => {
        if (!i.variant_id) return false;
        if (i.image && i.image.src) return false; // already has line item image
        const resolvedPid = i.product_id || variantToProductMap[i.variant_id];
        const pd = productDataMap[resolvedPid];
        return !pd || (!pd.firstImage && pd.images.length === 0);
      }).map(i => i.variant_id))
    )];

    if (variantsNeedingImageLookup.length > 0) {
      await Promise.all(variantsNeedingImageLookup.map(async (vid) => {
        try {
          const r = await shopifyGet(`/admin/api/2024-01/variants/${vid}.json?fields=id,image,product_id`);
          if (r.status === 200 && r.data.variant && r.data.variant.image) {
            variantImageMap[vid] = r.data.variant.image.src;
          }
        } catch(e) {}
      }));
    }

    // Build orders
    const orders = rawOrders.map(o => {
      const fulfillment = (o.fulfillments || [])[0] || {};
      const addr = o.shipping_address || {};

      // Determine status
      let status = 'unfulfilled';
      if (o.fulfillment_status === 'fulfilled') status = 'fulfilled';
      else if (o.fulfillment_status === 'partial') status = 'partial';
      else if (o.financial_status === 'refunded' || o.financial_status === 'voided') status = 'cancelled';

      const items = (o.line_items || []).filter(i => {
        // Exclude removed/cancelled line items (Shopify sets current_quantity to 0)
        if ((i.current_quantity !== undefined && i.current_quantity === 0) &&
            (i.fulfillable_quantity !== undefined && i.fulfillable_quantity === 0)) return false;
        // Exclude zero-quantity items
        if (i.quantity === 0) return false;
        // Exclude tips and gift cards
        if (i.gift_card) return false;
        if (i.title && (i.title.toLowerCase() === 'tip' || i.title.toLowerCase().includes('donation'))) return false;
        return true;
      }).map(i => {
        // Resolve product data - use variantToProductMap for items with null product_id
        const resolvedPid = i.product_id || variantToProductMap[i.variant_id];
        const pd = productDataMap[resolvedPid] || { images: [], firstImage: null, handle: '' };
        let imageUrl = '';
        // 1. Line item image - most reliable, comes directly from order data
        if (i.image && i.image.src) imageUrl = i.image.src;
        // 2. Variant-specific image matched to this variant
        if (!imageUrl && i.variant_id && pd.images.length > 0) {
          const variantImg = pd.images.find(img =>
            img.variant_ids && img.variant_ids.includes(i.variant_id)
          );
          if (variantImg) imageUrl = variantImg.src;
        }
        // 3. First product image
        if (!imageUrl) imageUrl = pd.firstImage || '';
        // 4. Variant-level image via variantImageMap (for archived/deleted products)
        if (!imageUrl && i.variant_id && variantImageMap[i.variant_id]) {
          imageUrl = variantImageMap[i.variant_id];
        }
        // Strip size suffix only - keep ?v= query param intact
        if (imageUrl) imageUrl = imageUrl.replace(/_\d+x\d*/g, '');
        // Build productUrl from handle; if no handle, derive from title
        let productUrl = '';
        if (pd.handle) {
          productUrl = `${STORE_URL}/products/${pd.handle}`;
        } else if (i.title && i.title !== 'Tip' && !i.title.toLowerCase().includes('shipping')) {
          // Generate handle from title (Shopify convention)
          const derivedHandle = i.title.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
          if (derivedHandle) productUrl = `${STORE_URL}/products/${derivedHandle}`;
        }
        return {
          title: i.title,
          variant: i.variant_title || '',
          qty: i.quantity,
          price: parseFloat(i.price),
          imageUrl,
          productUrl,
          productId: String(resolvedPid || i.product_id || '')
        };
      });

      return {
        id: 'shopify_' + o.id,
        num: o.name,
        date: o.created_at,
        status,
        customer: {
          name: addr.name || (o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : 'Unknown'),
          addr: [addr.address1, addr.city, addr.province, addr.zip, addr.country].filter(Boolean).join(', ')
        },
        items,
        total: parseFloat(o.total_price),
        currency: o.currency,
        carrier: fulfillment.tracking_company || '',
        tracking: fulfillment.tracking_number || '',
        labelUrl: fulfillment.label_url || '',
        shopifyOrderId: String(o.id),
        shopifyFulfillmentId: String(fulfillment.id || ''),
        countryCode: addr.country_code || ''
      };
    });

    return res.status(200).json({ success: true, orders, total: orders.length });

  } catch (err) {
    console.error('Orders API error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
