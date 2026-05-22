import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { shopifyGraphQL } from "../admin-api.server";
import { getMaxTempF, addBusinessDays, toDateString } from "../weather.server";
import { getTransitDays } from "../transit.server";
import { getAlert } from "../alert";
import prisma from "../db.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const orderId = params.id!;
  const gid = `gid://shopify/Order/${orderId}`;

  const data = await shopifyGraphQL(
    `query getOrder($id: ID!) {
      order(id: $id) {
        id name createdAt note displayFulfillmentStatus
        customer { firstName lastName email }
        shippingAddress {
          firstName lastName
          address1 address2
          city province zip country
        }
        shippingLine { title }
        lineItems(first: 50) {
          edges { node { title quantity variant { title sku } } }
        }
        totalPriceSet { presentmentMoney { amount currencyCode } }
        subtotalPriceSet { presentmentMoney { amount currencyCode } }
        totalShippingPriceSet { presentmentMoney { amount currencyCode } }
        totalTaxSet { presentmentMoney { amount currencyCode } }
      }
    }`,
    { id: gid },
  );

  const o = data.data?.order;
  if (!o) throw new Response("Order not found", { status: 404 });

  const zip = o.shippingAddress?.zip ?? "";
  const shippingMethod = o.shippingLine?.title ?? "";
  const transitDays = await getTransitDays(shippingMethod);
  const deliveryDate = addBusinessDays(new Date(), transitDays);
  const deliveryDateStr = toDateString(deliveryDate);

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  let maxTempF: number | null = null;
  let forecastOutOfRange = false;

  const daysUntilDelivery = transitDays;
  if (daysUntilDelivery > 5) {
    forecastOutOfRange = true;
  } else {
    maxTempF = await getMaxTempF(zip, deliveryDateStr);
  }

  const alert = getAlert(maxTempF, settings.dontShipAbove, settings.icePackAbove);

  const lineItems = (o.lineItems?.edges ?? []).map((e: any) => ({
    title: e.node.title,
    variant: e.node.variant?.title && e.node.variant.title !== "Default Title" ? e.node.variant.title : null,
    sku: e.node.variant?.sku ?? null,
    quantity: e.node.quantity,
  }));

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
    order: {
      id: orderId,
      name: o.name,
      createdAt: new Date(o.createdAt).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      }),
      note: o.note ?? null,
      fulfillmentStatus: o.displayFulfillmentStatus,
      customerEmail: o.customer?.email ?? null,
      shippingAddress,
      shippingMethod,
      lineItems,
      subtotal: fmt(o.subtotalPriceSet),
      shipping: fmt(o.totalShippingPriceSet),
      tax: fmt(o.totalTaxSet),
      total: fmt(o.totalPriceSet),
    },
    weather: {
      maxTempF,
      deliveryDate: deliveryDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      deliveryDateStr,
      transitDays,
      forecastOutOfRange,
    },
    alert,
  });
};

const ALERT_ICON: Record<string, string> = {
  danger: "⛔",
  caution: "⚠️",
  safe: "✅",
  unknown: "❓",
};

