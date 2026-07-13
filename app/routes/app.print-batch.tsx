import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState, useEffect } from "react";
import { shopifyGraphQL } from "../admin-api.server";
import { getPackBadge } from "../pack-badge";
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

  const shipDate = url.searchParams.get("shipDate") ?? null;
  // Per-order ship-date overrides for orders rolled forward to a later ship day,
  // encoded as "id:YYYY-MM-DD,id:YYYY-MM-DD".
  const shipDateOverrides: Record<string, string> = {};
  for (const pair of url.searchParams.get("shipDates")?.split(",").filter(Boolean) ?? []) {
    const [id, date] = pair.split(":");
    if (id && date) shipDateOverrides[id] = date;
  }

  return json({
    ids,
    shipDate,
    shipDateOverrides,
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
  danger: "⛔", caution: "⚠️", insulated: "📦", safe: "✅", unknown: "❓",
};

// Pack-badge math lives in ../pack-badge (single source of truth, unit-tested) so
// printed slips, the single-slip view, and the inventory page always agree.

// Page 1 has less room (header + address take ~40% of the page)
const ITEMS_PAGE_1 = 8;
// Continuation pages only need a small header banner
const ITEMS_PER_PAGE = 15;

function ItemsTable({ items }: { items: any[] }) {
  return (
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
        {items.map((item: any, i: number) => (
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
  );
}

function Signature({ note }: { note: string | null }) {
  return (
    <>
      {note && (
        <>
          <hr style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "0 0 20px" }} />
          <div style={{ marginBottom: "28px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Order notes</div>
            <div style={{ fontSize: "13px", color: "#444", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{note}</div>
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
    </>
  );
}

function SlipView({ slip, shopLogoUrl, shopName, rolled }: { slip: any; shopLogoUrl: string | null; shopName: string | null; rolled: boolean }) {
  const { order, weather, alert, shipDate } = slip;
  // A rolled-over or "do not ship" order shows ONLY that banner — everything else
  // (reship, access point, local, weather alert) is suppressed so it can't be missed.
  const doNotShip = rolled || weather?.crossesWeekend === true;
  const allItems: any[] = order.lineItems;

  const page1Items = allItems.slice(0, ITEMS_PAGE_1);
  const rest = allItems.slice(ITEMS_PAGE_1);
  const extraPages: any[][] = [];
  for (let i = 0; i < rest.length; i += ITEMS_PER_PAGE) {
    extraPages.push(rest.slice(i, i + ITEMS_PER_PAGE));
  }
  const hasExtra = extraPages.length > 0;

  return (
    <>
      {/* Page 1: full header + address + first batch of items */}
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

        {!doNotShip && order.isAccessPoint && (
          <div className="slip-banner" style={{ background: "#0d3880", borderRadius: "6px", padding: "10px 14px", marginBottom: "14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 800, color: "#fff", letterSpacing: "0.04em" }}>📦 UPS ACCESS POINT DELIVERY</div>
            <div style={{ fontSize: "11px", color: "#c8d8f8", marginTop: "3px" }}>
              {weather ? `Ships: ${shipDate} · Arrives: ${weather.deliveryDate} · ${weather.transitDays} day${weather.transitDays !== 1 ? "s" : ""}` : "Ship to UPS Store/Access Point — customer will pick up."}
            </div>
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
              {order.isAccessPoint && <span style={{ background: "#0d3880", border: "1px solid #1a4fad", borderRadius: "4px", padding: "2px 7px", fontSize: "11px", fontWeight: 800, color: "#fff", letterSpacing: "0.04em" }}>ACCESS POINT</span>}
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>{order.fulfillmentStatus}</div>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "0 0 24px" }} />

        <div style={{ display: "flex", gap: "32px", marginBottom: "28px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
              {order.isLocal ? "Pickup / Contact" : order.isAccessPoint ? "UPS Access Point" : "Ship to"}
            </div>
            <div style={{ fontSize: "14px", lineHeight: 1.7 }}>
              {order.isAccessPoint && order.shippingAddress?.company && (
                <div style={{ fontWeight: 700, color: "#0d3880" }}>{order.shippingAddress.company}</div>
              )}
              {(order.shippingAddress?.name || order.customerName) && (
                <div style={{ fontWeight: order.isAccessPoint ? 400 : 600 }}>{order.shippingAddress?.name || order.customerName}</div>
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

        <ItemsTable items={page1Items} />

        {hasExtra ? (
          <div style={{ textAlign: "right", fontSize: "11px", color: "#6d7175", marginTop: "-16px" }}>
            Continued on next page…
          </div>
        ) : (
          <Signature note={order.note} />
        )}
      </div>

      {/* Continuation pages: minimal header + items, signature only on last page */}
      {extraPages.map((pageItems, idx) => {
        const isLast = idx === extraPages.length - 1;
        return (
          <div key={`${order.id}-p${idx + 2}`} className="slip" style={{ maxWidth: "760px", margin: "32px auto", background: "#fff", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", padding: "40px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {shopLogoUrl && <img src={shopLogoUrl} alt={shopName ?? ""} style={{ height: "32px", width: "auto", objectFit: "contain" }} />}
                <div style={{ fontSize: "15px", fontWeight: 600 }}>{shopName ?? "Store"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "18px", fontWeight: 700 }}>{order.name}</div>
                <div style={{ fontSize: "11px", color: "#6d7175" }}>continued · page {idx + 2}</div>
              </div>
            </div>
            <hr style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "0 0 16px" }} />
            <ItemsTable items={pageItems} />
            {isLast && <Signature note={order.note} />}
          </div>
        );
      })}
    </>
  );
}

export default function PrintBatch() {
  const { ids, shipDate, shipDateOverrides, shopLogoUrl, shopName, printLocalOrders } = useLoaderData<typeof loader>();
  const [slips, setSlips] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(0);
  const [loadError, setLoadError] = useState(false);
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
        // Within a chunk, group orders by their effective ship date so each group
        // is fetched with its own date and shows the right forecast.
        const groups = new Map<string | null, string[]>();
        for (const id of chunk) {
          const d = shipDateOverrides[id] ?? shipDate;
          if (!groups.has(d)) groups.set(d, []);
          groups.get(d)!.push(id);
        }
        try {
          for (const [d, gids] of groups) {
            if (cancelled) return;
            const res = await fetch(`/api/slips?ids=${gids.join(",")}${d ? `&shipDate=${encodeURIComponent(d)}` : ""}`);
            if (res.ok && !cancelled) {
              const batch: any[] = await res.json();
              if (!cancelled) {
                batch.filter((s) => s && (printLocalOrders || !s.order.isLocal)).forEach((s) => allSlips.push(s));
              }
            } else if (!res.ok && !cancelled) {
              setLoadError(true);
            }
          }
        } catch {
          if (!cancelled) setLoadError(true);
        }
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

  useEffect(() => {
    if (done && slips.length > 0) {
      const t = setTimeout(() => window.print(), 500);
      return () => clearTimeout(t);
    }
  }, [done, slips.length]);

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
            padding: 10mm !important;
            border-radius: 0 !important;
            font-size: 11px !important;
          }
          .slip + .slip { page-break-before: always; break-before: page; }
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

      {done && slips.length === 0 && (
        <div className="no-print" style={{ maxWidth: "520px", margin: "60px auto", textAlign: "center", padding: "40px" }}>
          {loadError ? (
            <>
              <div style={{ fontSize: "32px", marginBottom: "16px" }}>⚠️</div>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a", marginBottom: "8px" }}>Failed to load slip data</div>
              <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "24px" }}>
                The server could not retrieve order details. This is usually a temporary issue.
              </div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 20px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: "32px", marginBottom: "16px" }}>📋</div>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a", marginBottom: "8px" }}>No slips to print</div>
              <div style={{ fontSize: "13px", color: "#6d7175" }}>
                The selected order may be a local order excluded from printing, or it could not be found.
              </div>
            </>
          )}
        </div>
      )}

      {slips.map((slip) => (
        <SlipView key={slip.order.id} slip={slip} shopLogoUrl={shopLogoUrl} shopName={shopName} rolled={!!shipDateOverrides[slip.order.id]} />
      ))}
    </>
  );
}
