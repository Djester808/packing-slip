import { shopifyGraphQL } from './admin-api.server';
import type { ShipAlert } from './alert';

const HANDLE = 'aquaslip-weather-delay';
export type WeatherHoldResult = { status: 'held' | 'not_required' | 'failed'; message?: string };
export type WeatherSlip = {
  order: { id: string; isLocal: boolean; isAccessPoint: boolean; isReship: boolean };
  alert: ShipAlert | null;
  weather: { deliveryDate: string } | null;
};

export function needsWeatherHold(slip: WeatherSlip): boolean {
  return slip.alert?.level === 'danger' && !slip.order.isLocal &&
    !slip.order.isAccessPoint && !slip.order.isReship;
}

function checkErrors(response: any) {
  if (response.errors?.length) throw new Error(response.errors.map((e: any) => e.message).join('; '));
}

async function fulfillmentOrders(orderId: string): Promise<any[]> {
  const orders: any[] = [];
  let after: string | null = null;
  do {
    const response = await shopifyGraphQL(`query WeatherFulfillmentOrders($id: ID!, $after: String) {
      order(id: $id) { fulfillmentOrders(first: 100, after: $after) {
        nodes { id status fulfillmentHolds { handle heldByRequestingApp } }
        pageInfo { hasNextPage endCursor }
      } }
    }`, { id: `gid://shopify/Order/${orderId}`, after });
    checkErrors(response);
    const page = response.data?.order?.fulfillmentOrders;
    if (!page) throw new Error('Shopify fulfillment orders could not be read');
    orders.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (page.pageInfo.hasNextPage && !after) throw new Error('Missing Shopify pagination cursor');
  } while (after);
  return orders;
}

function hasWeatherHold(order: any) {
  return order.fulfillmentHolds.some((hold: any) => hold.heldByRequestingApp && hold.handle === HANDLE);
}

// Shopify's unique handle also prevents duplicates across simultaneous app instances.
export async function ensureWeatherHold(slip: WeatherSlip): Promise<WeatherHoldResult> {
  if (!needsWeatherHold(slip)) return { status: 'not_required' };
  const orders = await fulfillmentOrders(slip.order.id);
  // Order creation can precede fulfillment routing; return an error so the webhook retries.
  if (!orders.length) throw new Error('Shopify fulfillment routing is not ready; retry the weather hold');
  const active = orders.filter((order) => !['CLOSED', 'CANCELLED'].includes(order.status));
  if (!active.length) return { status: 'not_required' };
  for (const order of active) {
    if (hasWeatherHold(order)) continue;
    const response = await shopifyGraphQL(`mutation WeatherFulfillmentHold($id: ID!, $hold: FulfillmentOrderHoldInput!) {
      fulfillmentOrderHold(id: $id, fulfillmentHold: $hold) {
        fulfillmentOrder { id status }
        userErrors { field message }
      }
    }`, {
      id: order.id,
      hold: {
        handle: HANDLE, reason: 'OTHER',
        reasonNotes: `Weather delay — ${slip.alert!.headline}. Estimated delivery: ${slip.weather?.deliveryDate ?? 'unknown'}. Hold for safe shipping weather.`,
        notifyMerchant: false,
      },
    });
    checkErrors(response);
    const result = response.data?.fulfillmentOrderHold;
    if (!result || result.userErrors?.length || result.fulfillmentOrder?.status !== 'ON_HOLD') {
      // A concurrent request may have applied our hold after the initial query.
      const current = (await fulfillmentOrders(slip.order.id)).find((item) => item.id === order.id);
      if (current && hasWeatherHold(current)) continue;
      throw new Error(result?.userErrors?.map((e: any) => e.message).join('; ') || 'Shopify did not confirm the weather hold');
    }
  }
  return { status: 'held' };
}

// Only orders created after the merchant enabled new-order-only holds are eligible.
export const WEATHER_HOLDS_START_AT = '2026-09-11T03:29:57Z';
export async function ensureNewOrderWeatherHold(slip: WeatherSlip, createdAt: unknown): Promise<WeatherHoldResult> {
  const created = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(created) || created < Date.parse(WEATHER_HOLDS_START_AT)) {
    return { status: 'not_required' };
  }
  return ensureWeatherHold(slip);
}