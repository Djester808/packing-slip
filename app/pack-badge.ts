// Live-animal keywords. "shrimp$"/"snails?$" are anchored to the end (so "Baby
// Shrimp Food" / "Shrimp King" food don't match); the others can appear anywhere
// (e.g. "Crayfish Mix"). Caridina shrimp are titled "... Shrimp" (caridina is only
// a collection name), so shrimp$ already covers them.
const LIVE_ANIMAL_RE = /shrimp$|snails?$|crayfish|crab|culls?|skittles|\(s\s*grade\)/i;
// Food / supplements / tools that may contain an animal word but are NOT livestock.
// Applied to every keyword so "Crab Cuisine Food", "Crayfish Food", etc. never badge.
const NON_ANIMAL_RE = /\b(food|cuisine|pellet|wafer|flake|gel|powder|supplement|formula|feed|diet|treat|net|trap)\b/i;

// Products in a livestock collection (e.g. "Freshwater Fish") are live animals even
// when the title has no animal keyword (fish are named by species). Matches the
// collection handle ("freshwater-fish") or title ("Freshwater Fish").
const LIVESTOCK_COLLECTION_RE = /freshwater.?fish/i;
export function isLivestockCollection(
  collections: Array<{ handle?: string | null; title?: string | null }>,
): boolean {
  return collections.some(
    (c) => LIVESTOCK_COLLECTION_RE.test(c.handle ?? "") || LIVESTOCK_COLLECTION_RE.test(c.title ?? ""),
  );
}

// True for live animals. Every live animal gets the +1/5 extras bonus (DOA insurance)
// — snails, crabs, crayfish, caridina and fish are all counted like neocaridina.
// `isLivestock` (e.g. from collection membership) forces a title to count as live.
export function isLiveAnimal(title: string, isLivestock = false): boolean {
  if (isLivestock) return true;
  return LIVE_ANIMAL_RE.test(title) && !NON_ANIMAL_RE.test(title);
}

// Wednesday ships only 2-day/overnight service or dry goods. An order is eligible
// for the restricted Wednesday slot if its method is fast service, or it contains
// no live animals (fish included, via the isFish/collection flag).
const FAST_METHOD_RE = /overnight|next.?day|2.?day|2nd day|two.?day|express/i;
export function isFastMethod(method: string): boolean {
  return FAST_METHOD_RE.test(method);
}
export function isWednesdayEligible(
  shippingMethod: string,
  items: Array<{ title?: string | null; isFish?: boolean }>,
): boolean {
  if (isFastMethod(shippingMethod)) return true;
  return !items.some((li) => isLiveAnimal(li.title ?? "", li.isFish ?? false));
}

export function getPackBadgeTotal(
  variant: string | null,
  quantity: number,
  title: string,
  isLivestock = false,
): number {
  // Named pack variants — always live animals, no title check needed
  if (variant) {
    if (/breeder\s*pack/i.test(variant) || /ultimate\s*pack/i.test(variant)) {
      const total = 10 * quantity;
      const extras = Math.floor(total / 5);
      return total + extras;
    }
  }

  // All other cases: only apply to live animals (every live animal gets extras)
  if (!isLiveAnimal(title, isLivestock)) return quantity;

  // Numeric variant → pack size × quantity
  if (variant) {
    const m = variant.match(/\b(\d+)\b/);
    if (m) {
      const count = parseInt(m[1], 10);
      if (count > 1) {
        const total = count * quantity;
        return total + Math.floor(total / 5);
      }
    }
  }

  // No variant (or non-numeric variant) → quantity is the animal count
  return quantity + Math.floor(quantity / 5);
}

export function getPackBadge(
  variant: string | null,
  quantity: number,
  title: string,
  isLivestock = false,
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

  // All other cases: only apply to live animals (every live animal gets extras)
  if (!isLiveAnimal(title, isLivestock)) return null;

  // Numeric variant → pack size × quantity
  if (variant) {
    const m = variant.match(/\b(\d+)\b/);
    if (m) {
      const count = parseInt(m[1], 10);
      if (count > 1) {
        const total = count * quantity;
        return { text: `= ${total + Math.floor(total / 5)} TOTAL`, bg: "#b45309" };
      }
    }
  }

  // No variant (or non-numeric variant) → quantity is the animal count
  return { text: `= ${quantity + Math.floor(quantity / 5)} TOTAL`, bg: "#b45309" };
}
