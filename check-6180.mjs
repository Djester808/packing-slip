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
        orders(first: 1, query: "name:#6180") {
          edges { node {
            id name createdAt
            tags
            shippingAddress { city province zip }
            shippingLine { title }
            fulfillments(first: 1) {
              id status inTransitAt deliveredAt
            }
          } }
        }
      }`
    })
  });
  const orderData = await orderRes.json();

  if (orderData.data?.orders?.edges?.length) {
    const order = orderData.data.orders.edges[0].node;
    console.log('Order #6180:');
    console.log(`  Shipping Method: ${order.shippingLine?.title}`);
    console.log(`  Tags: ${order.tags?.join(', ') || 'none'}`);
    const fulfillment = order.fulfillments?.[0];
    if (fulfillment) {
      const inTransit = new Date(fulfillment.inTransitAt);
      const delivered = new Date(fulfillment.deliveredAt);
      console.log(`  InTransit: ${fulfillment.inTransitAt} (${inTransit.toDateString()})`);
      console.log(`  Delivered: ${fulfillment.deliveredAt} (${delivered.toDateString()})`);
      const days = Math.ceil((delivered - inTransit) / (1000 * 60 * 60 * 24));
      console.log(`  Transit days: ${days}`);
      const promised = new Date(inTransit);
      promised.setDate(promised.getDate() + days);
      console.log(`  Promised delivery: ${promised.toDateString()}`);
      const daysLate = Math.ceil((delivered - promised) / (1000 * 60 * 60 * 24));
      console.log(`  Days late: ${daysLate}`);
    }
  } else {
    console.log('Order #6180 not found');
  }
};
query().catch(console.error);
