import prisma from "./db.server";

const OWM = "https://api.openweathermap.org";
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const NWS_HEADERS = {
  "User-Agent": "AquaSlip/1.0 (superiorshrimp.com)",
  Accept: "application/geo+json",
};

async function getNWSDay(lat: number, lon: number, date: string): Promise<{ high: number; low: number } | null> {
  try {
    const pointRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: NWS_HEADERS, signal: AbortSignal.timeout(6000) },
    );
    if (!pointRes.ok) return null;
    const point = await pointRes.json() as any;
    const forecastUrl = point.properties?.forecast;
    if (!forecastUrl) return null;

    const fRes = await fetch(forecastUrl, { headers: NWS_HEADERS, signal: AbortSignal.timeout(6000) });
    if (!fRes.ok) return null;
    const fData = await fRes.json() as any;
    const periods: any[] = fData.properties?.periods ?? [];

    let high: number | null = null;
    let low: number | null = null;
    for (const p of periods) {
      if (p.startTime?.slice(0, 10) !== date || p.temperature == null) continue;
      if (p.isDaytime) high = p.temperature;
      else low = p.temperature;
    }
    if (high === null || low === null) return null;
    return { high, low };
  } catch {
    return null;
  }
}

export async function geocodeZip(zip: string): Promise<{ lat: number; lon: number; name?: string } | null> {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${OWM}/geo/1.0/zip?zip=${zip},US&appid=${key}`);
    if (!res.ok) return null;
    const data = await res.json() as { lat: number; lon: number; name?: string };
    return { lat: data.lat, lon: data.lon, name: data.name };
  } catch {
    return null;
  }
}

export async function getTempRange(zip: string, date: string): Promise<{ maxTempF: number | null; minTempF: number | null }> {
  zip = zip.split("-")[0].trim();
  if (!zip) return { maxTempF: null, minTempF: null };

  const cached = await prisma.weatherCache.findUnique({ where: { zip_date: { zip, date } } });
  if (cached && Date.now() - cached.cachedAt.getTime() < CACHE_TTL_MS && cached.minTempF !== null) {
    return { maxTempF: cached.maxTempF, minTempF: cached.minTempF };
  }

  const coords = await geocodeZip(zip);
  if (!coords) return { maxTempF: null, minTempF: null };

  try {
    const [omRes, nws] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=16`,
      ),
      getNWSDay(coords.lat, coords.lon, date),
    ]);
    if (!omRes.ok) return { maxTempF: null, minTempF: null };
    const data = await omRes.json() as { daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[] } };

    const idx = data.daily.time.indexOf(date);
    if (idx === -1) return { maxTempF: null, minTempF: null };

    const omHigh = data.daily.temperature_2m_max[idx];
    const omLow  = data.daily.temperature_2m_min[idx];

    // Blend NWS when available (same averaging as api.weather.tsx)
    const maxTempF = nws ? (omHigh + nws.high) / 2 : omHigh;
    const minTempF = nws ? (omLow  + nws.low)  / 2 : omLow;

    await prisma.weatherCache.upsert({
      where: { zip_date: { zip, date } },
      update: { maxTempF, minTempF, cachedAt: new Date() },
      create: { zip, date, maxTempF, minTempF },
    });

    return { maxTempF, minTempF };
  } catch {
    return { maxTempF: null, minTempF: null };
  }
}

// US federal holidays (observed dates) where Monday falls on a holiday
export const HOLIDAY_DATES = new Set([
  // 2026
  "2026-01-01","2026-01-19","2026-02-16","2026-05-25",
  "2026-07-03","2026-09-07","2026-10-12","2026-11-11","2026-11-26","2026-12-25",
  // 2027
  "2027-01-01","2027-01-18","2027-02-15","2027-05-31",
  "2027-07-05","2027-09-06","2027-10-11","2027-11-11","2027-11-25","2027-12-24",
  // 2028
  "2027-12-31","2028-01-17","2028-02-21","2028-05-29",
  "2028-07-04","2028-09-04","2028-10-09","2028-11-10","2028-11-23","2028-12-25",
]);

function isHoliday(date: Date): boolean {
  return HOLIDAY_DATES.has(toDateString(date));
}

// Monday and Tuesday are the primary ship days (cutoff 1 PM Central each day).
// After the Tuesday cutoff — or when Tuesday is a holiday — Wednesday ships with a
// restriction (dry goods + 2-day/overnight only). Holidays (usually Mondays) are
// skipped. Any day from Wednesday on rolls to the next week's Monday.
export function nextShipDate(now: Date = new Date()): { date: Date; isWednesdayOnly: boolean } {
  // Use formatToParts — avoids re-parsing a locale string, which fails on Alpine
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? "0", 10);
  const today = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  const dow  = today.getUTCDay();
  const hour = get("hour");

  function addDays(d: Date, n: number): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
  }

  // Roll to the next week's ship slot: Monday, then Tuesday, then restricted Wednesday.
  function nextWeek(): { date: Date; isWednesdayOnly: boolean } {
    let d = (1 - dow + 7) % 7;
    if (d === 0) d = 7;
    const mon = addDays(today, d);
    if (!isHoliday(mon)) return { date: mon, isWednesdayOnly: false };
    const tue = addDays(mon, 1);
    if (!isHoliday(tue)) return { date: tue, isWednesdayOnly: false };
    const wed = addDays(mon, 2);
    if (!isHoliday(wed)) return { date: wed, isWednesdayOnly: true };
    return { date: addDays(mon, 7), isWednesdayOnly: false };
  }

  // Monday or Tuesday before cutoff (and not a holiday) → ship today.
  if ((dow === 1 || dow === 2) && hour < 13 && !isHoliday(today)) {
    return { date: today, isWednesdayOnly: false };
  }

  // Monday after cutoff or holiday Monday → Tuesday, then Wednesday overflow.
  if (dow === 1) {
    const tue = addDays(today, 1);
    if (!isHoliday(tue)) return { date: tue, isWednesdayOnly: false };
    const wed = addDays(today, 2);
    if (!isHoliday(wed)) return { date: wed, isWednesdayOnly: true };
    return nextWeek();
  }

  // Tuesday after cutoff or holiday Tuesday → restricted Wednesday, else next week.
  if (dow === 2) {
    const wed = addDays(today, 1);
    if (!isHoliday(wed)) return { date: wed, isWednesdayOnly: true };
    return nextWeek();
  }

  // Wednesday–Sunday → next week's Monday.
  return nextWeek();
}

// The remaining ship days in the SAME week, strictly after `after`, in order.
// Tuesday is unrestricted; Wednesday is restricted (2-day/overnight/dry goods).
// Holidays are skipped. Roll-forward stays within the current shipping week — an
// order that can't arrive this week without sitting over the weekend is held, not
// pushed into next week.
//   Monday    → [Tuesday, Wednesday]
//   Tuesday   → [Wednesday]
//   Wednesday → []
export function remainingShipDaysThisWeek(after: Date): Array<{ date: Date; restricted: boolean }> {
  const base = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate()));
  const dow = base.getUTCDay();
  function addDays(d: Date, n: number): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
  }
  const out: Array<{ date: Date; restricted: boolean }> = [];
  for (const target of [2, 3] as const) { // Tuesday, then Wednesday
    if (dow >= 1 && dow < target) {
      const d = addDays(base, target - dow);
      if (!isHoliday(d)) out.push({ date: d, restricted: target === 3 });
    }
  }
  return out;
}

export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
