import prisma from "./db.server";

const UPS_AUTH_URL = "https://onlinetools.ups.com/security/v1/oauth/token";
const UPS_TRANSIT_URL = "https://onlinetools.ups.com/api/shipments/v1/transittimes";
const UPS_LOCATOR_URL = "https://onlinetools.ups.com/api/locations/v3/search";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const AP_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// In-memory cache of access point street addresses keyed by destination zip
const apZipCache = new Map<string, { addrs: string[]; at: number }>();

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const clientId = process.env.UPS_CLIENT_ID;
  const clientSecret = process.env.UPS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(UPS_AUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[UPS] auth failed", res.status, text);
      return null;
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return cachedToken.token;
  } catch (e) {
    console.error("[UPS] auth exception", e);
    return null;
  }
}

function matchService(services: any[], shippingMethod: string): number | null {
  const methodLower = shippingMethod.toLowerCase().replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
  let best: { days: number; score: number } | null = null;

  for (const svc of services) {
    const desc = (svc.serviceLevelDescription ?? "").toLowerCase().replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
    if (!desc || svc.businessTransitDays == null) continue;

    const descWords = new Set(desc.split(" ").filter(Boolean));
    const methodWords = methodLower.split(" ").filter(Boolean);
    const overlap = methodWords.filter((w) => descWords.has(w)).length;

    if (overlap > 0 && (!best || overlap > best.score)) {
      best = { days: parseInt(String(svc.businessTransitDays), 10), score: overlap };
      console.log(`[UPS] candidate: "${desc}" → ${svc.businessTransitDays} days (score ${overlap})`);
    }
  }

  return best?.days ?? null;
}

function normalizeMethod(method: string): string {
  return method.toLowerCase().replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
}

