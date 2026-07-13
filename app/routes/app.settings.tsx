import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { Page, Card, Text, BlockStack, TextField, Button, InlineStack, Divider, Banner, Checkbox } from "@shopify/polaris";
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
    const dontShipAbove = parseInt(form.get("dontShipAbove") as string);
    const heatHoldAbove = parseInt(form.get("heatHoldAbove") as string);
    const icePackAbove  = parseInt(form.get("icePackAbove")  as string);
    const dontShipBelow = parseInt(form.get("dontShipBelow") as string);
    const cautionBelow  = parseInt(form.get("cautionBelow")  as string);
    const data = {
      ...(isFinite(dontShipAbove) && { dontShipAbove }),
      ...(isFinite(heatHoldAbove) && { heatHoldAbove }),
      ...(isFinite(icePackAbove)  && { icePackAbove }),
      ...(isFinite(dontShipBelow) && { dontShipBelow }),
      ...(isFinite(cautionBelow)  && { cautionBelow }),
    };
    console.log("[save-thresholds] saving:", data);
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: data,
      create: { id: "singleton" },
    });
    return json({ ok: true, intent });
  }

  if (intent === "save-print-settings") {
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: { printLocalOrders: form.get("printLocalOrders") === "true" },
      create: { id: "singleton" },
    });
    return json({ ok: true, intent });
  }

  if (intent === "save-rollover-settings") {
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: { rolloverEnabled: form.get("rolloverEnabled") === "true" },
      create: { id: "singleton" },
    });
    return json({ ok: true, intent });
  }

  if (intent === "save-logo") {
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: { logoUrl: form.get("logoUrl") as string || null },
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

  const [dontShipAbove, setDontShipAbove] = useState(String(settings.dontShipAbove));
  const [heatHoldAbove, setHeatHoldAbove] = useState(String(settings.heatHoldAbove));
  const [icePackAbove, setIcePackAbove] = useState(String(settings.icePackAbove));
  const [dontShipBelow, setDontShipBelow] = useState(String(settings.dontShipBelow));
  const [cautionBelow, setCautionBelow] = useState(String(settings.cautionBelow));
  const [printLocalOrders, setPrintLocalOrders] = useState(settings.printLocalOrders);
  const [rolloverEnabled, setRolloverEnabled] = useState(settings.rolloverEnabled);
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || "");

  return (
    <Page title="Settings">
      <BlockStack gap="500">

        {/* Logo */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Logo</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              URL to your logo image for weather delay emails
            </Text>
            <BlockStack gap="300">
              <TextField
                label="Logo URL"
                name="logoUrl"
                type="url"
                value={logoUrl}
                onChange={setLogoUrl}
                placeholder="https://example.com/logo.png"
                autoComplete="off"
              />
              {logoUrl && (
                <div style={{ padding: "8px", background: "#f6f6f7", borderRadius: "4px" }}>
                  <img src={logoUrl} alt="Logo preview" style={{ maxWidth: "72px", maxHeight: "72px", borderRadius: "50%" }} />
                </div>
              )}
              <InlineStack gap="300" blockAlign="center">
                <Button
                  loading={isSaving}
                  variant="primary"
                  onClick={() => fetcher.submit(
                    { intent: "save-logo", logoUrl },
                    { method: "post" },
                  )}
                >
                  Save logo
                </Button>
                {saved && (fetcher.data as any)?.intent === "save-logo" && (
                  <Text as="span" variant="bodySm" tone="success">Saved</Text>
                )}
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Temperature thresholds */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Temperature thresholds</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Based on the forecast high on the estimated delivery day.
            </Text>
            <BlockStack gap="300">
              <TextField
                label="Insulated box above (°F)"
                name="dontShipAbove"
                type="number"
                value={dontShipAbove}
                onChange={setDontShipAbove}
                helpText="Orange alert — ship in an insulated oversized box (still ships)"
                autoComplete="off"
              />
              <TextField
                label="Do not ship above (°F)"
                name="heatHoldAbove"
                type="number"
                value={heatHoldAbove}
                onChange={setHeatHoldAbove}
                helpText="Red alert — too hot, hold the shipment and email the customer"
                autoComplete="off"
              />
              <TextField
                label="Ice pack required above (°F)"
                name="icePackAbove"
                type="number"
                value={icePackAbove}
                onChange={setIcePackAbove}
                helpText="Orange alert — include ice pack and consider faster shipping"
                autoComplete="off"
              />
              <TextField
                label="Do not ship below (°F)"
                name="dontShipBelow"
                type="number"
                value={dontShipBelow}
                onChange={setDontShipBelow}
                helpText="Red alert — low too cold, hold the shipment"
                autoComplete="off"
              />
              <TextField
                label="Heat pack caution below (°F)"
                name="cautionBelow"
                type="number"
                value={cautionBelow}
                onChange={setCautionBelow}
                helpText="Orange alert — include heat pack and monitor conditions"
                autoComplete="off"
              />
              <InlineStack gap="300" blockAlign="center">
                <Button
                  loading={isSaving}
                  variant="primary"
                  onClick={() => fetcher.submit(
                    { intent: "save-thresholds", dontShipAbove, heatHoldAbove, icePackAbove, dontShipBelow, cautionBelow },
                    { method: "post" },
                  )}
                >
                  Save thresholds
                </Button>
                {saved && (fetcher.data as any)?.intent === "save-thresholds" && (
                  <Text as="span" variant="bodySm" tone="success">Saved</Text>
                )}
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Print settings */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Print settings</Text>
            <BlockStack gap="300">
              <Checkbox
                label="Include local orders in batch print"
                helpText="When off, local orders are skipped when printing a batch. Reship orders always print first, then oldest to newest."
                checked={printLocalOrders}
                onChange={setPrintLocalOrders}
              />
              <InlineStack gap="300" blockAlign="center">
                <Button
                  loading={isSaving}
                  variant="primary"
                  onClick={() => fetcher.submit(
                    { intent: "save-print-settings", printLocalOrders: String(printLocalOrders) },
                    { method: "post" },
                  )}
                >
                  Save
                </Button>
                {saved && (fetcher.data as any)?.intent === "save-print-settings" && (
                  <Text as="span" variant="bodySm" tone="success">Saved</Text>
                )}
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Shippable order calculation */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Shippable order calculation</Text>
            <BlockStack gap="300">
              <Checkbox
                label="Roll orders forward to a later ship day"
                helpText="When on, an order that can't ship on the selected day but clears a later ship day (Monday → Tuesday, plus Wednesday for 2-day/overnight/dry-goods orders) is added to the shippable list, tagged with that later date. When off, those orders stay on the hold list."
                checked={rolloverEnabled}
                onChange={setRolloverEnabled}
              />
              <InlineStack gap="300" blockAlign="center">
                <Button
                  loading={isSaving}
                  variant="primary"
                  onClick={() => fetcher.submit(
                    { intent: "save-rollover-settings", rolloverEnabled: String(rolloverEnabled) },
                    { method: "post" },
                  )}
                >
                  Save
                </Button>
                {saved && (fetcher.data as any)?.intent === "save-rollover-settings" && (
                  <Text as="span" variant="bodySm" tone="success">Saved</Text>
                )}
              </InlineStack>
            </BlockStack>
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
