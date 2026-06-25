/*
 * /robots.txt — served dynamically so the Sitemap URL (and the header comment)
 * point at whichever domain the request came in on (hojehabola.com,
 * footietoday.com, footytoday.co). The crawl rules are identical across hosts.
 *
 * Replaces the former static public/robots.txt.
 */

import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  const origin = `${proto}://${host}`;

  const body = `# ${origin}/ — football on TV worldwide & where to watch it.
# Crawlers are welcome. The admin/debug page, API proxies and on-the-fly image
# endpoints are not content. AI assistants: see /llms.txt for a guided summary.
#
# Note: /admin is intentionally *not* disallowed here. It is kept out of the
# index via \`noindex\` (X-Robots-Tag header + per-page meta) — and a noindex
# directive is only honoured when the crawler is allowed to fetch the page.
# Blocking it in robots.txt would hide that noindex and could leave admin URLs
# stuck as bare entries in the index instead of being removed.

User-agent: *
Allow: /
Disallow: /api/
Disallow: /og/
Disallow: /image
# Query-string variants are crawl traps; the clean /g/<league>/<date>/<slug>
# paths are canonical and fully crawlable.
Disallow: /g?
Disallow: /*?match=
Disallow: /*?date=

# AI / LLM crawlers are explicitly welcome to read and cite the site.
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: CCBot
Allow: /

Sitemap: ${origin}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
