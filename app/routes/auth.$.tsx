import { authenticate } from "../shopify.server";

export const loader = async ({ request }: { request: Request }) => {
  await authenticate.admin(request);
  return null;
};
