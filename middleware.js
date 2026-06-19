/*
 * Edge middleware: gate the admin surface behind HTTP Basic Auth.
 *
 * Protects the /admin debug/console page (served from public/admin.html, and
 * its legacy /admin.html path) and the admin write APIs (/api/overrides,
 * /api/ads) with ADMIN_USER / ADMIN_PASSWORD. Once the owner authenticates to
 * load the page, the browser reuses the credentials for the same-origin fetches
 * the page makes to those endpoints.
 *
 * Until the credentials are configured in the environment, nothing is gated —
 * so the read-only debug page keeps working out of the box. (The override API
 * separately fails closed on writes when creds are unset.)
 */

import { NextResponse } from "next/server";

export const config = {
  matcher: ["/admin", "/admin.html", "/api/overrides", "/api/ads"],
};

export function middleware(request) {
  const USER = process.env.ADMIN_USER;
  const PASS = process.env.ADMIN_PASSWORD;
  if (!USER || !PASS) return NextResponse.next();

  const header = request.headers.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    let decoded = "";
    try { decoded = atob(encoded); } catch (e) { decoded = ""; }
    const idx = decoded.indexOf(":");
    if (idx >= 0 && decoded.slice(0, idx) === USER && decoded.slice(idx + 1) === PASS) {
      return NextResponse.next();
    }
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Hoje Ha Bola admin", charset="UTF-8"' },
  });
}
