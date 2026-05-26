import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState, useEffect } from "react";
import { shopifyGraphQL } from "../admin-api.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  if (ids.length === 0) throw new Response("No orders specified", { status: 400 });

  const [settings, shopNameData, shopBrandData] = await Promise.all([
    prisma.appSettings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } }),
    shopifyGraphQL(`query { shop { name } }`, {}).catch(() => null),
    shopifyGraphQL(`query { shop { brand { logo { image { url } } squareLogo { image { url } } } } }`, {}).catch(() => null),
  ]);

  return json({
    ids,
    shopName: shopNameData?.data?.shop?.name ?? null,
    shopLogoUrl: shopBrandData?.data?.shop?.brand?.logo?.image?.url
      ?? shopBrandData?.data?.shop?.brand?.squareLogo?.image?.url
      ?? null,
    dontShipAbove: settings.dontShipAbove,
    icePackAbove: settings.icePackAbove,
    printLocalOrders: settings.printLocalOrders,
  });
};

const ALERT_ICON: Record<string, string> = {
  danger: "⛔", caution: "⚠️", safe: "✅", unknown: "❓",
};

// "shrimp$" matches titles ending with "shrimp" (e.g. "Snowball Shrimp") but not "Baby Shrimp Food"
const LIVE_ANIMAL_RE = /shrimp$|snail|crayfish|crab|culls|skittles|\(s\s*grade\)/i;

function getPackBadge(variant: string | null, quantity: number, title: string): { text: string; bg: string } | null {
  // Named pack variants — always live animals, no title check needed
  if (variant) {
    if (/breeder\s*pack/i.test(variant) || /ultimate\s*pack/i.test(variant)) {
      const isUltimate = /ultimate\s*pack/i.test(variant);
      const total = 10 * quantity;
      const extras = Math.floor(total / 5);
      const males = 2 * quantity;
      const females = 8 * quantity;
      const label = isUltimate
        ? `ULTIMATE = ${total + extras} TOTAL (${males}M/${females}F)`
        : `= ${total + extras} TOTAL (${males}M/${females}F)`;
      return { text: label, bg: isUltimate ? "#5c007a" : "#007a5a" };
    }
  }

  // Skittles: check title too, since variant may be something like "Normal"
  if (/skittles/i.test(title) || (variant && /skittles\s*pack/i.test(variant))) {
    const total = 10 * quantity;
    const extras = Math.floor(total / 5);
    return { text: `= ${total + extras} TOTAL`, bg: "#b45309" };
  }

  // All other cases: only apply to live animal titles
  if (!LIVE_ANIMAL_RE.test(title)) return null;

  // Numeric variant → pack size × quantity
  if (variant) {
    const m = variant.match(/\b(\d+)\b/);
    if (m) {
      const count = parseInt(m[1], 10);
      if (count > 1) {
        const total = count * quantity;
        const extras = Math.floor(total / 5);
        return { text: `= ${total + extras} TOTAL`, bg: "#b45309" };
      }
    }
  }

  // No variant (or non-numeric variant) → always show total for transparency
  const extras = Math.floor(quantity / 5);
  return { text: `= ${quantity + extras} TOTAL`, bg: "#b45309" };
}

