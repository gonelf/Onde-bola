/*
 * (admin) layout — the React admin console shell. Nested under the minimal root
 * layout (so no <html>/<body> here); it brings the admin stylesheet + the shared
 * replay styles and the React top bar/drawer. Route-split CSS means these only
 * load on /admin/* routes, never on the public app.
 *
 * Auth: the existing edge middleware already gates /admin/:path*, so these React
 * routes are protected exactly like the static admin pages.
 */

import AdminNav from "@/components/AdminNav";
import "@/public/admin/admin.css";
import "@/assets/replay.css";

export const metadata = {
  title: "Admin · Hoje Há Bola",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }) {
  return (
    <>
      <AdminNav />
      {children}
    </>
  );
}
