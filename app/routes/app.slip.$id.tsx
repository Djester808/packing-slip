import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { shopifyGraphQL } from "../admin-api.server";
import { getShopMeta } from "../shop.server";
import { getTempRange, addBusinessDays, toDateString, nextShipDate } from "../weather.server";
import { getTransitDays } from "../transit.server";
import { getAlert } from "../alert";
import { getPackBadge, isLivestockCollection } from "../pack-badge";
import prisma from "../db.server";

function isLocalShipping(method: string) {
  return /local|pickup|pick.?up/i.test(method) ||
    /^\d+\s+\S.*\b(rd|st|ave|blvd|dr|ln|way|ct|pl|hwy|pkwy|drive|street|avenue|road|lane|court)\b/i.test(method);
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const orderId = params.id!;
  const url = new URL(request.url);
  const navIds = url.searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  const navIndex = parseInt(url.searchParams.get("i") ?? "-1", 10);
  const gid = `gid://shopify/Order/${orderId}`;

  // Wave 1: order data + shop metadata in parallel (shop meta is in-memory cached after first hit)
  const [data, shopMeta] = await Promise.all([
    shopifyGraphQL(
      `query getOrder($id: ID!) {
        order(id: $id) {
          id name createdAt note tags displayFulfillmentStatus
          customer { firstName lastName email }
          shippingAddress {
            firstName lastName
            address1 address2
            city province zip country
          }
          shippingLine { title }
          lineItems(first: 50) {
            edges { node { title quantity currentQuantity
              product { collections(first: 25) { edges { node { handle title } } } }
              variant { title sku image { url } product { featuredImage { url } } } } }
          }
          totalPriceSet { presentmentMoney { amount currencyCode } }
          subtotalPriceSet { presentmentMoney { amount currencyCode } }
          totalShippingPriceSet { presentmentMoney { amount currencyCode } }
          totalTaxSet { presentmentMoney { amount currencyCode } }
        }
      }`,
      { id: gid },
    ),
    getShopMeta(),
  ]);

  const o = data.data?.order;
  if (!o) throw new Response("Order not found", { status: 404 });

  const customerEmail = o.customer?.email ?? null;
  const zip = o.shippingAddress?.zip ?? "";
  const shippingMethod = o.shippingLine?.title ?? "";
  const isLocal = isLocalShipping(shippingMethod);
  const shipDateParam = url.searchParams.get("shipDate");
  const shipDate = shipDateParam ? new Date(shipDateParam) : nextShipDate().date;
  // Set when the order was rolled forward to a later ship day than the one chosen.
  const rolled = url.searchParams.get("rolled") === "1";

  // Wave 2: transit days, app settings, and other-orders lookup all in parallel
  const [transitDays, settings, otherOrdersRaw] = await Promise.all([
    getTransitDays(
      shippingMethod,
      isLocal ? undefined : zip,
      shipDate,
      isLocal ? undefined : (o.shippingAddress?.province ?? undefined),
      isLocal ? undefined : (o.shippingAddress?.city ?? undefined),
    ),
    prisma.appSettings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } }),
    customerEmail
      ? shopifyGraphQL(
          `query getOtherOrders($q: String!) {
            orders(first: 20, query: $q) {
              edges { node { id name } }
            }
          }`,
          { q: `email:"${customerEmail}" fulfillment_status:unfulfilled` },
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  const otherOrders: Array<{ id: string; name: string }> = (otherOrdersRaw?.data?.orders?.edges ?? [])
    .map((e: any) => ({ id: e.node.id.split("/").pop(), name: e.node.name }))
    .filter((r: any) => r.id !== orderId);

  const shopName = shopMeta.name;
  const shopLogoUrl = shopMeta.logoUrl;
  const shopDomain = shopMeta.domain;

  const deliveryDate = addBusinessDays(shipDate, transitDays);
  const deliveryDateStr = toDateString(deliveryDate);

  let maxTempF: number | null = null;
  let minTempF: number | null = null;
  let forecastOutOfRange = false;

  if (!isLocal && zip) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const calendarDays = Math.ceil(
      (deliveryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (calendarDays > 14) {
      forecastOutOfRange = true;
    } else {
      ({ maxTempF, minTempF } = await getTempRange(zip, deliveryDateStr));
    }
  }

  const alert = isLocal ? null : getAlert(maxTempF, minTempF, settings.dontShipAbove, settings.icePackAbove, settings.dontShipBelow, settings.cautionBelow, settings.heatHoldAbove);

  const lineItems = (o.lineItems?.edges ?? [])
    .filter((e: any) => !/^tip$/i.test(e.node.title?.trim()))
    .filter((e: any) => (e.node.currentQuantity ?? e.node.quantity) > 0)
    .map((e: any) => ({
      title: e.node.title,
      variant: e.node.variant?.title && e.node.variant.title !== "Default Title" ? e.node.variant.title : null,
      imageUrl: e.node.variant?.image?.url ?? e.node.variant?.product?.featuredImage?.url ?? null,
      quantity: e.node.currentQuantity ?? e.node.quantity,
      isFish: isLivestockCollection((e.node.product?.collections?.edges ?? []).map((c: any) => c.node)),
    }))
    .reduce((acc: any[], item: any) => {
      const existing = acc.find((i) => i.title === item.title && i.variant === item.variant);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        acc.push(item);
      }
      return acc;
    }, []);

  const addr = o.shippingAddress;
  const shippingAddress = addr
    ? {
        name: [addr.firstName, addr.lastName].filter(Boolean).join(" "),
        address1: addr.address1 ?? "",
        address2: addr.address2 ?? "",
        city: addr.city ?? "",
        province: addr.province ?? "",
        zip: addr.zip ?? "",
        country: addr.country ?? "",
      }
    : null;

  const fmt = (set: any) =>
    set?.presentmentMoney ? `${set.presentmentMoney.amount} ${set.presentmentMoney.currencyCode}` : null;

  return json({
    shopLogoUrl,
    shopName,
    order: {
      id: orderId,
      name: o.name,
      createdAt: new Date(o.createdAt).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      }),
      note: o.note ?? null,
      fulfillmentStatus: o.displayFulfillmentStatus,
      customerEmail,
      shippingAddress,
      customerName: o.customer ? `${o.customer.firstName ?? ""} ${o.customer.lastName ?? ""}`.trim() : null,
      shippingMethod,
      isLocal,
      isReship: /reship/i.test(shippingMethod),
      lineItems,
      subtotal: fmt(o.subtotalPriceSet),
      shipping: fmt(o.totalShippingPriceSet),
      tax: fmt(o.totalTaxSet),
      total: fmt(o.totalPriceSet),
    },
    otherOrders,
    shipDate: shipDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    nav: navIds.length > 1 && navIndex >= 0 ? { ids: navIds, index: navIndex } : null,
    weather: isLocal ? null : {
      maxTempF,
      deliveryDate: deliveryDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      transitDays,
      forecastOutOfRange,
      crossesWeekend: (() => {
        const daysToFriday = 5 - shipDate.getDay();
        const friday = new Date(shipDate);
        friday.setDate(shipDate.getDate() + daysToFriday);
        return deliveryDate > friday;
      })(),
    },
    alert,
    rolled,
    shopDomain,
  });
};

