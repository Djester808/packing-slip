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
    await prisma.transitRule.createMany({ data: missing, skipDuplicates: true });
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

  // Try UPS Time in Transit API
  if (destZip) {
    const upsDate = shipDate ?? nextShipDate().date;
    console.log(`[Transit] Calling UPS API for zip=${destZip}, method=${shippingMethodTitle}`);
    const upsDays = await getUPSTransitDays(destZip, shippingMethodTitle, upsDate, destState, destCity).catch((e) => {
      console.error(`[Transit] UPS API failed:`, e.message);
      return null;
    });
    if (upsDays != null) {
      console.log(`[Transit] UPS returned ${upsDays} days for ${shippingMethodTitle}`);
      return upsDays;
    }
    console.log(`[Transit] UPS returned null, using defaults`);
  }

  // Fall back to DB rules (user-customizable)
  const rules = await prisma.transitRule.findMany({ orderBy: { transitDays: "asc" } });
  for (const rule of rules) {
    if (lower.includes(rule.keyword.toLowerCase())) return rule.transitDays;
  }

  // Fall back to hardcoded defaults
  for (const rule of defaultsSorted) {
    if (lower.includes(rule.keyword.toLowerCase())) return rule.transitDays;
  }

  return 5;
}
