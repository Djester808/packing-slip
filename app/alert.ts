export type AlertLevel = "safe" | "caution" | "danger" | "unknown";

export interface ShipAlert {
  level: AlertLevel;
  headline: string;
  body: string;
  color: string;
  bg: string;
}

export function getAlert(
  maxTempF: number | null,
  minTempF: number | null,
  dontShipAbove: number,
  icePackAbove: number,
  dontShipBelow: number,
  cautionBelow: number,
): ShipAlert {
  if (maxTempF === null) {
    return {
      level: "unknown",
      headline: "Forecast unavailable",
      body: "Could not retrieve a weather forecast for this delivery address and date. Use your judgement.",
      color: "#6d7175",
      bg: "#f6f6f7",
    };
  }

  const high = Math.round(maxTempF);
  const low  = minTempF !== null ? Math.round(minTempF) : null;

  if (high >= dontShipAbove) {
    return {
      level: "danger",
      headline: `Do not ship — ${high}°F high expected`,
      body: `A high of ${high}°F is forecast for the estimated delivery day. Live animals are unlikely to survive transit. Hold the shipment or contact the customer to arrange a safer ship date.`,
      color: "#d72c0d",
      bg: "#fff4f4",
    };
  }

  if (low !== null && low <= dontShipBelow) {
    return {
      level: "danger",
      headline: `Do not ship — ${low}°F low expected`,
      body: `A low of ${low}°F is forecast for the estimated delivery day. Temperatures are too cold for safe transit. Hold the shipment or contact the customer to arrange a safer ship date.`,
      color: "#1e6fbf",
      bg: "#f0f5ff",
    };
  }

  if (high >= icePackAbove) {
    return {
      level: "caution",
      headline: `Ice pack suggested · Consider faster shipping — ${high}°F high expected`,
      body: `A high of ${high}°F is forecast for the estimated delivery day. Include an ice pack and consider upgrading to a faster shipping method to reduce transit time.`,
      color: "#b98900",
      bg: "#fffbe6",
    };
  }

  if (low !== null && low <= cautionBelow) {
    return {
      level: "caution",
      headline: `Heat pack recommended — ${low}°F low expected`,
      body: `A low of ${low}°F is forecast for the estimated delivery day. Include a heat pack to protect against cold stress during transit.`,
      color: "#b98900",
      bg: "#fffbe6",
    };
  }

  const tempSummary = low !== null ? `${high}°F high / ${low}°F low` : `${high}°F high`;
  return {
    level: "safe",
    headline: `Safe to ship — ${tempSummary} expected`,
    body: `Temperatures look fine for the estimated delivery day.`,
    color: "#007a5a",
    bg: "#f1f8f5",
  };
}
