import prisma from "./db.server";
import { getUPSTransitDays } from "./ups.server";
import { nextShipDate } from "./weather.server";

const DEFAULTS: Array<{ keyword: string; transitDays: number }> = [
  { keyword: "overnight", transitDays: 1 },
  { keyword: "next day", transitDays: 1 },
  { keyword: "next-day", transitDays: 1 },
  { keyword: "priority mail express", transitDays: 1 },
  { keyword: "2nd day", transitDays: 2 },
  { keyword: "2-day", transitDays: 2 },
  { keyword: "two day", transitDays: 2 },
  { keyword: "two-day", transitDays: 2 },
  { keyword: "express", transitDays: 2 },
  { keyword: "priority", transitDays: 3 },
  { keyword: "first class", transitDays: 3 },
  { keyword: "first-class", transitDays: 3 },
  { keyword: "ground", transitDays: 5 },
  { keyword: "standard", transitDays: 5 },
  { keyword: "economy", transitDays: 7 },
  { keyword: "media mail", transitDays: 7 },
];

let seedDone = false;

export async function seedDefaultRulesIfEmpty() {
  if (seedDone) return;
  const existing = await prisma.transitRule.findMany({ select: { keyword: true } });
  const existingKeywords = new Set(existing.map((r) => r.keyword.toLowerCase()));
  const missing = DEFAULTS.filter((d) => !existingKeywords.has(d.keyword.toLowerCase()));
  if (missing.length > 0) {
    await prisma.transitRule.createMany({ data: missing });
  }
  seedDone = true;
}

function isUSPS(method: string) {
  return /usps|priority mail|first.?class mail|media mail/i.test(method);
}

export async function getTransitDays(
  shippingMethodTitle: string,
  destZip?: string,
  shipDate?: Date,
  destState?: string,
  destCity?: string,
): Promise<number> {
  const lower = shippingMethodTitle.toLowerCase();
  const defaultsSorted = [...DEFAULTS].sort((a, b) => a.transitDays - b.transitDays);

  if (/reship/i.test(shippingMethodTitle)) return 2;

  // USPS: skip UPS API and DB, use hardcoded defaults directly
  if (isUSPS(shippingMethodTitle)) {
    for (const rule of defaultsSorted) {
      if (lower.includes(rule.keyword.toLowerCase())) return rule.transitDays;
    }
    return 5;
  }

  // Detect if this is a UPS-branded method
  const isUPSMethod = /\bups\b/i.test(shippingMethodTitle);

  // For UPS methods, MUST use the UPS API - no fallbacks allowed
  if (isUPSMethod) {
    if (!destZip) {
      throw new Error(`UPS method "${shippingMethodTitle}" requires destination zip code`);
    }
    const upsDate = shipDate ?? nextShipDate().date;
    console.log(`[Transit] UPS method detected: "${shippingMethodTitle}" → calling UPS API`);
    const upsDays = await getUPSTransitDays(destZip, shippingMethodTitle, upsDate, destState, destCity);
    if (upsDays != null) {
      console.log(`[Transit] ✓ UPS API matched "${shippingMethodTitle}" → ${upsDays} days`);
      return upsDays;
    }
    console.error(`[Transit] ✗ FAILURE: UPS API could not match "${shippingMethodTitle}" to any service`);
    throw new Error(`UPS API could not match shipping method: "${shippingMethodTitle}"`);
  }

  // For non-UPS methods (custom Shopify shipping, USPS already handled above), fall back to DB/defaults
  const rules = await prisma.transitRule.findMany({ orderBy: { transitDays: "asc" } });
  for (const rule of rules) {
    if (lower.includes(rule.keyword.toLowerCase())) return rule.transitDays;
  }

  // Last resort: hardcoded defaults for unrecognized methods
  for (const rule of defaultsSorted) {
    if (lower.includes(rule.keyword.toLowerCase())) return rule.transitDays;
  }

  return 5;
}
