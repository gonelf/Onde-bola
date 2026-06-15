/*
 * /api/geo — best-effort visitor country from Vercel's edge headers.
 *
 * Vercel injects `x-vercel-ip-country` (ISO 3166-1 alpha-2) on every request,
 * derived from the connection IP — no browser geolocation permission needed.
 * Returns just the code (e.g. "PT"); the client maps it to a country name and
 * uses it as the default "primary country" for TV listings.
 */

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const h = req.headers || {};
  const code = String(
    h["x-vercel-ip-country"] || h["x-country"] || h["cf-ipcountry"] || ""
  ).toUpperCase().slice(0, 2);
  res.status(200).json({ country: /^[A-Z]{2}$/.test(code) ? code : null });
};
