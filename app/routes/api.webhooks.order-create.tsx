import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";
import { fetchSlip } from "../slip.server";
import { shopifyGraphQL } from "../admin-api.server";
import prisma from "../db.server";

const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

function verifyWebhookSignature(request: Request, body: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.error("[Webhook] SHOPIFY_WEBHOOK_SECRET not set!");
    return false;
  }

  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) {
    console.error("[Webhook] No x-shopify-hmac-sha256 header");
    return false;
  }

  const hash = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(body, "utf8")
    .digest("base64");

  const isValid = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
  if (!isValid) {
    console.error("[Webhook] Signature mismatch. Expected:", hash, "Got:", hmacHeader);
  }
  return isValid;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.arrayBuffer();
    const bodyText = new TextDecoder().decode(body);

    // Verify webhook signature using raw bytes
    if (!verifyWebhookSignature(request, bodyText)) {
      console.warn("Invalid webhook signature");
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const event = JSON.parse(bodyText);
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

    // Tag order only if there's a danger or caution alert
    if (slip.alert && (slip.alert.level === "danger" || slip.alert.level === "caution")) {
      console.log(`[Webhook] Order ${orderName} has weather alert: ${slip.alert.headline}`);

      const tagResult = await shopifyGraphQL(
        `mutation addTags($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id tags } userErrors { field message } } }`,
        {
          id: `gid://shopify/Order/${orderId}`,
          tags: ["weather-hold"],
        },
      );

      console.log(`[Webhook] Tag mutation result:`, JSON.stringify(tagResult));

      if (tagResult.data?.tagsAdd?.userErrors?.length) {
        console.error(`[Webhook] Error tagging order ${orderName}:`, JSON.stringify(tagResult.data.tagsAdd.userErrors));
      } else if (tagResult.data?.tagsAdd?.node?.tags) {
        console.log(`[Webhook] Successfully tagged order ${orderName}. Tags:`, tagResult.data.tagsAdd.node.tags);
      } else {
        console.log(`[Webhook] Tag mutation response:`, JSON.stringify(tagResult));
      }

      return json({ status: "tagged_for_weather_hold", alert: { headline: slip.alert.headline, body: slip.alert.body, level: slip.alert.level } });
    }

    console.log(`[Webhook] Order ${orderName} has no weather alert`);
    return json({ status: "no_alert" });
  } catch (error) {
    console.error("[Webhook] Error processing order webhook:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};
