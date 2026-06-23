import { shopifyGraphQL } from "./admin-api.server";
import { getTempRange, addBusinessDays, toDateString, nextShipDate } from "./weather.server";
import { getTransitDays } from "./transit.server";
import { getAlert } from "./alert";
import { checkIsAccessPoint } from "./ups.server";
import { getPackBadgeTotal, isLivestockCollection } from "./pack-badge";

export function isLocalShipping(method: string) {
  return /local|pickup|pick.?up/i.test(method) ||
    /^\d+\s+\S.*\b(rd|st|ave|blvd|dr|ln|way|ct|pl|hwy|pkwy|drive|street|avenue|road|lane|court)\b/i.test(method);
}

const ORDER_FIELDS = `
  id name
  lineItems(first: 40) {
    edges { node { title quantity currentQuantity
      product { collections(first: 25) { edges { node { handle title } } } }
      variant { title } } }
  }
`;

// Collections (handle + title) for a line item's product.
function lineItemCollections(node: any): Array<{ handle?: string | null; title?: string | null }> {
  return (node.product?.collections?.edges ?? []).map((e: any) => e.node);
}

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

  const addr = o.shippingAddress;
  const recipientName = addr
    ? [addr.company, addr.firstName, addr.lastName].filter(Boolean).join(" ")
    : "";

  // Tag-based detection: user tags the order "access-point" in Shopify when redirecting to a UPS AP
  const tags: string[] = Array.isArray(o.tags) ? o.tags : (typeof o.tags === "string" ? o.tags.split(",").map((t: string) => t.trim()) : []);
  const taggedAsAP = tags.some((t) => /access.?point|ups.?store/i.test(t));

  const isAccessPoint = !isLocal && (
    taggedAsAP ||
    (!!addr?.zip ? await checkIsAccessPoint(addr.zip, addr.address1 ?? "", recipientName) : false)
  );
  if (taggedAsAP) console.log(`[AP check] order ${o.name} tagged as access point`);

  // Access points are climate-controlled UPS locations — weather holds don't apply
  const alert = (isLocal || isAccessPoint) ? null : getAlert(maxTempF, minTempF, settings.dontShipAbove, settings.icePackAbove, settings.dontShipBelow, settings.cautionBelow);

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
        company: addr.company ?? "",
        address1: addr.address1 ?? "", address2: addr.address2 ?? "",
        city: addr.city ?? "", province: addr.province ?? "", zip: addr.zip ?? "", country: addr.country ?? "",
      } : null,
      customerName: o.customer ? `${o.customer.firstName ?? ""} ${o.customer.lastName ?? ""}`.trim() : null,
      shippingMethod, isLocal, isAccessPoint,
      isReship: /reship/i.test(shippingMethod),
      lineItems: (o.lineItems?.edges ?? [])
        .filter((e: any) => !/^tip$/i.test(e.node.title?.trim()))
        .filter((e: any) => (e.node.currentQuantity ?? e.node.quantity) > 0)
        .map((e: any) => ({
          title: e.node.title,
          variant: e.node.variant?.title && e.node.variant.title !== "Default Title" ? e.node.variant.title : null,
          imageUrl: e.node.variant?.image?.url ?? e.node.variant?.product?.featuredImage?.url ?? null,
          quantity: e.node.currentQuantity ?? e.node.quantity,
          isFish: isLivestockCollection(lineItemCollections(e.node)),
        }))
        .reduce((acc: any[], item: any) => {
          const existing = acc.find((i) => i.title === item.title && i.variant === item.variant);
          if (existing) {
            existing.quantity += item.quantity;
          } else {
            acc.push(item);
          }
          return acc;
        }, []),
    },
    shipDate: shipDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    weather: isLocal ? null : {
      deliveryDate: deliveryDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      transitDays, forecastOutOfRange, maxTempF, minTempF,
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
  overrideShipDate?: Date,
): Promise<any[]> {
  if (orderIds.length === 0) return [];

  const gids = orderIds.map((id) => `gid://shopify/Order/${id}`);
  const data = await shopifyGraphQL(
    `query getOrders($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { ${ORDER_FIELDS} } } }`,
    { ids: gids },
  );

  const orders = (data.data?.nodes ?? []).filter(Boolean) as any[];
  const shipDate = overrideShipDate ?? nextShipDate().date;

  // Process all orders in parallel with concurrency limit on UPS calls
  const CONCURRENCY = 10;
  const results: any[] = new Array(orders.length).fill(null);

  for (let i = 0; i < orders.length; i += CONCURRENCY) {
    const chunk = orders.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (o, j) => {
        try {
          results[i + j] = await buildSlipFromOrder(o, settings, shipDate);
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          const errorStack = e instanceof Error ? e.stack : "";
          console.error(`[fetchSlipBatch] ✗ FAILED for ${o.name} (${o.id}): ${errorMsg}`);
          if (errorStack) console.error(`[fetchSlipBatch] Stack: ${errorStack}`);
          // leave as null
        }
      }),
    );
  }

  return results.filter(Boolean);
}

