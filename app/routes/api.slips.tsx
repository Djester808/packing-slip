import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { fetchSlipBatch } from "../slip.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  if (ids.length === 0) return json([]);

  const shipDateParam = url.searchParams.get("shipDate");
  const overrideShipDate = shipDateParam ? new Date(shipDateParam) : undefined;

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" }, update: {}, create: { id: "singleton" },
  });

  try {
    const slips = await fetchSlipBatch(ids, settings, overrideShipDate);
    return json(slips);
  } catch (err) {
    console.error("[api/slips] fetchSlipBatch failed:", err);
    return json({ error: "Failed to load slip data" }, { status: 500 });
  }
};
