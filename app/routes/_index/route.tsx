import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const params = url.searchParams.toString();
  return redirect(params ? `/app?${params}` : "/app");
};
