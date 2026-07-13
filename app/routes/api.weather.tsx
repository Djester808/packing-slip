import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { geocodeZip, nextShipDate, toDateString, HOLIDAY_DATES } from "../weather.server";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Cache-Control": "public, max-age=3600",
};

const NWS_HEADERS = {
  "User-Agent": "AquaSlip/1.0 (superiorshrimp.com)",
  Accept: "application/geo+json",
};

// Returns a map of date → { high, low } from National Weather Service (~7 day range)
async function getNWSForecast(lat: number, lon: number): Promise<Map<string, { high: number; low: number }>> {
  const empty = new Map<string, { high: number; low: number }>();
  try {
    const pointRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: NWS_HEADERS, signal: AbortSignal.timeout(6000) },
    );
    if (!pointRes.ok) return empty;
    const point = await pointRes.json() as any;
    const forecastUrl = point.properties?.forecast;
    if (!forecastUrl) return empty;

    const fRes = await fetch(forecastUrl, {
      headers: NWS_HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    if (!fRes.ok) return empty;
    const fData = await fRes.json() as any;
    const periods: any[] = fData.properties?.periods ?? [];

    const result = new Map<string, { high: number; low: number }>();
    for (const p of periods) {
      const date = p.startTime?.slice(0, 10);
      if (!date || p.temperature == null) continue;
      if (!result.has(date)) result.set(date, { high: -999, low: 999 });
      const entry = result.get(date)!;
      if (p.isDaytime) entry.high = p.temperature;
      else entry.low = p.temperature;
    }
    // Remove days where we only got one half
    for (const [date, v] of result) {
      if (v.high === -999 || v.low === 999) result.delete(date);
    }
    return result;
  } catch {
    return empty;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const zip = url.searchParams.get("zip")?.split("-")[0].trim() ?? "";

  if (!zip || !/^\d{5}$/.test(zip)) {
    return json({ error: "Invalid ZIP" }, { status: 400, headers: CORS });
  }

  const coords = await geocodeZip(zip);
  if (!coords) {
    return json({ error: "Could not geocode ZIP" }, { status: 422, headers: CORS });
  }

  const location = coords.name ? `${coords.name}, ${zip}` : zip;

  // Fetch Open-Meteo and NWS in parallel
  let raw: { daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[] } };
  let nws: Map<string, { high: number; low: number }>;
  try {
    const [omRes, nwsResult] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=14`,
      ),
      getNWSForecast(coords.lat, coords.lon),
    ]);
    if (!omRes.ok) throw new Error("upstream");
    raw = await omRes.json();
    nws = nwsResult;
  } catch {
    return json({ error: "Weather fetch failed" }, { status: 502, headers: CORS });
  }

  const nwsAvailable = nws.size > 0;

  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  const dontShipAbove = settings?.dontShipAbove ?? 90;
  const heatHoldAbove = settings?.heatHoldAbove ?? 100;
  const icePackAbove  = settings?.icePackAbove  ?? 80;
  const dontShipBelow = settings?.dontShipBelow ?? 35;
  const cautionBelow  = settings?.cautionBelow  ?? 45;
  const heatPackBelow = 32;

  const { date: shipDate, isWednesdayOnly } = nextShipDate();
  const shipDateStr = toDateString(shipDate);

  // Transit window: ship date + next 3 business days
  const transitWindowDates: string[] = [];
  {
    const cur = new Date(shipDate);
    for (let i = 0; i < 4; i++) {
      transitWindowDates.push(toDateString(cur));
      cur.setDate(cur.getDate() + 1);
      while (cur.getDay() === 0 || cur.getDay() === 6) cur.setDate(cur.getDate() + 1);
    }
  }

  const forecast = raw.daily.time.map((date, i) => {
    const omHigh = raw.daily.temperature_2m_max[i];
    const omLow = raw.daily.temperature_2m_min[i];
    const nwsDay = nws.get(date);

    // Average the two sources when NWS has data for this date
    const high = nwsDay ? (omHigh + nwsDay.high) / 2 : omHigh;
    const low  = nwsDay ? (omLow  + nwsDay.low)  / 2 : omLow;

    const isShipDay = date === shipDateStr;
    const isDeliveryDay = transitWindowDates.slice(1).includes(date);
    let classification: "safe" | "caution" | "risk" = "safe";
    if (high >= heatHoldAbove || low <= dontShipBelow) classification = "risk";
    else if (high >= dontShipAbove || high >= icePackAbove || low <= cautionBelow) classification = "caution";

    return {
      date, high, low, isShipDay, isDeliveryDay, classification,
      // Raw source values for transparency
      sources: { openMeteo: { high: omHigh, low: omLow }, nws: nwsDay ?? null },
    };
  });

  const transitWindow = forecast.filter((d) => transitWindowDates.includes(d.date));

  // Pack recommendations and dontShip use delivery days only — ship day weather
  // at the destination is irrelevant since the package doesn't arrive until the next day.
  const deliveryDays = transitWindow.filter((d) => d.isDeliveryDay);
  const recDays = deliveryDays.length ? deliveryDays : transitWindow;

  const avgHigh = recDays.reduce((s, d) => s + d.high, 0) / recDays.length;
  const avgLow  = recDays.reduce((s, d) => s + d.low,  0) / recDays.length;

  const fmtOpts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };
  let shipNote: string | null = null;
  if (isWednesdayOnly && shipDate.getDay() === 3) {
    const tue = new Date(shipDate);
    tue.setDate(shipDate.getDate() - 1);
    if (HOLIDAY_DATES.has(toDateString(tue))) {
      shipNote = `${tue.toLocaleDateString("en-US", fmtOpts)} is a federal holiday — next ship date is ${shipDate.toLocaleDateString("en-US", fmtOpts)}.`;
    }
  }

  const shipRestriction = isWednesdayOnly
    ? "Wednesday ship — dry goods and 2-day or overnight only"
    : null;

  const holidayTuesdays = raw.daily.time.filter((date) => {
    const d = new Date(date + "T12:00:00");
    return d.getDay() === 2 && HOLIDAY_DATES.has(date);
  });

  return json(
    {
      location,
      shipDate: shipDateStr,
      shipNote,
      shipRestriction,
      holidayTuesdays,
      thresholds: { dontShipAbove, heatHoldAbove, icePackAbove, dontShipBelow, cautionBelow, heatPackBelow },
      sources: nwsAvailable ? ["Open-Meteo", "NWS"] : ["Open-Meteo"],
      forecast,
      transitWindow,
      recommendation: {
        heatPack: avgLow <= heatPackBelow,
        icePack: avgHigh > icePackAbove,
        dontShip: recDays.some((d) => d.classification === "risk"),
      },
    },
    { headers: CORS },
  );
};
