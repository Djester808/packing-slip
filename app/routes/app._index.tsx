import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState, useRef, useEffect } from "react";
import { useNavigation } from "@remix-run/react";
import { Page, Card, Text, BlockStack, Box, Badge, InlineStack } from "@shopify/polaris";
import { shopifyGraphQL } from "../admin-api.server";
import { seedDefaultRulesIfEmpty } from "../transit.server";
import prisma from "../db.server";

const PAGE_SIZE = 25;

function isLocalShipping(method: string) {
  return /local|pickup|pick.?up/i.test(method);
}

export const loader = async (_: LoaderFunctionArgs) => {
  await seedDefaultRulesIfEmpty();

  const allEdges: any[] = [];
  let cursor: string | null = null;

  while (true) {
    const data = await shopifyGraphQL(`
      query($after: String) {
        orders(first: 250, after: $after, query: "fulfillment_status:unfulfilled status:open", sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id name createdAt tags displayFulfillmentStatus
              customer { firstName lastName }
              shippingAddress { city province zip country }
              shippingLine { title }
              totalPriceSet { presentmentMoney { amount currencyCode } }
            }
          }
        }
      }
    `, { after: cursor });

    const page = data.data?.orders;
    if (!page) break;
    allEdges.push(...page.edges);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" }, update: {}, create: { id: "singleton" },
  });

  const orders = allEdges.map((edge: any) => ({
    id: edge.node.id.split("/").pop(),
    name: edge.node.name,
    createdAt: new Date(edge.node.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    createdAtRaw: edge.node.createdAt as string,
    fulfillmentStatus: edge.node.displayFulfillmentStatus,
    customerName: edge.node.customer
      ? `${edge.node.customer.firstName ?? ""} ${edge.node.customer.lastName ?? ""}`.trim()
      : "Guest",
    city: edge.node.shippingAddress?.city ?? "",
    province: edge.node.shippingAddress?.province ?? "",
    zip: edge.node.shippingAddress?.zip ?? "",
    shippingMethod: edge.node.shippingLine?.title ?? "—",
    total: `${edge.node.totalPriceSet?.presentmentMoney?.amount ?? ""} ${edge.node.totalPriceSet?.presentmentMoney?.currencyCode ?? ""}`.trim(),
    isLocal: isLocalShipping(edge.node.shippingLine?.title ?? ""),
    isReship: /reship/i.test(edge.node.shippingLine?.title ?? ""),
  }));

  return json({ orders, printLocalOrders: settings.printLocalOrders });
};

