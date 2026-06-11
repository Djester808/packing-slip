import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Text, BlockStack, Box } from "@shopify/polaris";
import { getInventoryTotals } from "../slip.server";

export const loader = async (_: LoaderFunctionArgs) => {
  const totals = await getInventoryTotals();
  return json({ totals });
};

export default function InventoryPage() {
  const { totals } = useLoaderData<typeof loader>();

  return (
    <Page title="Inventory - Spoken For">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Box>
              <Text variant="headingMd" as="h2">
                Current Allocation
              </Text>
              <Text variant="bodyMd" tone="subdued">
                Total items allocated to unfulfilled orders (calculated with packing bonuses)
              </Text>
            </Box>

            {totals.length === 0 ? (
              <Text tone="subdued">No items in unfulfilled orders</Text>
            ) : (
              <Box overflowX="auto">
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #ddd" }}>
                      <th style={{ textAlign: "left", padding: "12px", fontWeight: 600 }}>Product</th>
                      <th style={{ textAlign: "right", padding: "12px", fontWeight: 600 }}>Spoken For</th>
                      <th style={{ textAlign: "left", padding: "12px", fontWeight: 600 }}>Variants</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.map((item) => (
                      <tr key={item.title} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "12px", textAlign: "left" }}>{item.title}</td>
                        <td style={{ padding: "12px", textAlign: "right", fontWeight: 600 }}>{item.quantity}</td>
                        <td style={{ padding: "12px", textAlign: "left", fontSize: "12px", color: "#666" }}>
                          {item.variantCount > 1 ? `${item.variantCount} variants` : item.variants}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>
            )}

            <Box borderTopWidth="1" borderColor="border" paddingBlockStart="300">
              <Text variant="bodySm" tone="subdued">
                Total distinct products: {totals.length} · Total units: {totals.reduce((sum, item) => sum + item.quantity, 0)}
              </Text>
            </Box>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
