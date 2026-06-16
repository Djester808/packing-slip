import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { shopifyGraphQL } from "../admin-api.server";
import { buildSlipFromOrder } from "../slip.server";
import prisma from "../db.server";
import { nextShipDate } from "../weather.server";

const ORDER_FIELDS = `
  id name createdAt note tags displayFulfillmentStatus
  customer { firstName lastName email }
  shippingAddress { firstName lastName company address1 address2 city province zip country }
  shippingLine { title }
  lineItems(first: 40) {
    edges { node { title quantity currentQuantity variant { title sku image { url } product { featuredImage { url } } } } }
  }
`;

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const orderId = params.orderId;
  if (!orderId) return json({ error: "Order ID required" }, { status: 400 });

  try {
    const [order, settings] = await Promise.all([
      shopifyGraphQL(
        `query getOrder($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`,
        { id: `gid://shopify/Order/${orderId}` },
      ),
      prisma.appSettings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } }),
    ]);

    const o = order.data?.order;
    if (!o) return json({ error: "Order not found" }, { status: 404 });

    const slip = await buildSlipFromOrder(o, {
      dontShipAbove: settings.dontShipAbove,
      icePackAbove: settings.icePackAbove,
      dontShipBelow: settings.dontShipBelow,
      cautionBelow: settings.cautionBelow,
    }, nextShipDate().date);

    return json({
      orderId,
      customerEmail: slip.order.customerEmail,
      hasAlert: !!slip.alert,
      alert: slip.alert ? {
        type: slip.alert.type,
        message: slip.alert.message,
        maxTemp: slip.weather?.deliveryDate ? slip.alert.maxTemp : null,
        minTemp: slip.alert.minTemp,
        deliveryDate: slip.weather?.deliveryDate,
      } : null,
    });
  } catch (error) {
    console.error(`Error checking alert for order ${orderId}:`, error);
    return json({ error: "Failed to check order alert" }, { status: 500 });
  }
};