function SlipView({ slip, shopLogoUrl, shopName }: { slip: any; shopLogoUrl: string | null; shopName: string | null }) {
  const { order, weather, alert, shipDate } = slip;
  return (
    <div className="slip" style={{ maxWidth: "760px", margin: "32px auto", background: "#fff", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", padding: "40px" }}>

      {order.isReship && (
        <div style={{ background: "#5c007a", borderRadius: "6px", padding: "8px 14px", marginBottom: "14px" }}>
          <span style={{ fontSize: "12px", fontWeight: 800, color: "#fff", letterSpacing: "0.06em" }}>🔄 RESHIP — Verify original order before packing</span>
        </div>
      )}

      {weather?.crossesWeekend && (
        <div style={{ background: "#ffd7d5", border: "1px solid #d72c0d", borderRadius: "6px", padding: "10px 14px", marginBottom: "12px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#d72c0d" }}>🚫 DO NOT SHIP — ARRIVES NEXT WEEK</div>
          <div style={{ fontSize: "12px", color: "#7a1a0a", marginTop: "2px" }}>
            Delivery est. <strong>{weather.deliveryDate}</strong> — holds over the weekend.
          </div>
        </div>
      )}

      {order.isLocal && (
        <div style={{ background: "#fff3cd", border: "1px solid #f0a500", borderRadius: "6px", padding: "10px 14px", marginBottom: "14px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#7d4e00" }}>📦 LOCAL ORDER — no weather check needed</div>
        </div>
      )}

      {weather && alert && (
        <div style={{ background: alert.bg, border: `1px solid ${alert.color}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: alert.color }}>
            {ALERT_ICON[alert.level]} {alert.headline}
          </div>
          <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>
            Ships: {shipDate} · Arrives: {weather.deliveryDate} · {weather.transitDays} day{weather.transitDays !== 1 ? "s" : ""}
          </div>
        </div>
      )}

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
            <div style={{ fontSize: "20px", fontWeight: 700 }}>{order.name}</div>
            {order.isReship && <span style={{ background: "#4a0080", border: "1px solid #7c00cc", borderRadius: "4px", padding: "2px 7px", fontSize: "11px", fontWeight: 800, color: "#fff", letterSpacing: "0.04em" }}>RESHIP</span>}
            {order.isLocal && <span style={{ background: "#fff3cd", border: "1px solid #f0a500", borderRadius: "4px", padding: "2px 7px", fontSize: "11px", fontWeight: 800, color: "#7d4e00" }}>LOCAL</span>}
          </div>
          <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>{order.fulfillmentStatus}</div>
        </div>
      </div>

      <hr style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "0 0 24px" }} />

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
          {order.lineItems.map((item: any, i: number) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", verticalAlign: "middle", textAlign: "center" }}>
                <input type="checkbox" style={{ width: "16px", height: "16px", accentColor: "#007a5a" }} />
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", verticalAlign: "middle" }}>
                {item.imageUrl
                  ? <img src={item.imageUrl} alt={item.title} style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "4px", border: "1px solid #e1e3e5", display: "block" }} />
                  : <div style={{ width: "64px", height: "64px", background: "#f0f0f0", borderRadius: "4px", border: "1px solid #e1e3e5" }} />
                }
              </td>
              <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ fontWeight: 500, color: "#202223" }}>{item.title}</div>
                {item.variant && <div style={{ color: "#6d7175", fontSize: "12px" }}>{item.variant}</div>}
              </td>
              <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right", fontWeight: 600, verticalAlign: "middle" }}>
                {item.quantity}
                {(() => {
                  const badge = getPackBadge(item.variant, item.quantity, item.title);
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
  );
}

export default function PrintBatch() {
  const { ids, shopLogoUrl, shopName, printLocalOrders } = useLoaderData<typeof loader>();
  const [slips, setSlips] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(0);
  const done = loaded === ids.length;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const BATCH = 15;
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));

      const allSlips: any[] = [];
      await Promise.all(chunks.map(async (chunk) => {
        if (cancelled) return;
        try {
          const res = await fetch(`/api/slips?ids=${chunk.join(",")}`);
          if (res.ok && !cancelled) {
            const batch: any[] = await res.json();
            if (!cancelled) {
              batch.filter((s) => s && (printLocalOrders || !s.order.isLocal)).forEach((s) => allSlips.push(s));
            }
          }
        } catch {}
        if (!cancelled) setLoaded((n) => Math.min(n + chunk.length, ids.length));
      }));

      if (!cancelled) {
        const idOrder = new Map(ids.map((id, i) => [id, i]));
        setSlips(allSlips.sort((a, b) => (idOrder.get(a.order.id) ?? 0) - (idOrder.get(b.order.id) ?? 0)));
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <style>{`
        @page { size: letter portrait; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0 !important; }
          .slip {
            box-shadow: none !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 16mm !important;
            border-radius: 0 !important;
            font-size: 12px !important;
            page-break-after: always;
          }
          .slip:last-child { page-break-after: avoid; }
          .slip table { font-size: 11px !important; }
          .slip img { width: 48px !important; height: 48px !important; }
        }
        body { background: #f6f6f7; font-family: Inter, system-ui, sans-serif; margin: 0; }
      `}</style>

      <div className="no-print" style={{ background: "#fff", borderBottom: "1px solid #e1e3e5", padding: "12px 24px", display: "flex", gap: "12px", alignItems: "center" }}>
        <button type="button" onClick={() => window.history.back()} style={{ background: "none", border: "1px solid #c4cdd5", borderRadius: "6px", padding: "6px 14px", cursor: "pointer", fontSize: "13px" }}>← Back</button>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!done}
          style={{ background: done ? "#1a1a1a" : "#6d7175", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 18px", cursor: done ? "pointer" : "default", fontSize: "13px", fontWeight: 600 }}
        >
          🖨 Print all {slips.length} slip{slips.length !== 1 ? "s" : ""}
        </button>
        <span style={{ fontSize: "13px", color: "#6d7175" }}>
          {done ? `${slips.length} slips ready` : `Loading ${loaded} / ${ids.length}…`}
        </span>
      </div>

      {!done && (
        <div className="no-print" style={{ height: "4px", background: "#e1e3e5" }}>
          <div style={{ height: "100%", background: "#007a5a", width: `${(loaded / ids.length) * 100}%`, transition: "width 0.2s" }} />
        </div>
      )}

      {slips.map((slip) => (
        <SlipView key={slip.order.id} slip={slip} shopLogoUrl={shopLogoUrl} shopName={shopName} />
      ))}
    </>
  );
}
