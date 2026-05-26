// Regular expression to match live animal product titles
const LIVE_ANIMAL_RE = /shrimp$|snail|crayfish|crab|culls|skittles|\(s\s*grade\)/i;

export function getPackBadge(
  variant: string | null,
  quantity: number,
  title: string,
): { text: string; bg: string } | null {
  // Named pack variants — always live animals, no title check needed
  if (variant) {
    if (/breeder\s*pack/i.test(variant) || /ultimate\s*pack/i.test(variant)) {
      const isUltimate = /ultimate\s*pack/i.test(variant);
      const total = 10 * quantity;
      const extras = Math.floor(total / 5);
      const males = 2 * quantity;
      const females = 8 * quantity;
      const label = isUltimate
        ? `ULTIMATE = ${total + extras} TOTAL (${males}M/${females}F)`
        : `= ${total + extras} TOTAL (${males}M/${females}F)`;
      return { text: label, bg: isUltimate ? "#5c007a" : "#007a5a" };
    }
  }

  // Skittles: check title too, since variant may be something like "Normal"
  if (/skittles/i.test(title) || (variant && /skittles\s*pack/i.test(variant))) {
    const extras = Math.floor(quantity / 5);
    return { text: `= ${quantity + extras} TOTAL`, bg: "#b45309" };
  }

  // All other cases: only apply to live animal titles
  if (!LIVE_ANIMAL_RE.test(title)) return null;

  // Numeric variant → pack size × quantity
  if (variant) {
    const m = variant.match(/\b(\d+)\b/);
    if (m) {
      const count = parseInt(m[1], 10);
      if (count > 1) {
        const total = count * quantity;
        const extras = Math.floor(total / 5);
        return { text: `= ${total + extras} TOTAL`, bg: "#b45309" };
      }
    }
  }

  // No variant (or non-numeric variant) → always show total for transparency
  const extras = Math.floor(quantity / 5);
  return { text: `= ${quantity + extras} TOTAL`, bg: "#b45309" };
}