export async function getUPSTransitDays(
  destZip: string,
  shippingMethod: string,
  shipDate: Date,
  destState?: string,
  destCity?: string,
): Promise<number | null> {
  const originZip = process.env.UPS_ORIGIN_ZIP;
  if (!originZip || !destZip) return null;

  const y = shipDate.getFullYear();
  const m = String(shipDate.getMonth() + 1).padStart(2, "0");
  const d = String(shipDate.getDate()).padStart(2, "0");
  const shipDateStr = `${y}-${m}-${d}`;

  const cacheMethod = normalizeMethod(shippingMethod);

  const cached = await prisma.transitCache.findUnique({
    where: { zip_method_date: { zip: destZip, method: cacheMethod, date: shipDateStr } },
  });
  if (cached && Date.now() - cached.cachedAt.getTime() < CACHE_TTL_MS) {
    return cached.days;
  }

  const token = await getToken();
  if (!token) return null;

  try {
    const res = await fetch(UPS_TRANSIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        transId: crypto.randomUUID(),
        transactionSrc: "PackSlip",
      },
      body: JSON.stringify({
        originCountryCode: "US",
        originPostalCode: originZip,
        originStateProvince: "MN",
        originCityName: "Duluth",
        destinationCountryCode: "US",
        destinationPostalCode: destZip,
        ...(destState ? { destinationStateProvince: destState } : {}),
        ...(destCity ? { destinationCityName: destCity } : {}),
        weight: "1",
        weightUnitOfMeasure: "LBS",
        shipmentContentsValue: "10",
        shipmentContentsCurrencyCode: "USD",
        billType: "03",
        shipDate: shipDateStr,
        numberOfPackages: "1",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[UPS] transit failed", res.status, text);
      return null;
    }
    const data = await res.json() as any;
    console.log("[UPS] transit response keys", JSON.stringify(Object.keys(data ?? {})));

    const services: any[] = data?.emsResponse?.services ?? [];
    console.log(`[UPS] dest: ${destZip} got ${services.length} services`);
    if (services.length) console.log("[UPS] sample svc:", JSON.stringify(services[0]));
    if (!services.length) {
      console.log("[UPS] no services — validationList:", JSON.stringify(data?.validationList ?? null));
      console.log("[UPS] originPickList:", JSON.stringify((data?.originPickList ?? []).slice(0, 2)));
      console.log("[UPS] destPickList:", JSON.stringify((data?.destinationPickList ?? []).slice(0, 2)));
      return null;
    }
    console.log("[UPS] matched", services.length, "services for:", shippingMethod);

    const days = matchService(services, shippingMethod);
    if (days != null) {
      await prisma.transitCache.upsert({
        where: { zip_method_date: { zip: destZip, method: cacheMethod, date: shipDateStr } },
        update: { days, cachedAt: new Date() },
        create: { zip: destZip, method: cacheMethod, date: shipDateStr, days },
      });
    }
    return days;
  } catch (e) {
    console.error("[UPS] transit exception", e);
    return null;
  }
}

function normalizeStreet(s: string): string {
  return s.toLowerCase()
    .replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd").replace(/\bdrive\b/g, "dr")
    .replace(/\broad\b/g, "rd").replace(/\blane\b/g, "ln")
    .replace(/\bsuite\b/g, "ste").replace(/\bnorth\b/g, "n")
    .replace(/\bsouth\b/g, "s").replace(/\beast\b/g, "e").replace(/\bwest\b/g, "w")
    .replace(/[.,#]/g, "").replace(/\s+/g, " ").trim();
}

async function fetchAccessPointsForZip(zip: string): Promise<string[]> {
  const cached = apZipCache.get(zip);
  if (cached && Date.now() - cached.at < AP_CACHE_TTL_MS) return cached.addrs;

  const token = await getToken();
  if (!token) return [];

  try {
    const res = await fetch(UPS_LOCATOR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        transId: crypto.randomUUID(),
        transactionSrc: "PackSlip",
      },
      body: JSON.stringify({
        LocatorRequest: {
          Request: { TransactionReference: { CustomerContext: "APCheck" } },
          OriginAddress: {
            AddressKeyFormat: { PostcodePrimaryLow: zip, CountryCode: "US" },
          },
          Translate: { LanguageCode: "eng", Locale: "en_US" },
          UnitOfMeasurement: { Code: "MI" },
          Radius: "3",
          LocationSearchCriteria: { MaximumListSize: "50" },
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[UPS Locator]", res.status, text.slice(0, 400));
      apZipCache.set(zip, { addrs: [], at: Date.now() });
      return [];
    }

    const data = await res.json() as any;
    const locations: any[] = data?.LocatorResponse?.SearchResults?.DropLocation ?? [];
    const addrs = locations
      .flatMap((loc: any) => {
        const raw = loc?.AddressKeyFormat?.AddressLine;
        return Array.isArray(raw) ? raw : raw ? [raw] : [];
      })
      .map(normalizeStreet)
      .filter(Boolean);

    console.log(`[UPS Locator] zip ${zip}: ${locations.length} locations, ${addrs.length} addresses`);
    apZipCache.set(zip, { addrs, at: Date.now() });
    return addrs;
  } catch (e) {
    console.error("[UPS Locator] exception", e);
    apZipCache.set(zip, { addrs: [], at: Date.now() });
    return [];
  }
}

export async function checkIsAccessPoint(
  zip: string,
  address1: string,
  recipientName?: string,
): Promise<boolean> {
  console.log(`[AP check] zip=${zip} addr="${address1}" name="${recipientName ?? ""}"`);
  // Fast path: recipient name/company already says UPS Store / Access Point
  if (/ups\s*store|the\s*ups\s*store|ups\s*access/i.test(recipientName ?? "")) {
    console.log("[AP check] matched by name");
    return true;
  }
  if (!zip || !address1) return false;

  const apAddrs = await fetchAccessPointsForZip(zip);
  if (!apAddrs.length) return false;

  const normalized = normalizeStreet(address1);
  const inputNum = normalized.match(/^\d+/)?.[0];
  if (!inputNum) return false;

  const matched = apAddrs.some((apAddr) => {
    const apNum = apAddr.match(/^\d+/)?.[0];
    if (apNum !== inputNum) return false;
    const inputWords = normalized.split(" ");
    const apWords = apAddr.split(" ");
    return inputWords[1] && apWords[1] && inputWords[1] === apWords[1];
  });
  console.log(`[AP check] addr match="${matched}" normalized="${normalized}" against ${apAddrs.length} AP addrs: ${apAddrs.slice(0, 3).join(" | ")}`);
  return matched;
}
