import { login } from "../shopify.server";

export const loader = async ({ request }: { request: Request }) => login(request);
