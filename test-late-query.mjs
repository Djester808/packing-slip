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

  const startOf2026 = "2026-01-01T00:00:00Z";
  const endOf2026 = "2026-12-31T23:59:59Z";
  const queryStr = `created:>="${startOf2026}" created:<="${endOf2026}" fulfillment_status:fulfilled`;

  const orderRes = await fetch(`https://${domain}/admin/api/2026-07/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: `query($after: String, $query: String!) {
        orders(first: 250, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges { node {
            name
            shippingLine { title }
            fulfillments(first: 100) {
              id status createdAt inTransitAt deliveredAt
            }
          } }
        }
      }`,
      variables: { after: null, query: queryStr }
    })
  });
  const orderData = await orderRes.json();

  const upsOrders = orderData.data?.orders?.edges?.filter(edge =>
    /\bups\b/i.test(edge.node.shippingLine?.title || '')
  ) || [];

  console.log(`Total orders in query: ${orderData.data?.orders?.edges?.length}`);
  console.log(`UPS orders: ${upsOrders.length}`);
  upsOrders.slice(0, 5).forEach(edge => {
    console.log(`  ${edge.node.name}: ${edge.node.shippingLine?.title}`);
  });
};
query().catch(console.error);
