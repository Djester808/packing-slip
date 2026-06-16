import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { fetchSlip } from "../slip.server";
import prisma from "../db.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const orderId = params.orderId;
  if (!orderId) return json({ error: "Order ID required" }, { status: 400 });

  try {
    const settings = await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });

    const slip = await fetchSlip(orderId, {
      dontShipAbove: settings.dontShipAbove,
      icePackAbove: settings.icePackAbove,
      dontShipBelow: settings.dontShipBelow,
      cautionBelow: settings.cautionBelow,
    });

    if (!slip) return json({ error: "Order not found" }, { status: 404 });

    return json({
      orderId,
      customerEmail: slip.order.customerEmail,
      hasAlert: !!slip.alert,
      alert: slip.alert ? {
        type: slip.alert.type,
        message: slip.alert.message,
        maxTemp: slip.alert.maxTemp,
        minTemp: slip.alert.minTemp,
        deliveryDate: slip.weather?.deliveryDate,
      } : null,
    });
  } catch (error) {
    console.error(`Error checking alert for order ${orderId}:`, error);
    return json({ error: "Failed to check order alert" }, { status: 500 });
  }
};
