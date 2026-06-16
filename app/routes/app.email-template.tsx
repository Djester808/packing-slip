import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { Page, Card, Text, BlockStack, Button, InlineStack } from "@shopify/polaris";
import prisma from "../db.server";

const PLACEHOLDER = `Hi {customer},

We're holding your order ({order}) for now because the weather or transit time would put your livestock at risk in transit. We'll ship it on the next safe ship date and let you know once it's on the way.

Thanks for your patience,
Superior Shrimp`;

export const loader = async (_: LoaderFunctionArgs) => {
  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" }, update: {}, create: { id: "singleton" },
  });
  return json({ delayEmailTemplate: settings.delayEmailTemplate });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: { delayEmailTemplate: (form.get("delayEmailTemplate") as string) ?? "" },
    create: { id: "singleton" },
  });
  return json({ ok: true });
};

export default function EmailTemplate() {
  const { delayEmailTemplate } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSaving = fetcher.state !== "idle";
  const saved = fetcher.state === "idle" && (fetcher.data as any)?.ok;

  const [template, setTemplate] = useState(delayEmailTemplate);

  function copyToClipboard() {
    navigator.clipboard?.writeText(template);
  }

  return (
    <Page title="Delay email template">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="400">
            <Text as="p" variant="bodySm" tone="subdued">
              Keep the message you send customers when an order is held by a weather hold or
              shipping-speed limit. Edit it here, then copy it into your email when needed.
            </Text>

            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={PLACEHOLDER}
              rows={16}
              style={{
                width: "100%",
                padding: "12px 14px",
                border: "1px solid #c4cdd5",
                borderRadius: "8px",
                fontSize: "14px",
                fontFamily: "inherit",
                lineHeight: 1.6,
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />

            <InlineStack gap="300" blockAlign="center">
              <Button
                loading={isSaving}
                variant="primary"
                onClick={() => fetcher.submit({ delayEmailTemplate: template }, { method: "post" })}
              >
                Save template
              </Button>
              <Button onClick={copyToClipboard} disabled={!template.trim()}>
                Copy to clipboard
              </Button>
              {saved && <Text as="span" variant="bodySm" tone="success">Saved</Text>}
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
