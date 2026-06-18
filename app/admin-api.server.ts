const API_VERSION = "2025-01";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SHOPIFY_API_KEY!,
    client_secret: process.env.SHOPIFY_API_SECRET!,
  });

  const response = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params },
  );

  if (!response.ok) throw new Error(`Failed to refresh Shopify access token: ${response.status}`);

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
  return cachedToken.value;
}

export async function shopifyGraphQL(query: string, variables?: object) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify API error: ${response.status} — ${body}`);
  }
  return response.json();
}

export async function getShopLogo(): Promise<string | null> {
  try {
    const data = await shopifyGraphQL(`
      query {
        shop {
          name
        }
      }
    `);
    // TODO: Implement logo retrieval from app settings or hardcode as config
    return null;
  } catch {
    return null;
  }
}
