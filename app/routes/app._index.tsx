import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import { Page, Card, Text, BlockStack, Box, Badge, InlineStack } from "@shopify/polaris";
import { shopifyGraphQL } from "../admin-api.server";
import { seedDefaultRulesIfEmpty } from "../transit.server";
import { nextShipDate } from "../weather.server";
import { isLiveAnimal } from "../pack-badge";
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

// Wednesday ships only 2-day/overnight service or dry goods. An order may roll
// forward onto the restricted Wednesday slot only if its method is fast service
// or it contains no live animals (isLiveAnimal shared with pack-badge).
const FAST_METHOD_RE = /overnight|next.?day|2.?day|2nd day|two.?day|express/i;
function isWednesdayEligible(slip: any): boolean {
  if (FAST_METHOD_RE.test(slip.order?.shippingMethod ?? "")) return true;
  const items: any[] = slip.order?.lineItems ?? [];
  return !items.some((li) => isLiveAnimal(li.title ?? "", li.isFish));
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
  const emailedOrders = await prisma.emailedOrder.findMany({});
  const emailedOrderIds = new Set(emailedOrders.map((e) => e.orderId));
  console.log(`[Index] Found ${emailedOrders.length} emailed orders:`, emailedOrders.map((e) => e.orderId));
  return json({ orders, printLocalOrders: settings.printLocalOrders, rolloverEnabled: settings.rolloverEnabled, shopDomain, defaultShipDate, emailedOrderIds: Array.from(emailedOrderIds) });
};

