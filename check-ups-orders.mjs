import 'dotenv/config';

const query = async () => {
  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  const domain = process.env.SHOPIFY_STORE_DOMAIN;

  const tokenRes = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;

  const orderRes = await fetch(`https://${domain}/admin/api/2026-07/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: `{
        orders(first: 50, query: "created:>=2026-01-01 created:<=2026-12-31 fulfillment_status:fulfilled") {
          edges { node {
            id name createdAt
            shippingLine { title }
            shippingAddress { zip }
            fulfillments(first: 1) {
              id status inTransitAt deliveredAt
            }
          } }
        }
      }`
    })
  });
  const orderData = await orderRes.json();

  const upsOrders = orderData.data?.orders?.edges?.filter(edge =>
    /\bups\b/i.test(edge.node.shippingLine?.title || '')
  ) || [];

  // Filter for fast methods (overnight, 2-day)
  const fastUPS = upsOrders.filter(edge => {
    const title = edge.node.shippingLine?.title || '';
    return /overnight|next.?day|1.?day|2.?d|2nd|two.?day|express/i.test(title);
  });

  console.log(`\nTotal fulfilled orders with UPS shipping: ${upsOrders.length}`);
  console.log(`Fast UPS orders (overnight/2-day): ${fastUPS.length}`);

  fastUPS.slice(0, 10).forEach(edge => {
    const fulfillment = edge.node.fulfillments?.[0];
    console.log(`\n${edge.node.name}: ${edge.node.shippingLine?.title}`);
    console.log(`  ZIP: ${edge.node.shippingAddress?.zip || 'N/A'}`);
    console.log(`  InTransit: ${fulfillment?.inTransitAt}, Delivered: ${fulfillment?.deliveredAt}`);
  });

  if (fastUPS.length === 0) {
    console.log('\nNo fast UPS orders found. Ground orders:');
    upsOrders.slice(0, 5).forEach(edge => {
      console.log(`\n${edge.node.name}: ${edge.node.shippingLine?.title}`);
    });
  }
};
query().catch(console.error);
