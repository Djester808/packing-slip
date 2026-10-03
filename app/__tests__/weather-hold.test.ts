import { ensureWeatherHold, ensureNewOrderWeatherHold, WEATHER_HOLDS_START_AT, needsWeatherHold, type WeatherSlip } from '../weather-hold.server';
import { shopifyGraphQL } from '../admin-api.server';
import { getAlert } from '../alert';

jest.mock('../admin-api.server', () => ({ shopifyGraphQL: jest.fn() }));
const graphql = jest.mocked(shopifyGraphQL);
const slip = (high = 91, low = 60): WeatherSlip => ({
  order: { id: '123', isLocal: false, isAccessPoint: false, isReship: false },
  alert: getAlert(high, low, 45), weather: { deliveryDate: 'September 14, 2026' },
});
const fo = (id = 'fo1', status = 'OPEN', fulfillmentHolds: any[] = []) => ({ id, status, fulfillmentHolds });
const page = (nodes: any[], next = false) => ({ data: { order: { fulfillmentOrders: {
  nodes, pageInfo: { hasNextPage: next, endCursor: next ? 'next' : null },
} } } });
const held = { data: { fulfillmentOrderHold: { fulfillmentOrder: { id: 'fo1', status: 'ON_HOLD' }, userErrors: [] } } };
const ownHold = { handle: 'aquaslip-weather-delay', heldByRequestingApp: true };

beforeEach(() => graphql.mockReset());

it.each([86, 90])('does not hold the %i°F oversized-box band', async (high) => {
  expect(await ensureWeatherHold(slip(high))).toEqual({ status: 'not_required' });
  expect(graphql).not.toHaveBeenCalled();
});
it.each(['isAccessPoint', 'isReship', 'isLocal'] as const)('preserves the %s exemption', async (flag) => {
  const input = slip(); input.order[flag] = true;
  expect(await ensureWeatherHold(input)).toEqual({ status: 'not_required' });
  expect(graphql).not.toHaveBeenCalled();
});
it('does not hold when the forecast is unavailable', () => {
  const input = slip(); input.alert = getAlert(null, null, 45);
  expect(needsWeatherHold(input)).toBe(false);
});
it.each([[91, 60], [100, 60], [30, -1], [30, -0.1]])('holds dangerous weather (%i high, %i low) with a weather reason', async (high, low) => {
  graphql.mockResolvedValueOnce(page([fo()])).mockResolvedValueOnce(held);
  expect(await ensureWeatherHold(slip(high, low))).toEqual({ status: 'held' });
  expect(graphql.mock.calls[1][1]).toEqual({ id: 'fo1', hold: {
    handle: 'aquaslip-weather-delay', reason: 'OTHER', notifyMerchant: false,
    reasonNotes: expect.stringContaining(`Weather delay — ${slip(high, low).alert!.headline}`),
  } });
});
it('does not duplicate an existing weather hold', async () => {
  graphql.mockResolvedValueOnce(page([fo('fo1', 'ON_HOLD', [ownHold])]));
  expect(await ensureWeatherHold(slip())).toEqual({ status: 'held' });
  expect(graphql).toHaveBeenCalledTimes(1);
});
it('adds a weather hold alongside an unrelated hold', async () => {
  graphql.mockResolvedValueOnce(page([fo('fo1', 'ON_HOLD', [{ handle: 'payment', heldByRequestingApp: false }])])).mockResolvedValueOnce(held);
  expect(await ensureWeatherHold(slip())).toEqual({ status: 'held' });
  expect(graphql).toHaveBeenCalledTimes(2);
});
it('paginates and holds every active fulfillment, leaving completed ones alone', async () => {
  graphql.mockResolvedValueOnce(page([fo('closed', 'CLOSED'), fo('fo1')], true))
    .mockResolvedValueOnce(page([fo('cancelled', 'CANCELLED'), fo('fo2')]))
    .mockResolvedValue(held);
  await ensureWeatherHold(slip());
  expect(graphql.mock.calls[1][1]).toEqual({ id: 'gid://shopify/Order/123', after: 'next' });
  expect(graphql.mock.calls.slice(2).map((call) => (call[1] as any).id)).toEqual(['fo1', 'fo2']);
});
it('accepts a concurrent hold only after confirming it exists', async () => {
  graphql.mockResolvedValueOnce(page([fo()]))
    .mockResolvedValueOnce({ data: { fulfillmentOrderHold: { userErrors: [{ message: 'Duplicate handle' }] } } })
    .mockResolvedValueOnce(page([fo('fo1', 'ON_HOLD', [ownHold])]));
  expect(await ensureWeatherHold(slip())).toEqual({ status: 'held' });
});
it('surfaces permission failures', async () => {
  graphql.mockResolvedValueOnce({ errors: [{ message: 'Access denied' }] });
  await expect(ensureWeatherHold(slip())).rejects.toThrow('Access denied');
});
it('surfaces a rejected mutation instead of claiming a hold', async () => {
  graphql.mockResolvedValueOnce(page([fo()]))
    .mockResolvedValueOnce({ data: { fulfillmentOrderHold: { userErrors: [{ message: 'Cannot hold' }] } } })
    .mockResolvedValueOnce(page([fo()]));
  await expect(ensureWeatherHold(slip())).rejects.toThrow('Cannot hold');
});
it('requires retry when fulfillment routing is not ready', async () => {
  graphql.mockResolvedValueOnce(page([]));
  await expect(ensureWeatherHold(slip())).rejects.toThrow('routing is not ready');
});

it.each(['2026-09-10T12:00:00Z', 'invalid', undefined, null])('ignores existing or undated orders (%s), even on webhook retry', async (createdAt) => {
  expect(await ensureNewOrderWeatherHold(slip(), createdAt)).toEqual({ status: 'not_required' });
  expect(graphql).not.toHaveBeenCalled();
});
it('holds a newly created order at the activation boundary', async () => {
  graphql.mockResolvedValueOnce(page([fo()])).mockResolvedValueOnce(held);
  expect(await ensureNewOrderWeatherHold(slip(), WEATHER_HOLDS_START_AT)).toEqual({ status: 'held' });
});

it.each([0, 20, 32, 35])('does not hold an order with a %s°F low', async (low) => {
  expect(await ensureWeatherHold(slip(50, low))).toEqual({ status: 'not_required' });
  expect(graphql).not.toHaveBeenCalled();
});
