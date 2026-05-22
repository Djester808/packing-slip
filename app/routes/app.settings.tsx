import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Card, Text, BlockStack, TextField, Button, InlineStack, Divider, Banner } from "@shopify/polaris";
import prisma from "../db.server";
import { seedDefaultRulesIfEmpty } from "../transit.server";

export const loader = async (_: LoaderFunctionArgs) => {
  await seedDefaultRulesIfEmpty();
  const [rules, settings] = await Promise.all([
    prisma.transitRule.findMany({ orderBy: { transitDays: "asc" } }),
    prisma.appSettings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } }),
  ]);
  return json({ rules, settings });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "save-thresholds") {
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: {
        dontShipAbove: parseInt(form.get("dontShipAbove") as string) || 90,
        icePackAbove: parseInt(form.get("icePackAbove") as string) || 80,
      },
      create: { id: "singleton" },
    });
    return json({ ok: true, intent });
  }

  if (intent === "add-rule") {
    const keyword = (form.get("keyword") as string).trim().toLowerCase();
    const days = parseInt(form.get("transitDays") as string);
    if (keyword && days > 0) {
      await prisma.transitRule.upsert({
        where: { keyword },
        update: { transitDays: days },
        create: { keyword, transitDays: days },
      });
    }
    return json({ ok: true, intent });
  }

  if (intent === "delete-rule") {
    await prisma.transitRule.delete({ where: { id: form.get("id") as string } });
    return json({ ok: true, intent });
  }

  return json({ ok: false, intent });
};

export default function Settings() {
  const { rules, settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSaving = fetcher.state !== "idle";
  const saved = fetcher.state === "idle" && (fetcher.data as any)?.ok;

  return (
    <Page title="Settings">
      <BlockStack gap="500">

        {/* Temperature thresholds */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Temperature thresholds</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Based on the forecast high on the estimated delivery day.
            </Text>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="save-thresholds" />
              <BlockStack gap="300">
                <TextField
                  label="Do not ship above (°F)"
                  name="dontShipAbove"
                  type="number"
                  defaultValue={String(settings.dontShipAbove)}
                  helpText="Red alert — hold the shipment"
                  autoComplete="off"
                />
                <TextField
                  label="Ice pack required above (°F)"
                  name="icePackAbove"
                  type="number"
                  defaultValue={String(settings.icePackAbove)}
                  helpText="Orange alert — include ice pack and consider faster shipping"
                  autoComplete="off"
                />
                <InlineStack gap="300" blockAlign="center">
                  <Button submit loading={isSaving} variant="primary">Save thresholds</Button>
                  {saved && (fetcher.data as any)?.intent === "save-thresholds" && (
                    <Text as="span" variant="bodySm" tone="success">Saved</Text>
                  )}
                </InlineStack>
              </BlockStack>
            </fetcher.Form>
          </BlockStack>
        </Card>

        {/* Transit day rules */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Shipping method → transit days</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              If the shipping method name contains a keyword, that transit day count is used to estimate the delivery date. First match wins.
            </Text>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f6f6f7" }}>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#6d7175", borderBottom: "1px solid #e1e3e5" }}>Keyword</th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#6d7175", borderBottom: "1px solid #e1e3e5" }}>Transit days</th>
                  <th style={{ padding: "8px 12px", borderBottom: "1px solid #e1e3e5" }} />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, i) => (
                  <tr key={rule.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0" }}>{rule.keyword}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0" }}>{rule.transitDays}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right" }}>
                      <fetcher.Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="intent" value="delete-rule" />
                        <input type="hidden" name="id" value={rule.id} />
                        <button type="submit" style={{ background: "none", border: "none", color: "#d72c0d", cursor: "pointer", fontSize: "12px" }}>
                          Remove
                        </button>
                      </fetcher.Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Divider />

            <Text as="p" variant="bodySm" fontWeight="semibold">Add rule</Text>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="add-rule" />
              <InlineStack gap="300" blockAlign="end">
                <div style={{ flex: 1 }}>
                  <TextField label="Keyword" name="keyword" placeholder="e.g. priority" autoComplete="off" />
                </div>
                <div style={{ width: "120px" }}>
                  <TextField label="Transit days" name="transitDays" type="number" placeholder="3" autoComplete="off" />
                </div>
                <Button submit>Add</Button>
              </InlineStack>
            </fetcher.Form>
          </BlockStack>
        </Card>

        {/* API key reminder */}
        <Banner title="OpenWeatherMap API key required" tone="info">
          <Text as="p" variant="bodySm">
            Make sure <strong>OPENWEATHER_API_KEY</strong> is set in your environment variables. A free account at openweathermap.org provides up to 1,000 calls/day and a 5-day forecast.
          </Text>
        </Banner>

      </BlockStack>
    </Page>
  );
}
