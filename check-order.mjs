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
        orders(first: 10, query: "#5454") {
          edges { node {
            id name createdAt
            shippingAddress { city province zip }
            shippingLine { title }
            fulfillments(first: 5) {
              id status createdAt inTransitAt deliveredAt
            }
          } }
        }
      }`
    })
  });
  const orderData = await orderRes.json();
  if (orderData.data?.orders?.edges?.length) {
    orderData.data.orders.edges.forEach((edge, i) => {
      console.log(`\n=== Order ${i + 1} ===`);
      console.log(JSON.stringify(edge.node, null, 2));
    });
  } else {
    console.log('Order not found');
    console.log(JSON.stringify(orderData, null, 2));
  }
};
query().catch(console.error);
