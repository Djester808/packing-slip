import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { fetchSlipBatch } from "../slip.server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureWeatherHold } from "../weather-hold.server";

async function loadSlips(request: Request, applyHolds = false) {
  const url = new URL(request.url);
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  if (ids.length === 0) return json([]);

  const shipDateParam = url.searchParams.get("shipDate");
  const overrideShipDate = shipDateParam ? new Date(shipDateParam) : undefined;
  // Only computed when asked (e.g. printing) — avoids a per-order query during the
  // heavy "Find shippable orders" sweep.
  const withOtherOrders = url.searchParams.get("withOtherOrders") === "1";

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" }, update: {}, create: { id: "singleton" },
  });

  try {
    const slips = await fetchSlipBatch(ids, settings, overrideShipDate, withOtherOrders);
    if (applyHolds) {
      for (const slip of slips) {
        try {
          slip.weatherHold = await ensureWeatherHold(slip);
        } catch (error) {
          console.error('[Weather hold]', slip.order.id, error);
          slip.weatherHold = { status: 'failed', message: 'Shopify weather hold failed. Do not ship; retry or hold this order manually in Shopify.' };
        }
      }
    }
    return json(slips);
  } catch (err) {
    console.error("[api/slips] fetchSlipBatch failed:", err);
    return json({ error: "Failed to load slip data" }, { status: 500 });
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => loadSlips(request);

export const action = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (session.shop !== process.env.SHOPIFY_STORE_DOMAIN) return json({ error: "Wrong shop" }, { status: 403 });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  return loadSlips(request, true);
};
