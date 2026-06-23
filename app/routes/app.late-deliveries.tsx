import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Text, BlockStack, Badge } from "@shopify/polaris";
import { shopifyGraphQL } from "../admin-api.server";
import { getTransitDays } from "../transit.server";

interface LateDelivery {
  orderId: string;
  orderName: string;
  customerName: string;
  shippingMethod: string;
  shippingZip: string;
  pickedUpAt: string;
  deliveredAt: string;
  promisedDelivery: string;
  daysLate: number;
}

// Match: overnight, next day, 1-day, 2-day, 2nd day, express, priority mail express, etc.
const FAST_METHODS_RE = /overnight|next.?day|1.?day|2.?d|2nd|two.?day|express|priority mail express/i;

export const loader = async (_: LoaderFunctionArgs) => {
  const lateDeliveries: LateDelivery[] = [];

  const startOf2026 = "2026-01-01T00:00:00Z";
  const endOf2026 = "2026-12-31T23:59:59Z";
  const query = `created:>="${startOf2026}" created:<="${endOf2026}" fulfillment_status:fulfilled`;

  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await shopifyGraphQL(
      `query($after: String, $query: String!) {
        orders(first: 250, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges { node {
            id name createdAt
            customer { firstName lastName }
            shippingAddress { zip city province }
            shippingLine { title }
            fulfillments(first: 100) {
              id status createdAt updatedAt inTransitAt deliveredAt
            }
          } }
        }
      }`,
      { after: cursor, query }
    );

    const orders = data.data?.orders?.edges ?? [];

    for (const edge of orders) {
      const order = edge.node;
      const shippingMethod = order.shippingLine?.title ?? "";

      if (!FAST_METHODS_RE.test(shippingMethod)) continue;

      const fulfillments = order.fulfillments ?? [];
      const fulfillment = fulfillments.find((f: any) => f.inTransitAt && f.deliveredAt);

      if (!fulfillment) continue;

      const pickedUpAt = new Date(fulfillment.inTransitAt);
      const deliveredAt = new Date(fulfillment.deliveredAt);

      const zip = order.shippingAddress?.zip ?? "";
      const state = order.shippingAddress?.province ?? "";
      const city = order.shippingAddress?.city ?? "";

      try {
        const transitDays = await getTransitDays(
          shippingMethod,
          zip,
          pickedUpAt,
          state,
          city
        );

        const promisedDelivery = new Date(pickedUpAt);
        promisedDelivery.setDate(promisedDelivery.getDate() + transitDays);

        const daysLate = Math.ceil((deliveredAt.getTime() - promisedDelivery.getTime()) / (1000 * 60 * 60 * 24));

        if (daysLate > 0) {
          lateDeliveries.push({
            orderId: order.id.split("/").pop() ?? "",
            orderName: order.name,
            customerName: order.customer
              ? `${order.customer.firstName ?? ""} ${order.customer.lastName ?? ""}`.trim()
              : "Guest",
            shippingMethod,
            shippingZip: zip,
            pickedUpAt: pickedUpAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            deliveredAt: deliveredAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            promisedDelivery: promisedDelivery.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            daysLate,
          });
        }
      } catch {
        // Skip orders where transit calculation fails
      }
    }

    hasNextPage = data.data?.orders?.pageInfo?.hasNextPage ?? false;
    cursor = data.data?.orders?.pageInfo?.endCursor ?? null;
  }

  // Sort by days late (descending)
  lateDeliveries.sort((a, b) => b.daysLate - a.daysLate);

  return json({ lateDeliveries });
};

export default function LateDeliveries() {
  const { lateDeliveries } = useLoaderData<typeof loader>();

  return (
    <Page title="Late Deliveries">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              2026 Late Deliveries (Overnight & 2-Day Only)
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Total: {lateDeliveries.length} orders
            </Text>
            {lateDeliveries.length === 0 ? (
              <Text as="p" variant="bodyMd">
                No late deliveries found for overnight and 2-day shipping in 2026.
              </Text>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "14px",
                  lineHeight: "1.5",
                }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e1e3e5", backgroundColor: "#f3f3f3" }}>
                      <th style={{ padding: "12px", textAlign: "left", fontWeight: 600 }}>Order</th>
                      <th style={{ padding: "12px", textAlign: "left", fontWeight: 600 }}>Customer</th>
                      <th style={{ padding: "12px", textAlign: "left", fontWeight: 600 }}>Shipping Method</th>
                      <th style={{ padding: "12px", textAlign: "left", fontWeight: 600 }}>Picked Up</th>
                      <th style={{ padding: "12px", textAlign: "left", fontWeight: 600 }}>Promised</th>
                      <th style={{ padding: "12px", textAlign: "left", fontWeight: 600 }}>Delivered</th>
                      <th style={{ padding: "12px", textAlign: "right", fontWeight: 600 }}>Days Late</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lateDeliveries.map((delivery, idx) => (
                      <tr key={delivery.orderId} style={{ borderBottom: "1px solid #e1e3e5", backgroundColor: idx % 2 === 0 ? "#f9f9f9" : "#fff" }}>
                        <td style={{ padding: "12px" }}>{delivery.orderName}</td>
                        <td style={{ padding: "12px" }}>{delivery.customerName}</td>
                        <td style={{ padding: "12px" }}>{delivery.shippingMethod}</td>
                        <td style={{ padding: "12px" }}>{delivery.pickedUpAt}</td>
                        <td style={{ padding: "12px" }}>{delivery.promisedDelivery}</td>
                        <td style={{ padding: "12px" }}>{delivery.deliveredAt}</td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          <Badge tone="critical">{delivery.daysLate}d late</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
