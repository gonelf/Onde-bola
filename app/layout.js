/*
 * Root layout — provides the <html>/<body> shell for every route.
 *
 * Deliberately minimal and style-free: the main app's global stylesheet is
 * imported by the nested (app) layout (so it stays scoped to the app and does
 * not leak onto the standalone SEO pages under (seo), which ship their own
 * inline <style>).
 */

import AdDebug from "@/components/AdDebug";

const SITE_URL = "https://hojehabola.com";

export const metadata = {
  metadataBase: new URL(SITE_URL),
};

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
