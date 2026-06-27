/*
 * /image/<date>/text — the post text the /image tool shows beneath the card:
 * the day's selected games as a ready-to-post plain-text caption, for a specific
 * date. <date> is YYYY-MM-DD; an invalid value (incl. the literal "today")
 * falls back to today (Europe/Lisbon).
 *
 * It's the text sibling of /image/<date>/square — same ranked selection from the
 * cached fixtures feed, rendered as lines instead of a PNG — so an automated
 * client (e.g. Buffer) can pull the caption straight from the URL alongside the
 * square image. Shares its builder with the query-param form at /text.
 *
 *   ?n=1..20      how many games to list (default 6)
 *   ?lang=pt|en   copy language (defaults to the host brand's language, else pt)
 *
 * See lib/digest-text for the ranking, flags and per-game Portuguese channel.
 */

import { headers } from "next/headers";
import { buildTextPost } from "@/lib/digest-text";
import { brandForHost } from "@/lib/brand";

export const dynamic = "force-dynamic";

export async function GET(req, ctx) {
  const url = new URL(req.url);
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") || url.protocol.replace(":", "") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || url.host || "hojehabola.com";
  const origin = `${proto}://${host}`;

  // A YYYY-MM-DD path segment wins over ?date=; "today" (and anything else)
  // falls back to today inside buildTextPost.
  const params = (ctx && ctx.params) ? await ctx.params : {};
  const pathDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date || "") ? params.date : "";
  const date = pathDate || url.searchParams.get("date") || "";
  const n = url.searchParams.get("n") || "";
  // An explicit ?lang wins; otherwise an English-only domain defaults to English
  // and everything else keeps the Portuguese default.
  const langParam = url.searchParams.get("lang");
  const lang = langParam === "en" || langParam === "pt"
    ? langParam
    : (brandForHost(host).lang || "pt");

  const { text } = await buildTextPost({ origin, date, n, lang });

  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=600",
    },
  });
}
