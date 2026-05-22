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
  dontShipAbove: number,
  icePackAbove: number,
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

  const temp = Math.round(maxTempF);

  if (maxTempF >= dontShipAbove) {
    return {
      level: "danger",
      headline: `Do not ship — ${temp}°F high expected`,
      body: `A high of ${temp}°F is forecast for the estimated delivery day. Live animals are unlikely to survive transit. Hold the shipment or contact the customer to arrange a safer ship date.`,
      color: "#d72c0d",
      bg: "#fff4f4",
    };
  }

  if (maxTempF >= icePackAbove) {
    return {
      level: "caution",
      headline: `Ice pack required · Consider faster shipping — ${temp}°F high expected`,
      body: `A high of ${temp}°F is forecast for the estimated delivery day. Include an ice pack and consider upgrading to a faster shipping method to reduce transit time.`,
      color: "#b98900",
      bg: "#fffbe6",
    };
  }

  return {
    level: "safe",
    headline: `Safe to ship — ${temp}°F high expected`,
    body: `Temperatures look fine for the estimated delivery day.`,
    color: "#007a5a",
    bg: "#f1f8f5",
  };
}
