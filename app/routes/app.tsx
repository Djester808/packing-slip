import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useNavigation } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async (_: LoaderFunctionArgs) => {
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <style>{`@keyframes _spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <NavMenu>
        <Link to="/app" rel="home">Orders</Link>
        <Link to="/app/inventory">Inventory</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      {navigation.state === "loading" && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: "48px", height: "48px", border: "3px solid #e1e3e5", borderTop: "3px solid #007a5a", borderRadius: "50%", margin: "0 auto 16px", animation: "_spin 1s linear infinite" }} />
            <div style={{ fontSize: "14px", color: "#1a1a1a", fontWeight: 600 }}>Loading…</div>
          </div>
        </div>
      )}
      <Outlet />
    </AppProvider>
  );
}