export default function Index() {
  const { orders, printLocalOrders } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isPrinting = navigation.location?.pathname === "/app/print-batch";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [colWidths, setColWidths] = useState({ order: 110, customer: 150, shipto: 180, method: 170, status: 120 });
  const resizingCol = useRef<{ col: keyof typeof colWidths; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingCol.current) return;
      const { col, startX, startW } = resizingCol.current;
      setColWidths((prev) => ({ ...prev, [col]: Math.max(60, startW + e.clientX - startX) }));
    };
    const onUp = () => { resizingCol.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const q = search.trim().toLowerCase();
  const filteredOrders = q
    ? orders.filter((o) =>
        o.name.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.city.toLowerCase().includes(q) ||
        o.province.toLowerCase().includes(q) ||
        o.zip.toLowerCase().includes(q)
      )
    : orders;

  const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE);
  const pageOrders = filteredOrders.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageStart = page * PAGE_SIZE;

  const allSelected = pageOrders.length > 0 && pageOrders.every((o) => selected.has(o.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pageOrders.map((o) => o.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(0);
  };

  return (
    <Page title="AquaSlip">
      <BlockStack gap="400">
        <InlineStack gap="300" align="space-between" blockAlign="center">
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
            <input
              type="search"
              placeholder="Search by name, order #, or address…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              style={{ padding: "7px 12px", border: "1px solid #c4cdd5", borderRadius: "6px", fontSize: "13px", width: "300px", outline: "none" }}
            />
            <Text as="span" variant="bodyMd" tone="subdued">
              {filteredOrders.length}{q ? ` of ${orders.length}` : ""} unfulfilled order{filteredOrders.length !== 1 ? "s" : ""}
            </Text>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setSelected(new Set(filteredOrders.map((o) => o.id)))}
              style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "8px 14px", cursor: "pointer", fontSize: "13px" }}
            >
              Select all {filteredOrders.length}
            </button>
            {selected.size > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "8px 14px", cursor: "pointer", fontSize: "13px" }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const toPrint = filteredOrders
                      .filter(o => selected.has(o.id) && (printLocalOrders || !o.isLocal))
                      .sort((a, b) => {
                        if (a.isReship !== b.isReship) return a.isReship ? -1 : 1;
                        return new Date(a.createdAtRaw).getTime() - new Date(b.createdAtRaw).getTime();
                      });
                    if (toPrint.length > 0) navigate(`/app/print-batch?ids=${toPrint.map(o => o.id).join(",")}`);
                  }}
                  disabled={isPrinting}
                  style={{ background: isPrinting ? "#6d7175" : "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 18px", cursor: isPrinting ? "default" : "pointer", fontSize: "13px", fontWeight: 600 }}
                >
                  {isPrinting ? "Loading…" : `🖨 Print ${selected.size} slip${selected.size !== 1 ? "s" : ""}`}
                </button>
              </>
            )}
          </div>
        </InlineStack>

        {filteredOrders.length === 0 ? (
          <Card>
            <Box padding="400">
              <Text as="p" variant="bodyMd" tone="subdued">{q ? "No orders match your search." : "No unfulfilled orders."}</Text>
            </Box>
          </Card>
        ) : (
          <Card padding="0">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ background: "#f6f6f7" }}>
                    <th style={{ padding: "10px 14px", borderBottom: "1px solid #e1e3e5", width: 40 }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: "pointer" }} />
                    </th>
                    {([
                      { col: "order", label: "Order" },
                      { col: "customer", label: "Customer" },
                      { col: "shipto", label: "Ship to" },
                      { col: "method", label: "Shipping method" },
                      { col: "status", label: "Status" },
                    ] as { col: keyof typeof colWidths; label: string }[]).map(({ col, label }) => (
                      <th key={col} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#6d7175", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap", width: colWidths[col], position: "relative", userSelect: "none" }}>
                        {label}
                        <div
                          onMouseDown={(e) => { e.preventDefault(); resizingCol.current = { col, startX: e.clientX, startW: colWidths[col] }; }}
                          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "5px", cursor: "col-resize" }}
                        />
                      </th>
                    ))}
                    <th style={{ padding: "10px 14px", borderBottom: "1px solid #e1e3e5" }} />
                  </tr>
                </thead>
                <tbody>
                  {pageOrders.map((order, i) => (
                    <tr
                      key={order.id}
                      style={{
                        background: selected.has(order.id) ? "#edf4ff" : order.isLocal ? "#fffbf0" : i % 2 === 0 ? "#fff" : "#fafafa",
                        cursor: "pointer",
                      }}
                      onClick={() => navigate(`/app/slip/${order.id}?ids=${filteredOrders.map(o => o.id).join(",")}&i=${pageStart + i}`)}
                    >
                      <td
                        style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5" }}
                        onClick={(e) => { e.stopPropagation(); toggle(order.id); }}
                      >
                        <input type="checkbox" checked={selected.has(order.id)} onChange={() => toggle(order.id)} style={{ cursor: "pointer" }} />
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5", fontWeight: 600, color: "#005bd3" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {order.name}
                          {order.isLocal && (
                            <span style={{ background: "#fff3cd", border: "1px solid #f0a500", borderRadius: "4px", padding: "1px 6px", fontSize: "10px", fontWeight: 800, color: "#7d4e00", letterSpacing: "0.05em" }}>
                              LOCAL
                            </span>
                          )}
                        </span>
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5" }}>{order.customerName}</td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5", color: "#6d7175" }}>
                        {order.isLocal
                          ? <em>Local — no shipment</em>
                          : [order.city, order.province, order.zip].filter(Boolean).join(", ")}
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5" }}>
                        {order.isLocal ? (
                          <span style={{ background: "#fff3cd", border: "1px solid #f0a500", borderRadius: "4px", padding: "2px 7px", fontSize: "11px", fontWeight: 700, color: "#7d4e00" }}>
                            {/^\d+\s/.test(order.shippingMethod) ? "Local Order" : order.shippingMethod}
                          </span>
                        ) : order.shippingMethod}
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5" }}>
                        <Badge>{order.fulfillmentStatus}</Badge>
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5" }}>
                        <span style={{ color: "#005bd3", fontSize: "12px" }}>View slip →</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", padding: "12px 16px", borderTop: "1px solid #e1e3e5" }}>
                <Text as="span" variant="bodySm" tone="subdued">
                  {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredOrders.length)} of {filteredOrders.length}
                </Text>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setPage(p => p - 1)}
                    disabled={page === 0}
                    style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "5px 14px", cursor: page === 0 ? "default" : "pointer", fontSize: "13px", opacity: page === 0 ? 0.4 : 1 }}
                  >
                    ‹ Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page >= totalPages - 1}
                    style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "5px 14px", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: "13px", opacity: page >= totalPages - 1 ? 0.4 : 1 }}
                  >
                    Next ›
                  </button>
                </div>
              </div>
            )}
          </Card>
        )}
        <Box padding="400" />
      </BlockStack>
    </Page>
  );
}
