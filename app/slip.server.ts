import { shopifyGraphQL } from "./admin-api.server";
import { getTempRange, addBusinessDays, toDateString, nextShipDate } from "./weather.server";
import { getTransitDays } from "./transit.server";
import { getAlert } from "./alert";

export function isLocalShipping(method: string) {
  return /local|pickup|pick.?up/i.test(method) ||
    /^\d+\s+\S.*\b(rd|st|ave|blvd|dr|ln|way|ct|pl|hwy|pkwy|drive|street|avenue|road|lane|court)\b/i.test(method);
}

const ORDER_FIELDS = `
  id name createdAt note tags displayFulfillmentStatus
  customer { firstName lastName email }
  shippingAddress { firstName lastName address1 address2 city province zip country }
  shippingLine { title }
  lineItems(first: 40) {
    edges { node { title quantity variant { title sku image { url } product { featuredImage { url } } } } }
  }
`;

async function buildSlipFromOrder(
  o: any,
  settings: { dontShipAbove: number; icePackAbove: number; dontShipBelow: number; cautionBelow: number },
  shipDate: Date,
) {
  const orderId = o.id.split("/").pop();
  const shippingMethod = o.shippingLine?.title ?? "";
  const isLocal = isLocalShipping(shippingMethod);
  const zip = o.shippingAddress?.zip ?? "";

  const transitDays = await getTransitDays(
    shippingMethod,
    isLocal ? undefined : zip,
    shipDate,
    isLocal ? undefined : (o.shippingAddress?.province ?? undefined),
    isLocal ? undefined : (o.shippingAddress?.city ?? undefined),
  );

  const deliveryDate = addBusinessDays(shipDate, transitDays);
  const deliveryDateStr = toDateString(deliveryDate);

  let maxTempF: number | null = null;
  let minTempF: number | null = null;
  let forecastOutOfRange = false;

  if (!isLocal && zip) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const calendarDays = Math.ceil((deliveryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (calendarDays > 14) {
      forecastOutOfRange = true;
    } else {
      ({ maxTempF, minTempF } = await getTempRange(zip, deliveryDateStr));
    }
  }

  const alert = isLocal ? null : getAlert(maxTempF, minTempF, settings.dontShipAbove, settings.icePackAbove, settings.dontShipBelow, settings.cautionBelow);
  const addr = o.shippingAddress;

  return {
    order: {
      id: orderId,
      name: o.name,
      createdAt: new Date(o.createdAt).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      }),
      note: o.note ?? null,
      fulfillmentStatus: o.displayFulfillmentStatus,
      customerEmail: o.customer?.email ?? null,
      shippingAddress: addr ? {
        name: [addr.firstName, addr.lastName].filter(Boolean).join(" "),
        address1: addr.address1 ?? "", address2: addr.address2 ?? "",
        city: addr.city ?? "", province: addr.province ?? "", zip: addr.zip ?? "", country: addr.country ?? "",
      } : null,
      customerName: o.customer ? `${o.customer.firstName ?? ""} ${o.customer.lastName ?? ""}`.trim() : null,
      shippingMethod, isLocal,
      isReship: /reship/i.test(shippingMethod),
      lineItems: (o.lineItems?.edges ?? [])
        .filter((e: any) => !/^tip$/i.test(e.node.title?.trim()))
        .map((e: any) => ({
          title: e.node.title,
          variant: e.node.variant?.title && e.node.variant.title !== "Default Title" ? e.node.variant.title : null,
          imageUrl: e.node.variant?.image?.url ?? e.node.variant?.product?.featuredImage?.url ?? null,
          quantity: e.node.quantity,
        })),
    },
    shipDate: shipDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    weather: isLocal ? null : {
      deliveryDate: deliveryDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      transitDays, forecastOutOfRange,
      crossesWeekend: (() => {
        const daysToFriday = 5 - shipDate.getDay();
        const friday = new Date(shipDate);
        friday.setDate(shipDate.getDate() + daysToFriday);
        return deliveryDate > friday;
      })(),
    },
    alert,
  };
}

export async function fetchSlip(orderId: string, settings: { dontShipAbove: number; icePackAbove: number; dontShipBelow: number; cautionBelow: number }) {
  const gid = `gid://shopify/Order/${orderId}`;
  const data = await shopifyGraphQL(
    `query getOrder($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`,
    { id: gid },
  );
  const o = data.data?.order;
  if (!o) return null;
  return buildSlipFromOrder(o, settings, nextShipDate().date);
}

export async function fetchSlipBatch(
  orderIds: string[],
  settings: { dontShipAbove: number; icePackAbove: number; dontShipBelow: number; cautionBelow: number },
): Promise<any[]> {
  if (orderIds.length === 0) return [];

  const gids = orderIds.map((id) => `gid://shopify/Order/${id}`);
  const data = await shopifyGraphQL(
    `query getOrders($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { ${ORDER_FIELDS} } } }`,
    { ids: gids },
  );

  const orders = (data.data?.nodes ?? []).filter(Boolean) as any[];
  const { date: shipDate } = nextShipDate();

  // Process all orders in parallel with concurrency limit on UPS calls
  const CONCURRENCY = 10;
  const results: any[] = new Array(orders.length).fill(null);

  for (let i = 0; i < orders.length; i += CONCURRENCY) {
    const chunk = orders.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (o, j) => {
        try {
          results[i + j] = await buildSlipFromOrder(o, settings, shipDate);
        } catch {
          // leave as null
        }
      }),
    );
  }

  return results.filter(Boolean);
}
