/*
 * lib/digest-image-endpoint — factory for the public, ready-to-post image
 * endpoints: /image/landscape, /image/square and /image/portrait.
 *
 * Each serves the day's top-games card as a finished PNG with the format baked
 * in, so an automated client (e.g. Claude cowork) can post it straight from the
 * URL — no options to pick, nothing to download. They delegate to the existing
 * /og/today renderer (@vercel/og) so there is a single source of truth for the
 * card. ?date=YYYY-MM-DD and ?n are still honoured but default to today.
 *
 * "portrait" is the public name for the 9:16 story canvas (1080×1920).
 *
 * ?date=YYYY-MM-DD and ?n are honoured (default today). The square card assumes
 * a highlight — it features the day's top game in a hero by default; pass
 * ?highlight=<fmid> to pin another game or ?highlight=none to opt out.
 */

import { GET as renderOg } from "@/app/og/[[...seg]]/route";

// Public format name → the /og/today ?format value.
const FORMAT_ALIAS = { landscape: "landscape", square: "square", portrait: "story" };

// Build a GET handler that always renders the digest card in `publicFormat`.
export function digestImageHandler(publicFormat) {
  const format = FORMAT_ALIAS[publicFormat] || "landscape";
  return async function GET(req) {
    const src = new URL(req.url);
    const target = new URL("/og/today", src.origin);
    target.searchParams.set("format", format);
    const date = src.searchParams.get("date");
    const n = src.searchParams.get("n");
    const highlight = src.searchParams.get("highlight");
    if (date) target.searchParams.set("date", date);
    if (n) target.searchParams.set("n", n);
    // The square card assumes a highlight: it features the day's top game in a
    // hero above the list by default. Callers can still pin a specific game with
    // ?highlight=<fmid> or opt out with ?highlight=none (anything non-auto and
    // non-numeric leaves the list un-highlighted).
    if (highlight) target.searchParams.set("highlight", highlight);
    else if (publicFormat === "square") target.searchParams.set("highlight", "auto");
    // Reuse the /og/today branch of the OG renderer (routeId === "today").
    return renderOg(new Request(target, { headers: req.headers }), {
      params: Promise.resolve({ seg: ["today"] }),
    });
  };
}
