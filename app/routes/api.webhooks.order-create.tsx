import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";
import { fetchSlip } from "../slip.server";
import { shopifyGraphQL } from "../admin-api.server";
import prisma from "../db.server";

const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET!;

function verifyWebhookSignature(request: Request, body: string): boolean {
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) return false;

  const hash = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(body, "utf8")
    .digest("base64");

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.text();

    // Verify webhook signature
    if (!verifyWebhookSignature(request, body)) {
      console.warn("Invalid webhook signature");
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const event = JSON.parse(body);
    const orderId = event.id?.toString();
    const orderName = event.name;

    if (!orderId) {
      return json({ error: "No order ID in webhook" }, { status: 400 });
    }

    console.log(`[Webhook] Processing order ${orderName} (${orderId})`);

    // Get settings and check for weather alert
    const settings = await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });

    const slip = await fetchSlip(orderId, settings);

    if (!slip) {
      console.log(`[Webhook] Order ${orderName} not found`);
      return json({ status: "order_not_found" });
    }

    // If there's a weather alert, tag the order
    if (slip.alert) {
      console.log(`[Webhook] Order ${orderName} has weather alert: ${slip.alert.message}`);

      await shopifyGraphQL(
        `mutation addTags($input: TagsAddInput!) { tagsAdd(input: $input) { node { id tags } userErrors { field message } } }`,
        {
          input: {
            id: `gid://shopify/Order/${orderId}`,
            tags: ["weather-hold"],
          },
        },
      );

      console.log(`[Webhook] Tagged order ${orderName} with "weather-hold"`);
      return json({ status: "tagged_for_weather_hold", alert: slip.alert.message });
    }

    console.log(`[Webhook] Order ${orderName} has no weather alert`);
    return json({ status: "no_alert" });
  } catch (error) {
    console.error("[Webhook] Error processing order webhook:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};
