import prisma from "./db.server";

const OWM = "https://api.openweathermap.org";
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

async function geocodeZip(zip: string): Promise<{ lat: number; lon: number } | null> {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${OWM}/geo/1.0/zip?zip=${zip},US&appid=${key}`);
    if (!res.ok) return null;
    const data = await res.json() as { lat: number; lon: number };
    return { lat: data.lat, lon: data.lon };
  } catch {
    return null;
  }
}

export async function getMaxTempF(zip: string, date: string): Promise<number | null> {
  if (!zip || !process.env.OPENWEATHER_API_KEY) return null;

  const cached = await prisma.weatherCache.findUnique({ where: { zip_date: { zip, date } } });
  if (cached && Date.now() - cached.cachedAt.getTime() < CACHE_TTL_MS) {
    return cached.maxTempF;
  }

  const coords = await geocodeZip(zip);
  if (!coords) return null;

  try {
    const key = process.env.OPENWEATHER_API_KEY;
    const res = await fetch(
      `${OWM}/data/2.5/forecast?lat=${coords.lat}&lon=${coords.lon}&appid=${key}&units=imperial`,
    );
    if (!res.ok) return null;
    const data = await res.json() as { list: Array<{ dt_txt: string; main: { temp_max: number } }> };

    const entries = data.list.filter((item) => item.dt_txt.startsWith(date));
    if (entries.length === 0) return null;

    const maxTempF = Math.max(...entries.map((item) => item.main.temp_max));

    await prisma.weatherCache.upsert({
      where: { zip_date: { zip, date } },
      update: { maxTempF, cachedAt: new Date() },
      create: { zip, date, maxTempF },
    });

    return maxTempF;
  } catch {
    return null;
  }
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