export default function Index() {
  const { orders, printLocalOrders, rolloverEnabled, shopDomain, defaultShipDate, emailedOrderIds } = useLoaderData<typeof loader>();
  const emailedSet = new Set(emailedOrderIds);
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
  const [blockedOrders, setBlockedOrders] = useState<Array<{ id: string; name: string; customerName: string; city: string; province: string; zip: string; createdAt: string; reason: string; transitDays?: number }>>([]);

  // Ship-date modal
  const [showPackableModal, setShowPackableModal] = useState(false);
  const [modalShipDate, setModalShipDate] = useState(defaultShipDate);
  const [modalOrderCutoff, setModalOrderCutoff] = useState("");
  const [activeShipDate, setActiveShipDate] = useState(defaultShipDate);
  // Per-order ship date (YYYY-MM-DD): the chosen day for orders that pass it, or a
  // later ship day for orders rolled forward. Drives the badge, View slip, and print.
  const [orderShipDates, setOrderShipDates] = useState<Record<string, string>>({});

  useEffect(() => {
    if (navigation.state === "idle") setLoadingSlipId(null);
  }, [navigation.state]);
  const searchTimer = useRef<number | null>(null);
  const [page, setPage] = useState(0);
  const [colWidths, setColWidths] = useState({ order: 110, date: 110, customer: 150, shipto: 180, method: 170, status: 120 });
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

    const BATCH = 50;

    // Run all checks for a set of ids against a single ship date. When
    // requireInRange is set (roll-forward candidates), a slip whose delivery is
    // beyond the forecast window does NOT count as shippable — we won't roll an
    // order onto a later date we can't actually validate the weather for.
    async function checkAgainst(ids: string[], date: string, requireInRange = false) {
      const passed = new Set<string>();
      const failedReason = new Map<string, string>();
      const transitDays = new Map<string, number>();
      const missing = new Set<string>();
      const wedEligible = new Map<string, boolean>();
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        try {
          const res = await fetch(`/api/slips?ids=${chunk.join(",")}&shipDate=${encodeURIComponent(date)}`);
          if (!res.ok) continue;
          const slips: any[] = await res.json();
          const returnedIds = new Set(slips.map((s: any) => s.order.id));
          for (const slip of slips) {
            if (!printLocalOrders && slip.order.isLocal) continue;
            wedEligible.set(slip.order.id, isWednesdayEligible(slip));
            if (slip.weather?.transitDays) {
              transitDays.set(slip.order.id, slip.weather.transitDays);
            }
            const isDanger = !slip.order.isAccessPoint && !slip.order.isReship && slip.alert?.level === "danger";
            const isWeekend = slip.weather?.crossesWeekend === true;
            const outOfRange = slip.weather?.forecastOutOfRange === true;
            if (!isDanger && !isWeekend && !(requireInRange && outOfRange)) {
              passed.add(slip.order.id);
            } else if (isDanger || isWeekend) {
              const reasons: string[] = [];
              if (isWeekend) reasons.push(`Too long in transit — would arrive after the weekend (est. ${slip.weather.deliveryDate})`);
              if (isDanger) reasons.push(`Weather — ${slip.alert.headline}`);
              failedReason.set(slip.order.id, reasons.join("; "));
            }
            // requireInRange && outOfRange && no danger/weekend: not passed and no
            // new reason — the caller keeps the order's existing held reason.
          }
          for (const id of chunk) {
            if (!returnedIds.has(id)) {
              const orderInfo = orders.find((o) => o.id === id);
              if (orderInfo && !orderInfo.isLocal) missing.add(id);
            }
          }
        } catch {}
      }
      return { passed, failedReason, transitDays, missing, wedEligible };
    }

    const allIds = eligibleOrders.map((o) => o.id);
    const shipDates: Record<string, string> = {};
    const allTransitDays = new Map<string, number>();
    const wedEligible = new Map<string, boolean>();

    // Pass 1: the chosen ship date.
    const p1 = await checkAgainst(allIds, shipDate);
    for (const [id, v] of p1.wedEligible) wedEligible.set(id, v);
    for (const [id, days] of p1.transitDays) allTransitDays.set(id, days);
    const safeIds = new Set<string>(p1.passed);
    for (const id of p1.passed) shipDates[id] = shipDate;

    const heldReason = new Map<string, string>(p1.failedReason);
    for (const id of p1.missing) heldReason.set(id, "Unable to check forecast — verify before shipping");

    // Roll the held orders forward through the upcoming ship days (this week's
    // remaining days, then next week) and ship each on the earliest that clears
    // both the weather and the weekend/transit check. Wednesday is offered only to
    // eligible orders; weekend-stuck orders typically clear on a next-week Monday.
    let rollDays: Array<{ date: string; restricted: boolean }> = [];
    if (rolloverEnabled && heldReason.size > 0) {
      try {
        const r = await fetch(`/api/ship-days?after=${encodeURIComponent(shipDate)}`);
        if (r.ok) rollDays = (await r.json()).days ?? [];
      } catch {}
    }

    for (const { date, restricted } of rollDays) {
      if (heldReason.size === 0) break;
      const candidates = restricted
        ? [...heldReason.keys()].filter((id) => wedEligible.get(id))
        : [...heldReason.keys()];
      if (candidates.length === 0) continue;
      const pass = await checkAgainst(candidates, date, true);
      for (const [id, v] of pass.wedEligible) wedEligible.set(id, v);
      for (const [id, days] of pass.transitDays) allTransitDays.set(id, days);
      for (const id of pass.passed) {
        safeIds.add(id);
        shipDates[id] = date;
        heldReason.delete(id);
      }
    }

    // Whatever remains couldn't ship on any eligible day.
    const held = [...heldReason.entries()].map(([id, reason]) => {
      const orderInfo = orders.find((o) => o.id === id);
      return {
        id,
        name: orderInfo?.name ?? "",
        customerName: orderInfo?.customerName ?? "",
        city: orderInfo?.city ?? "",
        province: orderInfo?.province ?? "",
        zip: orderInfo?.zip ?? "",
        createdAt: orderInfo?.createdAt ?? "",
        reason,
        transitDays: allTransitDays.get(id),
      };
    });

    setPackableIds(safeIds);
    setOrderShipDates(shipDates);
    setBlockedOrders(held);
    setPackableFilter(true);
    setActiveShipDate(shipDate);
    setPage(0);
    setFetchingPackable(false);
  }

  function printHoldList() {
    const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const rows = blockedOrders
      .map((o) => {
        const checkmark = emailedSet.has(o.id) ? '<span style="color:#2d9900;font-weight:bold;margin-right:8px;">✓</span>' : '';
        const transitDaysStr = o.transitDays ? `${o.transitDays} day${o.transitDays !== 1 ? 's' : ''}` : '—';
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;font-weight:600;">${checkmark}${shopDomain ? `<a href="https://${shopDomain}/admin/orders/${o.id}" target="_blank" rel="noopener noreferrer" style="color:#005bd3;text-decoration:none;">${o.name}</a>` : o.name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">${o.customerName}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;color:#6d7175;">${[o.city, o.province, o.zip].filter(Boolean).join(", ")}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;color:#6d7175;white-space:nowrap;">${o.createdAt}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;color:#6d7175;font-weight:600;">${transitDaysStr}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;color:#c00;font-weight:600;">${o.reason}</td>
        </tr>`;
      })
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
    <thead><tr><th>Order</th><th>Customer</th><th>Ship to</th><th>Order date</th><th>Shipping speed</th><th>Reason</th></tr></thead>
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
    setOrderShipDates({});
  }

  // Format a YYYY-MM-DD ship date as e.g. "Wed, Jun 17" (UTC to avoid tz drift).
  function formatShipDay(dateStr: string) {
    return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
    });
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
                    if (toPrint.length > 0) {
                      // Orders rolled forward to a later ship day print with that date.
                      const overrides = toPrint
                        .filter(o => orderShipDates[o.id] && orderShipDates[o.id] !== activeShipDate)
                        .map(o => `${o.id}:${orderShipDates[o.id]}`);
                      const sd = overrides.length > 0 ? `&shipDates=${encodeURIComponent(overrides.join(","))}` : "";
                      window.open(`/app/print-batch?ids=${toPrint.map(o => o.id).join(",")}&shipDate=${encodeURIComponent(activeShipDate)}${sd}`, "_blank");
                    }
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
                      { col: "date", label: "Order date" },
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
                          {emailedSet.has(order.id) && (
                            <span title="Weather delay email sent" style={{ fontSize: "16px", color: "#2d9900", fontWeight: "bold" }}>✓</span>
                          )}
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
                          {orderShipDates[order.id] && orderShipDates[order.id] !== activeShipDate && (
                            <span
                              title={`Held for ${formatShipDay(activeShipDate)} — ships ${formatShipDay(orderShipDates[order.id])}`}
                              style={{ background: "#e3f1df", border: "1px solid #007a5a", borderRadius: "4px", padding: "1px 6px", fontSize: "10px", fontWeight: 800, color: "#0a5c3e", letterSpacing: "0.03em", pointerEvents: "none", whiteSpace: "nowrap" }}
                            >
                              SHIPS {formatShipDay(orderShipDates[order.id]).toUpperCase()}
                            </span>
                          )}
                        </span>
                      </td>
                      <td style={{ padding: "12px 14px", borderBottom: "1px solid #e1e3e5", color: "#6d7175", whiteSpace: "nowrap", pointerEvents: "none" }}>{order.createdAt}</td>
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
                              const rolled = orderShipDates[order.id] && orderShipDates[order.id] !== activeShipDate ? "&rolled=1" : "";
                              navigate(`/app/slip/${order.id}?ids=${filteredOrders.map(o => o.id).join(",")}&i=${pageStart + i}&shipDate=${encodeURIComponent(orderShipDates[order.id] ?? activeShipDate)}${rolled}`);
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
