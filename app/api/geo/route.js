/*
 * /api/geo — best-effort visitor country from Vercel's edge headers.
 *
 * Vercel injects `x-vercel-ip-country` (ISO 3166-1 alpha-2) on every request,
 * derived from the connection IP — no browser geolocation permission needed.
 * Returns just the code (e.g. "PT"); the client maps it to a country name and
 * uses it as the default "primary country" for TV listings.
 */

export const dynamic = "force-dynamic";

export function GET(request) {
  const h = request.headers;
  const code = String(
    h.get("x-vercel-ip-country") || h.get("x-country") || h.get("cf-ipcountry") || ""
  ).toUpperCase().slice(0, 2);
  return Response.json(
    { country: /^[A-Z]{2}$/.test(code) ? code : null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
