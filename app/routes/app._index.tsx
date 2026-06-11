import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import { Page, Card, Text, BlockStack, Box, Badge, InlineStack } from "@shopify/polaris";
import { shopifyGraphQL } from "../admin-api.server";
import { seedDefaultRulesIfEmpty } from "../transit.server";
import { nextShipDate } from "../weather.server";
import prisma from "../db.server";

const PAGE_SIZE = 25;

const ORDER_FIELDS = `
  id name createdAt tags displayFulfillmentStatus displayFinancialStatus
  customer { firstName lastName }
  shippingAddress { city province zip country }
  shippingLine { title }
  totalPriceSet { presentmentMoney { amount currencyCode } }
`;

function isLocalShipping(method: string) {
  return /local|pickup|pick.?up/i.test(method);
}

export const loader = async (_: LoaderFunctionArgs) => {
  const [, firstData, settings] = await Promise.all([
    seedDefaultRulesIfEmpty(),
    shopifyGraphQL(`
      query($after: String) {
        shop { myshopifyDomain }
        orders(first: 250, after: $after, query: "fulfillment_status:unfulfilled status:open", sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges { node { ${ORDER_FIELDS} } }
        }
      }
    `, { after: null }),
    prisma.appSettings.upsert({
      where: { id: "singleton" }, update: {}, create: { id: "singleton" },
    }),
  ]);

  const shopDomain: string | null = firstData.data?.shop?.myshopifyDomain ?? null;
  const allEdges: any[] = [...(firstData.data?.orders?.edges ?? [])];
  let cursor: string | null = firstData.data?.orders?.pageInfo?.hasNextPage
    ? firstData.data?.orders?.pageInfo?.endCursor
    : null;

  while (cursor) {
    const nextPage = await shopifyGraphQL(`
      query($after: String) {
        orders(first: 250, after: $after, query: "fulfillment_status:unfulfilled status:open", sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges { node { ${ORDER_FIELDS} } }
        }
      }
    `, { after: cursor });
    const page = nextPage.data?.orders;
    if (!page) break;
    allEdges.push(...page.edges);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }

  const orders = allEdges
    .filter((edge: any) => edge.node.displayFinancialStatus !== "PENDING")
    .map((edge: any) => ({
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

  const { date: nextShip } = nextShipDate();
  const defaultShipDate = nextShip.toISOString().slice(0, 10);
  return json({ orders, printLocalOrders: settings.printLocalOrders, shopDomain, defaultShipDate });
};

export default function Index() {
  const { orders, printLocalOrders, shopDomain, defaultShipDate } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [loadingSlipId, setLoadingSlipId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Packable-today filter
  const [packableFilter, setPackableFilter] = useState(false);
  const [packableIds, setPackableIds] = useState<Set<string> | null>(null);
  const [fetchingPackable, setFetchingPackable] = useState(false);
  const [blockedOrders, setBlockedOrders] = useState<Array<{ id: string; name: string; customerName: string; city: string; province: string; zip: string; reason: string }>>([]);

  // Ship-date modal
  const [showPackableModal, setShowPackableModal] = useState(false);
  const [modalShipDate, setModalShipDate] = useState(defaultShipDate);
  const [modalOrderCutoff, setModalOrderCutoff] = useState("");
  const [activeShipDate, setActiveShipDate] = useState(defaultShipDate);

  useEffect(() => {
    if (navigation.state === "idle") setLoadingSlipId(null);
  }, [navigation.state]);
  const searchTimer = useRef<number | null>(null);
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

  async function runPackableCheck(shipDate: string, orderCutoff: string) {
    setShowPackableModal(false);
    setFetchingPackable(true);
    setPackableIds(null);
    setBlockedOrders([]);

    const cutoffMs = orderCutoff ? new Date(orderCutoff).getTime() : null;
    const eligibleOrders = cutoffMs !== null
      ? orders.filter((o) => new Date(o.createdAtRaw).getTime() >= cutoffMs)
      : orders;

    const allIds = eligibleOrders.map((o) => o.id);
    const BATCH = 50;
    const safeIds = new Set<string>();
    const held: Array<{ id: string; name: string; customerName: string; city: string; province: string; zip: string; reason: string }> = [];

    for (let i = 0; i < allIds.length; i += BATCH) {
      const chunk = allIds.slice(i, i + BATCH);
      try {
        const url = `/api/slips?ids=${chunk.join(",")}&shipDate=${encodeURIComponent(shipDate)}`;
        const res = await fetch(url);
        if (res.ok) {
          const slips: any[] = await res.json();
          const returnedIds = new Set(slips.map((s: any) => s.order.id));
          for (const slip of slips) {
            if (!printLocalOrders && slip.order.isLocal) continue;
            const isDanger = !slip.order.isAccessPoint && slip.alert?.level === "danger";
            const isWeekend = slip.weather?.crossesWeekend === true;
            if (!isDanger && !isWeekend) {
              safeIds.add(slip.order.id);
            } else {
              const orderInfo = orders.find((o) => o.id === slip.order.id);
              const reasons: string[] = [];
              if (isWeekend) reasons.push(`Arrives after weekend — est. ${slip.weather.deliveryDate}`);
              if (isDanger) reasons.push(slip.alert.headline);
              held.push({
                id: slip.order.id,
                name: orderInfo?.name ?? slip.order.name ?? "",
                customerName: orderInfo?.customerName ?? "",
                city: orderInfo?.city ?? "",
                province: orderInfo?.province ?? "",
                zip: orderInfo?.zip ?? "",
                reason: reasons.join("; "),
              });
            }
          }
          for (const id of chunk) {
            if (!returnedIds.has(id)) {
              const orderInfo = orders.find((o) => o.id === id);
              if (orderInfo && !orderInfo.isLocal) {
                held.push({
                  id,
                  name: orderInfo.name,
                  customerName: orderInfo.customerName,
                  city: orderInfo.city,
                  province: orderInfo.province,
                  zip: orderInfo.zip,
                  reason: "Unable to check forecast — verify before shipping",
                });
              }
            }
          }
        }
      } catch {}
    }

    setPackableIds(safeIds);
    setBlockedOrders(held);
    setPackableFilter(true);
    setActiveShipDate(shipDate);
    setPage(0);
    setFetchingPackable(false);
  }

  function printHoldList() {
    const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const rows = blockedOrders
      .map((o) => `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;font-weight:600;">${o.name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">${o.customerName}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;color:#6d7175;">${[o.city, o.province, o.zip].filter(Boolean).join(", ")}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;color:#c00;font-weight:600;">${o.reason}</td>
        </tr>`)
      .join("");
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Orders on Hold</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 28px 32px; color: #1a1a1a; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .subtitle { font-size: 13px; color: #6d7175; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead tr { background: #f6f6f7; }
    th { padding: 9px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6d7175; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #c4cdd5; }
    tbody tr:nth-child(even) { background: #fafafa; }
    @media print { body { margin: 12px; } }
  </style>
</head>
<body>
  <h1>Orders on Hold</h1>
  <div class="subtitle">Generated ${date} &mdash; ${blockedOrders.length} order${blockedOrders.length !== 1 ? "s" : ""} cannot ship today</div>
  <table>
    <thead><tr><th>Order</th><th>Customer</th><th>Ship to</th><th>Reason</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 400);
    }
  }

  function clearPackableFilter() {
    setPackableFilter(false);
    setPackableIds(null);
    setBlockedOrders([]);
  }

  const q = search.trim().toLowerCase();
  const baseOrders = q
    ? orders.filter((o) =>
        o.name.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.city.toLowerCase().includes(q) ||
        o.province.toLowerCase().includes(q) ||
        o.zip.toLowerCase().includes(q)
      )
    : orders;

  const filteredOrders = packableFilter && packableIds !== null
    ? baseOrders.filter((o) => packableIds.has(o.id))
    : baseOrders;

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
    setIsSearching(true);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      setIsSearching(false);
      searchTimer.current = null;
    }, 200);
  };

  const packableCount = packableIds !== null ? packableIds.size : null;

  return (
    <>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
      {(loadingSlipId || isSearching || fetchingPackable) && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.95)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100000 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: "48px", height: "48px", border: "3px solid #e1e3e5", borderTop: "3px solid #007a5a", borderRadius: "50%", margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
            <div style={{ fontSize: "14px", color: "#1a1a1a", fontWeight: 600, marginBottom: "6px" }}>
              {loadingSlipId ? "Loading slip…" : fetchingPackable ? "Checking forecasts…" : "Searching…"}
            </div>
            <div style={{ fontSize: "12px", color: "#6d7175" }}>
              {loadingSlipId ? "Fetching order details" : fetchingPackable ? "Fetching weather for all ship-to addresses" : "Filtering orders"}
            </div>
          </div>
        </div>
      )}
      {showPackableModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200000 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowPackableModal(false); }}
        >
          <div style={{ background: "#fff", borderRadius: "12px", padding: "28px 32px", width: "420px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: "17px", fontWeight: 700, marginBottom: "6px" }}>Find shippable orders</div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "24px" }}>Set the ship date for an accurate weather forecast, and optionally ignore older orders.</div>

            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
              Ship date
            </label>
            <input
              type="date"
              value={modalShipDate}
              onChange={(e) => setModalShipDate(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #c4cdd5", borderRadius: "6px", fontSize: "14px", marginBottom: "20px", boxSizing: "border-box" }}
            />

            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
              Ignore orders placed before <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
            </label>
            <input
              type="datetime-local"
              value={modalOrderCutoff}
              onChange={(e) => setModalOrderCutoff(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #c4cdd5", borderRadius: "6px", fontSize: "14px", marginBottom: "28px", boxSizing: "border-box" }}
            />

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              {packableFilter && (
                <button
                  type="button"
                  onClick={() => { clearPackableFilter(); setShowPackableModal(false); }}
                  style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "9px 16px", cursor: "pointer", fontSize: "13px", color: "#d72c0d" }}
                >
                  Clear filter
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPackableModal(false)}
                style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "9px 16px", cursor: "pointer", fontSize: "13px" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => runPackableCheck(modalShipDate, modalOrderCutoff)}
                disabled={!modalShipDate}
                style={{ background: "#007a5a", color: "#fff", border: "none", borderRadius: "6px", padding: "9px 18px", cursor: modalShipDate ? "pointer" : "default", fontSize: "13px", fontWeight: 600, opacity: modalShipDate ? 1 : 0.5 }}
              >
                Find shippable orders
              </button>
            </div>
          </div>
        </div>
      )}
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
              {filteredOrders.length}{(q || packableFilter) ? ` of ${orders.length}` : ""} unfulfilled order{filteredOrders.length !== 1 ? "s" : ""}
            </Text>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <button
                type="button"
                onClick={() => setShowPackableModal(true)}
                disabled={fetchingPackable}
                style={{
                  background: packableFilter ? "#007a5a" : "none",
                  border: packableFilter ? "1px solid #007a5a" : "1px solid #c4cdd5",
                  borderRight: packableFilter ? "1px solid rgba(255,255,255,0.3)" : undefined,
                  borderTopRightRadius: packableFilter ? 0 : "6px",
                  borderBottomRightRadius: packableFilter ? 0 : "6px",
                  borderTopLeftRadius: "6px",
                  borderBottomLeftRadius: "6px",
                  color: packableFilter ? "#fff" : "#1a1a1a",
                  padding: "8px 14px",
                  cursor: fetchingPackable ? "default" : "pointer",
                  fontSize: "13px",
                  fontWeight: packableFilter ? 600 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                {packableFilter
                  ? `✅ Shippable (${packableCount})`
                  : "📦 Find shippable orders"}
              </button>
              {packableFilter && (
                <button
                  type="button"
                  onClick={clearPackableFilter}
                  title="Clear filter"
                  style={{
                    background: "#007a5a",
                    border: "1px solid #007a5a",
                    borderLeft: "1px solid rgba(255,255,255,0.3)",
                    borderTopRightRadius: "6px",
                    borderBottomRightRadius: "6px",
                    color: "#fff",
                    padding: "8px 10px",
                    cursor: "pointer",
                    fontSize: "13px",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {blockedOrders.length > 0 && (
              <button
                type="button"
                onClick={printHoldList}
                style={{
                  background: "none",
                  border: "1px solid #c4cdd5",
                  borderRadius: "6px",
                  padding: "8px 14px",
                  cursor: "pointer",
                  fontSize: "13px",
                  whiteSpace: "nowrap",
                  color: "#c00",
                }}
              >
                {`🖨 Hold list (${blockedOrders.length})`}
              </button>
            )}
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
                    if (toPrint.length > 0) window.open(`/app/print-batch?ids=${toPrint.map(o => o.id).join(",")}&shipDate=${encodeURIComponent(activeShipDate)}`, "_blank");
                  }}
                  style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 18px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
                >
                  {`🖨 Print ${selected.size} slip${selected.size !== 1 ? "s" : ""}`}
                </button>
              </>
            )}
          </div>
        </InlineStack>

        {filteredOrders.length === 0 ? (
          <Card>
            <Box padding="400">
              <Text as="p" variant="bodyMd" tone="subdued">
                {packableFilter
                  ? "No orders are shippable — all destinations have a weather hold or weekend delivery conflict."
                  : q
                    ? "No orders match your search."
                    : "No unfulfilled orders."}
              </Text>
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
                  </tr>
                </thead>
                <tbody>
                  {pageOrders.map((order, i) => (
                    <tr
                      key={order.id}
                      style={{
                        background: selected.has(order.id) ? "#edf4ff" : order.isLocal ? "#fffbf0" : i % 2 === 0 ? "#fff" : "#fafafa",
                        cursor: "default",
                      }}
                    >
                      <td
                        style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5", width: 40, cursor: "pointer" }}
                        onClick={() => toggle(order.id)}
                      >
                        <input type="checkbox" checked={selected.has(order.id)} onChange={() => toggle(order.id)} style={{ cursor: "pointer", pointerEvents: "none" }} />
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5", fontWeight: 600, color: "#005bd3", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <a
                            href={shopDomain ? `https://${shopDomain}/admin/orders/${order.id}` : undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#005bd3", textDecoration: "none", fontWeight: 600 }}
                          >
                            {order.name}
                          </a>
                          {order.isLocal && (
                            <span style={{ background: "#fff3cd", border: "1px solid #f0a500", borderRadius: "4px", padding: "1px 6px", fontSize: "10px", fontWeight: 800, color: "#7d4e00", letterSpacing: "0.05em", pointerEvents: "none" }}>
                              LOCAL
                            </span>
                          )}
                        </span>
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5", pointerEvents: "none" }}>{order.customerName}</td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5", color: "#6d7175", pointerEvents: "none" }}>
                        {order.isLocal
                          ? <em>Local — no shipment</em>
                          : [order.city, order.province, order.zip].filter(Boolean).join(", ")}
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5", pointerEvents: "none" }}>
                        {order.isLocal ? (
                          <span style={{ background: "#fff3cd", border: "1px solid #f0a500", borderRadius: "4px", padding: "2px 7px", fontSize: "11px", fontWeight: 700, color: "#7d4e00" }}>
                            {/^\d+\s/.test(order.shippingMethod) ? "Local Order" : order.shippingMethod}
                          </span>
                        ) : order.shippingMethod}
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <span style={{ pointerEvents: "none" }}><Badge>{order.fulfillmentStatus}</Badge></span>
                          <button
                            type="button"
                            onClick={() => {
                              flushSync(() => setLoadingSlipId(order.id));
                              navigate(`/app/slip/${order.id}?ids=${filteredOrders.map(o => o.id).join(",")}&i=${pageStart + i}&shipDate=${encodeURIComponent(activeShipDate)}`);
                            }}
                            style={{ background: "none", border: "none", color: "#005bd3", fontSize: "12px", cursor: "pointer", padding: 0, fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}
                          >
                            View slip →
                          </button>
                        </div>
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
                    onClick={() => { if (page > 0) setPage(p => p - 1); }}
                    disabled={page === 0}
                    style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "5px 14px", cursor: page === 0 ? "default" : "pointer", fontSize: "13px", opacity: page === 0 ? 0.4 : 1 }}
                  >
                    ‹ Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (page < totalPages - 1) setPage(p => p + 1); }}
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
    </>
  );
}
