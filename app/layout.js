/*
 * Root layout — provides the <html>/<body> shell for every route.
 *
 * Deliberately minimal and style-free: the main app's global stylesheet is
 * imported by the nested (app) layout (so it stays scoped to the app and does
 * not leak onto the standalone SEO pages under (seo), which ship their own
 * inline <style>).
 */

import { headers } from "next/headers";
import AdDebug from "@/components/AdDebug";

// metadataBase is host-aware so the per-page canonical/OG URLs resolve to the
// domain the visitor is actually on (hojehabola.com, footietoday.com, …).
export async function generateMetadata() {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  return { metadataBase: new URL(`${proto}://${host}`) };
}

export const viewport = {
  themeColor: "#0f1722",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Opt-in (?addebug=1) live panel for diagnosing ad-loading issues. */}
        <AdDebug />
      </body>
    </html>
  );
}
