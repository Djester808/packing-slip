import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState } from "react";
import { Page, Card, Text, BlockStack, Box } from "@shopify/polaris";
import { getInventoryTotals } from "../slip.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const weekOffset = url.searchParams.get("week") === "previous" ? -1 : 0;
  const totals = await getInventoryTotals(weekOffset);
  return json({ totals, weekOffset });
};

export default function InventoryPage() {
  const { totals, weekOffset } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [tab, setTab] = useState(weekOffset === -1 ? "previous" : "current");

  const handleTabChange = (newTab: string) => {
    setTab(newTab);
    navigate(`?week=${newTab === "previous" ? "previous" : "current"}`);
  };

  const title = tab === "previous" ? "Previous Week (Sun-Wed)" : "Current";
  const totalUnits = totals.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Page title="Inventory - Spoken For">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <Box>
                <Text variant="headingMd" as="h2">
                  Allocation: {title}
                </Text>
                <Text variant="bodyMd" tone="subdued">
                  Total items allocated to unfulfilled orders (calculated with packing bonuses)
                </Text>
              </Box>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => handleTabChange("current")}
                style={{
                  padding: "8px 14px",
                  border: tab === "current" ? "2px solid #005bd3" : "1px solid #c4cdd5",
                  borderRadius: "6px",
                  background: tab === "current" ? "#f0f6ff" : "#fff",
                  color: tab === "current" ? "#005bd3" : "#1a1a1a",
                  cursor: "pointer",
                  fontWeight: tab === "current" ? 600 : 400,
                }}
              >
                Current
              </button>
              <button
                onClick={() => handleTabChange("previous")}
                style={{
                  padding: "8px 14px",
                  border: tab === "previous" ? "2px solid #005bd3" : "1px solid #c4cdd5",
                  borderRadius: "6px",
                  background: tab === "previous" ? "#f0f6ff" : "#fff",
                  color: tab === "previous" ? "#005bd3" : "#1a1a1a",
                  cursor: "pointer",
                  fontWeight: tab === "previous" ? 600 : 400,
                }}
              >
                Previous Week
              </button>
            </div>

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
                Total distinct products: {totals.length} · Total units: {totalUnits}
              </Text>
            </Box>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
