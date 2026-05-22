import prisma from "./db.server";

const DEFAULTS: Array<{ keyword: string; transitDays: number }> = [
  { keyword: "overnight", transitDays: 1 },
  { keyword: "next day", transitDays: 1 },
  { keyword: "next-day", transitDays: 1 },
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

export async function seedDefaultRulesIfEmpty() {
  const count = await prisma.transitRule.count();
  if (count === 0) {
    await prisma.transitRule.createMany({ data: DEFAULTS, skipDuplicates: true });
  }
}

export async function getTransitDays(shippingMethodTitle: string): Promise<number> {
  const rules = await prisma.transitRule.findMany({ orderBy: { transitDays: "asc" } });
  const lower = shippingMethodTitle.toLowerCase();
  for (const rule of rules) {
    if (lower.includes(rule.keyword.toLowerCase())) return rule.transitDays;
  }
  return 5;
}
