/*
 * /text — public, ready-to-post plain-text digest of the day's selected games.
 *
 * The text sibling of the /image/* PNG endpoints: an automated client (or a
 * person) can GET this and paste the body straight into a WhatsApp / X /
 * Instagram post. Served as text/plain; UTF-8 so the flag emoji survive.
 *
 *   ?date=YYYY-MM-DD  the day (defaults to today, Europe/Lisbon)
 *   ?n=1..20          how many games to list (default 6)
 *   ?lang=pt|en       copy language (default Portuguese)
 *
 * See lib/digest-text for the ranking, flags and per-game Portuguese channel.
 */

import { headers } from "next/headers";
import { buildTextPost } from "@/lib/digest-text";
import { brandForHost } from "@/lib/brand";
import { forwardAuthHeaders } from "@/lib/forward-auth";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const url = new URL(req.url);
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") || url.protocol.replace(":", "") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || url.host || "hojehabola.com";
  const origin = `${proto}://${host}`;

  const date = url.searchParams.get("date") || "";
  const n = url.searchParams.get("n") || "";
  // An explicit ?lang wins; otherwise an English-only domain defaults to English
  // and everything else keeps the Portuguese default.
  const langParam = url.searchParams.get("lang");
  const lang = langParam === "en" || langParam === "pt"
    ? langParam
    : (brandForHost(host).lang || "pt");

  const { text } = await buildTextPost({ origin, date, n, lang, auth: forwardAuthHeaders(h) });

  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=600",
    },
  });
}
