import { shopifyGraphQL } from "./admin-api.server";

interface ShopMeta {
  name: string | null;
  logoUrl: string | null;
  domain: string | null;
}

let cached: ShopMeta | null = null;
let cachedAt = 0;
const TTL = 60 * 60 * 1000;

export async function getShopMeta(): Promise<ShopMeta> {
  if (cached && Date.now() - cachedAt < TTL) return cached;

  const data = await shopifyGraphQL(`
    query {
      shop {
        name
        myshopifyDomain
        brand {
          logo { image { url } }
          squareLogo { image { url } }
        }
      }
    }
  `).catch(() => null);

  const shop = data?.data?.shop;
  cached = {
    name: shop?.name ?? null,
    domain: shop?.myshopifyDomain ?? null,
    logoUrl:
      shop?.brand?.logo?.image?.url ??
      shop?.brand?.squareLogo?.image?.url ??
      null,
  };
  cachedAt = Date.now();
  return cached;
}