export default function PackingSlip() {
  const { order, weather, alert } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .slip { box-shadow: none !important; max-width: none !important; margin: 0 !important; padding: 24px !important; }
        }
        body { background: #f6f6f7; font-family: Inter, system-ui, sans-serif; margin: 0; }
      `}</style>

      {/* Toolbar */}
      <div className="no-print" style={{ background: "#fff", borderBottom: "1px solid #e1e3e5", padding: "12px 24px", display: "flex", gap: "12px", alignItems: "center" }}>
        <button onClick={() => navigate("/app")} style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "6px 14px", cursor: "pointer", fontSize: "13px" }}>
          ← Back
        </button>
        <button onClick={() => window.print()} style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 18px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
          Print
        </button>
        <span style={{ fontSize: "13px", color: "#6d7175" }}>Estimated delivery: <strong>{weather.deliveryDate}</strong> ({weather.transitDays} business day{weather.transitDays !== 1 ? "s" : ""})</span>
      </div>

      {/* Slip */}
      <div className="slip" style={{ maxWidth: "760px", margin: "32px auto", background: "#fff", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", padding: "40px" }}>

        {/* Weather Alert Banner */}
        <div style={{ background: alert.bg, border: `2px solid ${alert.color}`, borderRadius: "8px", padding: "16px 20px", marginBottom: "32px" }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: alert.color, marginBottom: "6px" }}>
            {ALERT_ICON[alert.level]} {alert.headline}
          </div>
          <div style={{ fontSize: "13px", color: "#444", lineHeight: 1.5 }}>
            {alert.body}
            {weather.forecastOutOfRange && (
              <span style={{ marginLeft: "8px", color: "#6d7175" }}>(Delivery is {weather.transitDays} days away — beyond the 5-day forecast window.)</span>
            )}
          </div>
          <div style={{ marginTop: "8px", fontSize: "12px", color: "#6d7175" }}>
            Estimated delivery: {weather.deliveryDate} · {weather.transitDays} business day{weather.transitDays !== 1 ? "s" : ""} via {order.shippingMethod || "—"}
          </div>
        </div>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div>
            <div style={{ fontSize: "22px", fontWeight: 700, marginBottom: "4px" }}>Packing Slip</div>
            <div style={{ fontSize: "14px", color: "#6d7175" }}>{order.createdAt}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "20px", fontWeight: 700 }}>{order.name}</div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>{order.fulfillmentStatus}</div>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "0 0 24px" }} />

        {/* Ship To */}
        <div style={{ marginBottom: "28px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Ship to</div>
          {order.shippingAddress ? (
            <div style={{ fontSize: "14px", lineHeight: 1.7 }}>
              <div style={{ fontWeight: 600 }}>{order.shippingAddress.name}</div>
              <div>{order.shippingAddress.address1}</div>
              {order.shippingAddress.address2 && <div>{order.shippingAddress.address2}</div>}
              <div>{[order.shippingAddress.city, order.shippingAddress.province, order.shippingAddress.zip].filter(Boolean).join(", ")}</div>
              <div>{order.shippingAddress.country}</div>
              {order.customerEmail && <div style={{ color: "#6d7175", marginTop: "4px" }}>{order.customerEmail}</div>}
            </div>
          ) : (
            <div style={{ color: "#6d7175", fontSize: "14px" }}>No shipping address</div>
          )}
          <div style={{ marginTop: "10px", fontSize: "13px", color: "#444" }}>
            <span style={{ fontWeight: 600 }}>Shipping method:</span> {order.shippingMethod || "—"}
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "0 0 24px" }} />

        {/* Items */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", marginBottom: "24px" }}>
          <thead>
            <tr style={{ background: "#f6f6f7" }}>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#6d7175", borderBottom: "1px solid #e1e3e5" }}>Item</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#6d7175", borderBottom: "1px solid #e1e3e5" }}>SKU</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "#6d7175", borderBottom: "1px solid #e1e3e5" }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {order.lineItems.map((item, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ fontWeight: 500 }}>{item.title}</div>
                  {item.variant && <div style={{ color: "#6d7175", fontSize: "12px" }}>{item.variant}</div>}
                </td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", color: "#6d7175" }}>{item.sku || "—"}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right", fontWeight: 600 }}>{item.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "24px" }}>
          <div style={{ minWidth: "220px", fontSize: "13px" }}>
            {order.subtotal && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ color: "#6d7175" }}>Subtotal</span><span>{order.subtotal}</span>
              </div>
            )}
            {order.shipping && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ color: "#6d7175" }}>Shipping</span><span>{order.shipping}</span>
              </div>
            )}
            {order.tax && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ color: "#6d7175" }}>Tax</span><span>{order.tax}</span>
              </div>
            )}
            {order.total && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 4px", borderTop: "1px solid #e1e3e5", fontWeight: 700, fontSize: "14px" }}>
                <span>Total</span><span>{order.total}</span>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        {order.note && (
          <>
            <hr style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "0 0 20px" }} />
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Order notes</div>
              <div style={{ fontSize: "13px", color: "#444", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{order.note}</div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