export async function getInventoryTotals(): Promise<Array<{ title: string; quantity: number; variantCount: number; variants: string }>> {
  console.log("[Inventory] getInventoryTotals called");
  const query = `query getOrders($after: String) {
    orders(first: 250, after: $after, query: "fulfillment_status:unfulfilled status:open") {
      edges { node { ${ORDER_FIELDS} } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

  const itemMap = new Map<string, { quantity: number; variants: Set<string> }>();
  let cursor: string | null = null;
  let hasNextPage = true;
  let totalOrdersProcessed = 0;
  let totalItemsProcessed = 0;

  try {
    while (hasNextPage) {
      const data = await shopifyGraphQL(query, cursor ? { after: cursor } : {});

      if (data.errors) {
        console.error("[Inventory] GraphQL Error:", JSON.stringify(data.errors));
        break;
      }

      const ordersEdges = data.data?.orders?.edges ?? [];
      console.log(`[Inventory] Raw response structure - has data: ${!!data.data}, has orders: ${!!data.data?.orders}, edges count: ${ordersEdges.length}`);

      if (ordersEdges.length > 0) {
        const firstOrder = ordersEdges[0].node;
        console.log(`[Inventory] First order structure - name: ${firstOrder.name}, has lineItems: ${!!firstOrder.lineItems}, lineItems type: ${typeof firstOrder.lineItems}`);
        if (firstOrder.lineItems) {
          console.log(`[Inventory] lineItems keys:`, Object.keys(firstOrder.lineItems));
          console.log(`[Inventory] lineItems.edges count:`, firstOrder.lineItems.edges?.length ?? 'undefined');
        }
      }

      const orders = ordersEdges.map((e: any) => e.node);
      console.log(`[Inventory] Fetched ${orders.length} orders, cursor: ${cursor}`);

      if (orders.length === 0) {
        console.log("[Inventory] No more orders to fetch");
        break;
      }

      for (const order of orders) {
        totalOrdersProcessed++;
        const lineItems = order.lineItems?.edges ?? [];
        console.log(`[Inventory] Order ${order.name}: ${lineItems.length} line items`);

        for (const { node: item } of lineItems) {
          totalItemsProcessed++;

          if (/^tip$/i.test(item.title?.trim())) {
            console.log(`[Inventory] Skipping tip: ${item.title}`);
            continue;
          }

          const qty = item.quantity ?? item.currentQuantity;
          console.log(`[Inventory] Item: "${item.title}" qty=${qty} variant="${item.variant?.title}"`);

          if (qty <= 0) {
            console.log(`[Inventory] Skipping qty <= 0: ${item.title}`);
            continue;
          }

          const variant = item.variant?.title && item.variant.title !== "Default Title" ? item.variant.title : null;
          const collections = lineItemCollections(item);
          const isLivestock = isLivestockCollection(collections);
          const total = getPackBadgeTotal(variant, qty, item.title, isLivestock);

          console.log(`[Inventory] Calculated total=${total} for "${item.title}" (isLivestock=${isLivestock})`);

          const variantKey = variant || "(no variant)";

          if (itemMap.has(item.title)) {
            const existing = itemMap.get(item.title)!;
            existing.quantity += total;
            existing.variants.add(variantKey);
            console.log(`[Inventory] Updated "${item.title}": quantity now ${existing.quantity}`);
          } else {
            itemMap.set(item.title, { quantity: total, variants: new Set([variantKey]) });
            console.log(`[Inventory] Added new item "${item.title}": quantity ${total}`);
          }
        }
      }

      hasNextPage = data.data?.orders?.pageInfo?.hasNextPage ?? false;
      cursor = data.data?.orders?.pageInfo?.endCursor ?? null;
      console.log(`[Inventory] hasNextPage=${hasNextPage}, cursor=${cursor}`);
    }
  } catch (e) {
    console.error("[Inventory] Exception:", e);
  }

  console.log(`[Inventory] Final totals: ${totalOrdersProcessed} orders, ${totalItemsProcessed} items checked, ${itemMap.size} distinct products`);

  const result = Array.from(itemMap.entries())
    .map(([title, data]) => ({
      title,
      quantity: data.quantity,
      variantCount: data.variants.size,
      variants: Array.from(data.variants).join(", "),
    }))
    .sort((a, b) => b.quantity - a.quantity);

  console.log(`[Inventory] Returning ${result.length} results`);
  return result;
}
