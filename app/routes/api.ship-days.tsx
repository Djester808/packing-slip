import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { remainingShipDaysThisWeek, toDateString } from "../weather.server";

// Returns the remaining ship days in the same week after ?after=YYYY-MM-DD, in
// order: { days: [{ date, restricted }] }. Mon/Tue are unrestricted; Wednesday is
// restricted (2-day/overnight/dry goods). Roll-forward stays within the week, so
// orders that can't ship this week are held rather than pushed into next week.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const after = new URL(request.url).searchParams.get("after");
  if (!after) return json({ days: [] });
  const parsed = new Date(after);
  if (isNaN(parsed.getTime())) return json({ days: [] });
  return json({
    days: remainingShipDaysThisWeek(parsed).map((d) => ({ date: toDateString(d.date), restricted: d.restricted })),
  });
};