const ALERT_ICON: Record<string, string> = {
  danger: "⛔", caution: "⚠️", insulated: "📦", safe: "✅", unknown: "❓",
};

export default function PackingSlip() {
  const { order, weather, alert, shopLogoUrl, shopName, nav, otherOrders, shipDate, rolled, shopDomain } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading" && navigation.location?.pathname.startsWith("/app/slip");
  // A rolled-over or "do not ship" order shows ONLY that banner — suppress the rest.
  const doNotShip = rolled || weather?.crossesWeekend === true;
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const toggleCheck = (i: number) => setChecked((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <>
      <style>{`
        @page { size: letter portrait; margin: 0; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0 !important; }
          .slip {
            box-shadow: none !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 10mm !important;
            border-radius: 0 !important;
            font-size: 11px !important;
            page-break-after: always !important;
          }
          .slip:last-child { page-break-after: avoid !important; }
          .slip table { font-size: 10px !important; }
          .slip table td { padding: 5px 8px !important; }
          .slip img { width: 40px !important; height: 40px !important; }
          .slip table tbody tr { page-break-inside: avoid !important; break-inside: avoid !important; }
          /* Banners print legibly in black & white: dark text, white fill, solid black border */
          .slip-banner { background: #fff !important; border: 1.5pt solid #000 !important; }
          .slip-banner, .slip-banner * { color: #000 !important; }
          .slip-banner--strong { border-width: 3pt !important; }
        }
        body { background: #f6f6f7; font-family: Inter, system-ui, sans-serif; margin: 0; }
      `}</style>

      {isLoading && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(255, 255, 255, 0.95)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: "48px", height: "48px", border: "3px solid #e1e3e5", borderTop: "3px solid #007a5a", borderRadius: "50%", margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
            <div style={{ fontSize: "14px", color: "#1a1a1a", fontWeight: 600, marginBottom: "6px" }}>Loading packing slip…</div>
            <div style={{ fontSize: "12px", color: "#6d7175" }}>Fetching order details and weather</div>
          </div>
        </div>
      )}

      <div className="no-print" style={{ background: "#fff", borderBottom: "1px solid #e1e3e5", padding: "12px 24px", display: "flex", gap: "12px", alignItems: "center" }}>
        <button type="button" onClick={() => navigate("/app")} style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "6px 14px", cursor: "pointer", fontSize: "13px" }}>← Back</button>
        {nav && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "#6d7175" }}>{nav.index + 1} / {nav.ids.length}</span>
            <button type="button" onClick={() => navigate(`/app/slip/${nav.ids[nav.index - 1]}?ids=${nav.ids.join(",")}&i=${nav.index - 1}`)} disabled={nav.index === 0} style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "6px 14px", cursor: nav.index === 0 ? "default" : "pointer", fontSize: "13px", opacity: nav.index === 0 ? 0.4 : 1 }}>‹ Prev</button>
            <button type="button" onClick={() => navigate(`/app/slip/${nav.ids[nav.index + 1]}?ids=${nav.ids.join(",")}&i=${nav.index + 1}`)} disabled={nav.index === nav.ids.length - 1} style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "6px 14px", cursor: nav.index === nav.ids.length - 1 ? "default" : "pointer", fontSize: "13px", opacity: nav.index === nav.ids.length - 1 ? 0.4 : 1 }}>Next ›</button>
          </div>
        )}
        <button type="button" onClick={() => window.open(`/app/print-batch?ids=${order.id}`, "_blank")} style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 18px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Print</button>
        {weather && (
          <span style={{ fontSize: "13px", color: "#6d7175" }}>
            Ships <strong>{shipDate}</strong> · Arrives <strong>{weather.deliveryDate}</strong>
          </span>
        )}
        {order.isLocal && (
          <span style={{ background: "#fff3cd", border: "1px solid #f0a500", borderRadius: "4px", padding: "3px 10px", fontSize: "12px", fontWeight: 700, color: "#7d4e00" }}>
            LOCAL ORDER — NO SHIPMENT
          </span>
        )}
      </div>

      <div className="slip" style={{ maxWidth: "760px", margin: "32px auto", background: "#fff", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", padding: "40px" }}>

        {rolled && (
          <div className="slip-banner slip-banner--strong" style={{ background: "#ffd7d5", border: "2px solid #d72c0d", borderRadius: "6px", padding: "12px 14px", marginBottom: "14px" }}>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "#d72c0d", letterSpacing: "0.02em" }}>🚫 DO NOT SHIP UNTIL {shipDate}</div>
            <div style={{ fontSize: "12px", color: "#7a1a0a", marginTop: "2px" }}>
              Rolled forward from the earlier ship day — hold this order until {shipDate}.
            </div>
          </div>
        )}

        {!doNotShip && order.isReship && (
          <div className="slip-banner" style={{ background: "#5c007a", borderRadius: "6px", padding: "8px 14px", marginBottom: "14px" }}>
            <span style={{ fontSize: "12px", fontWeight: 800, color: "#fff", letterSpacing: "0.06em" }}>🔄 RESHIP — Verify original order before packing</span>
          </div>
        )}

        {!rolled && weather?.crossesWeekend && (
          <div className="slip-banner slip-banner--strong" style={{ background: "#ffd7d5", border: "1px solid #d72c0d", borderRadius: "6px", padding: "10px 14px", marginBottom: "12px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#d72c0d" }}>🚫 DO NOT SHIP — ARRIVES NEXT WEEK</div>
            <div style={{ fontSize: "12px", color: "#7a1a0a", marginTop: "2px" }}>
              Delivery est. <strong>{weather.deliveryDate}</strong> — holds over the weekend.
            </div>
          </div>
        )}

        {/* Always shown (even on do-not-ship/rolled orders) — combining matters most when holding */}
        {otherOrders.length > 0 && (
          <div className="slip-banner" style={{ background: "#fff0f0", border: "1px solid #d72c0d", borderRadius: "6px", padding: "10px 14px", marginBottom: "12px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#d72c0d" }}>
              ⚠️ {otherOrders.length} other unfulfilled order{otherOrders.length !== 1 ? "s" : ""} from this customer
            </div>
            <div style={{ fontSize: "12px", color: "#7a1a0a", marginTop: "2px" }}>
              {otherOrders.map((o) => o.name).join(", ")} — consider combining
            </div>
          </div>
        )}

        {!doNotShip && order.isLocal && (
          <div className="slip-banner" style={{ background: "#fff3cd", border: "1px solid #f0a500", borderRadius: "6px", padding: "10px 14px", marginBottom: "14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#7d4e00" }}>📦 LOCAL ORDER — no weather check needed</div>
          </div>
        )}

        {!doNotShip && weather && alert && (
          <div className={`slip-banner ${alert.level === "danger" ? "slip-banner--strong" : ""}`} style={{ background: alert.bg, border: `1px solid ${alert.color}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: alert.color }}>
              {ALERT_ICON[alert.level]} {alert.headline}
            </div>
            <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>
              Ships: {shipDate} · Arrives: {weather.deliveryDate} · {weather.transitDays} day{weather.transitDays !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {shopLogoUrl && (
              <img src={shopLogoUrl} alt={shopName ?? ""} style={{ height: "52px", width: "auto", objectFit: "contain" }} />
            )}
            <div>
              <div style={{ fontSize: "20px", fontWeight: 700, marginBottom: "2px" }}>{shopName ?? "Store"}</div>
              <div style={{ fontSize: "14px", color: "#6d7175" }}>{order.createdAt}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
                  <a
                    href={shopDomain ? `https://${shopDomain}/admin/orders/${order.id}` : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      if (shopDomain) window.open(`https://${shopDomain}/admin/orders/${order.id}`, "_blank", "noopener,noreferrer");
                    }}
                    style={{ color: "#1a1a1a", textDecoration: "none", cursor: shopDomain ? "pointer" : "not-allowed" }}
                  >
                    <div style={{ fontSize: "20px", fontWeight: 700 }}>{order.name}</div>
                  </a>
              {order.isReship && <span style={{ background: "#4a0080", border: "1px solid #7c00cc", borderRadius: "4px", padding: "2px 7px", fontSize: "11px", fontWeight: 800, color: "#fff", letterSpacing: "0.04em" }}>RESHIP</span>}
              {order.isLocal && <span style={{ background: "#fff3cd", border: "1px solid #f0a500", borderRadius: "4px", padding: "2px 7px", fontSize: "11px", fontWeight: 800, color: "#7d4e00" }}>LOCAL</span>}
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>{order.fulfillmentStatus}</div>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "0 0 24px" }} />

        {/* Address + Shipping Method two-column */}
        <div style={{ display: "flex", gap: "32px", marginBottom: "28px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
              {order.isLocal ? "Pickup / Contact" : "Ship to"}
            </div>
            <div style={{ fontSize: "14px", lineHeight: 1.7 }}>
              {(order.shippingAddress?.name || order.customerName) && (
                <div style={{ fontWeight: 600 }}>{order.shippingAddress?.name || order.customerName}</div>
              )}
              {order.shippingAddress && !order.isLocal && (
                <>
                  <div>{order.shippingAddress.address1}</div>
                  {order.shippingAddress.address2 && <div>{order.shippingAddress.address2}</div>}
                  <div>{[order.shippingAddress.city, order.shippingAddress.province, order.shippingAddress.zip].filter(Boolean).join(", ")}</div>
                  <div>{order.shippingAddress.country}</div>
                </>
              )}
              {!order.shippingAddress && !order.customerName && (
                <div style={{ color: "#6d7175" }}>No address on file</div>
              )}
            </div>
          </div>
          <div style={{ minWidth: "180px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Shipping Method</div>
            <div style={{ fontSize: "14px", marginBottom: "12px" }}>
              {order.isLocal
                ? <span style={{ background: "#fff3cd", border: "1px solid #f0a500", borderRadius: "4px", padding: "2px 8px", fontSize: "13px", fontWeight: 700, color: "#7d4e00" }}>{/^\d+\s/.test(order.shippingMethod) ? "Local Order" : order.shippingMethod}</span>
                : <span style={{ color: "#444" }}>{order.shippingMethod || "—"}</span>
              }
            </div>
            {!order.isLocal && weather && (
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "12px" }}>
                <strong>{weather.transitDays}</strong> day{weather.transitDays !== 1 ? "s" : ""} in transit
              </div>
            )}
            {order.customerEmail && (
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Email</div>
                <div style={{ fontSize: "13px", color: "#6d7175" }}>{order.customerEmail}</div>
              </div>
            )}
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "0 0 24px" }} />

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", marginBottom: "24px" }}>
          <thead>
            <tr style={{ background: "#f6f6f7" }}>
              <th style={{ padding: "8px 12px", width: "36px", borderBottom: "1px solid #e1e3e5" }} />
              <th style={{ padding: "8px 12px", width: "76px", borderBottom: "1px solid #e1e3e5" }} />
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#6d7175", borderBottom: "1px solid #e1e3e5" }}>Item</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "#6d7175", borderBottom: "1px solid #e1e3e5" }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {order.lineItems.map((item, i) => (
              <tr key={i} style={{ background: checked.has(i) ? "#f0faf4" : i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", verticalAlign: "middle", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={checked.has(i)}
                    onChange={() => toggleCheck(i)}
                    style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#007a5a" }}
                  />
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", verticalAlign: "middle" }}>
                  {item.imageUrl
                    ? <img src={item.imageUrl} alt={item.title} style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "4px", border: "1px solid #e1e3e5", display: "block" }} />
                    : <div style={{ width: "64px", height: "64px", background: "#f0f0f0", borderRadius: "4px", border: "1px solid #e1e3e5" }} />
                  }
                </td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ fontWeight: 500, textDecoration: checked.has(i) ? "line-through" : "none", color: checked.has(i) ? "#6d7175" : "#202223" }}>{item.title}</div>
                  {item.variant && <div style={{ color: "#6d7175", fontSize: "12px" }}>{item.variant}</div>}
                </td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right", fontWeight: 600, verticalAlign: "middle" }}>
                  {item.quantity}
                  {(() => {
                    const badge = getPackBadge(item.variant, item.quantity, item.title, item.isFish);
                    if (!badge) return null;
                    return (
                      <div style={{ marginTop: "4px", display: "flex", justifyContent: "flex-end" }}>
                        <span style={{ background: badge.bg, color: "#fff", borderRadius: "4px", padding: "2px 7px", fontSize: "11px", fontWeight: 800, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                          {badge.text}
                        </span>
                      </div>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {order.note && (
          <>
            <hr style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "0 0 20px" }} />
            <div style={{ marginBottom: "28px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Order notes</div>
              <div style={{ fontSize: "13px", color: "#444", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{order.note}</div>
            </div>
          </>
        )}

        <hr style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "0 0 28px" }} />
        <div style={{ display: "flex", gap: "48px", alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "32px" }}>Packed by</div>
            <div style={{ borderBottom: "1px solid #333", paddingBottom: "4px" }} />
            <div style={{ fontSize: "11px", color: "#6d7175", marginTop: "6px" }}>Signature</div>
          </div>
        </div>
      </div>
    </>
  );
}
