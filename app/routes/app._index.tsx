import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { Page, Card, Text, BlockStack, InlineStack, Badge, Box, Spinner } from "@shopify/polaris";
import { shopifyGraphQL } from "../admin-api.server";
import { seedDefaultRulesIfEmpty } from "../transit.server";

export const loader = async (_: LoaderFunctionArgs) => {
  await seedDefaultRulesIfEmpty();

  const data = await shopifyGraphQL(`
    query {
      orders(first: 50, query: "status:open", sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id name createdAt displayFulfillmentStatus
            customer { firstName lastName }
            shippingAddress { city province zip country }
            shippingLine { title }
            totalPriceSet { presentmentMoney { amount currencyCode } }
          }
        }
      }
    }
  `);

  const orders = (data.data?.orders?.edges ?? []).map((edge: any) => ({
    id: edge.node.id.split("/").pop(),
    gid: edge.node.id,
    name: edge.node.name,
    createdAt: new Date(edge.node.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    fulfillmentStatus: edge.node.displayFulfillmentStatus,
    customerName: edge.node.customer
      ? `${edge.node.customer.firstName ?? ""} ${edge.node.customer.lastName ?? ""}`.trim()
      : "Guest",
    city: edge.node.shippingAddress?.city ?? "",
    province: edge.node.shippingAddress?.province ?? "",
    zip: edge.node.shippingAddress?.zip ?? "",
    shippingMethod: edge.node.shippingLine?.title ?? "—",
    total: `${edge.node.totalPriceSet?.presentmentMoney?.amount ?? ""} ${edge.node.totalPriceSet?.presentmentMoney?.currencyCode ?? ""}`.trim(),
  }));

  return json({ orders });
};

export default function Index() {
  const { orders } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page title="Packing Slips">
      <BlockStack gap="400">
        {orders.length === 0 ? (
          <Card>
            <Box padding="400">
              <Text as="p" variant="bodyMd" tone="subdued">No open orders found.</Text>
            </Box>
          </Card>
        ) : (
          <Card padding="0">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ background: "#f6f6f7" }}>
                    {["Order", "Customer", "Ship to", "Shipping method", "Total", "Status", ""].map((h) => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#6d7175", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order, i) => (
                    <tr
                      key={order.id}
                      style={{ background: i % 2 === 0 ? "#fff" : "#fafafa", cursor: "pointer" }}
                      onClick={() => navigate(`/app/slip/${order.id}`)}
                    >
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5", fontWeight: 600, color: "#005bd3" }}>{order.name}</td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5" }}>{order.customerName}</td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5", color: "#6d7175" }}>
                        {[order.city, order.province, order.zip].filter(Boolean).join(", ")}
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5" }}>{order.shippingMethod}</td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5" }}>{order.total}</td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5" }}>
                        <Badge>{order.fulfillmentStatus}</Badge>
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5" }}>
                        <span style={{ color: "#005bd3", fontSize: "12px" }}>Print slip →</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
