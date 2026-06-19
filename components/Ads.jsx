/*
 * Ads — third-party ad-network loader snippets.
 *
 * The loaders are self-inserting IIFEs provided by the ad network: each creates
 * its own <script> and inserts it next to the currently-last script on the page.
 * They're rendered verbatim as inline scripts (the same dangerouslySetInnerHTML
 * pattern this codebase already uses for JSON-LD and the SEO page scripts) so the
 * network's loader behaves exactly as shipped.
 *
 * The list of loaders is managed from the admin page (/admin) and stored in
 * KV (lib/ads-store); it falls back to built-in defaults when nothing is saved.
 *
 * Mounted on the fixtures list (home) and the per-game detail pages.
 */

import { activeAdSrcs, loaderScript, DEFAULT_AD_SRCS } from "@/lib/ads-store";

export default async function Ads() {
  let srcs;
  try {
    srcs = await activeAdSrcs();
  } catch (e) {
    // Never let an ad-config read break the page — fall back to the defaults.
    srcs = DEFAULT_AD_SRCS;
  }
  return (
    <>
      {srcs.map((src, i) => (
        <script key={i} dangerouslySetInnerHTML={{ __html: loaderScript(src) }} />
      ))}
    </>
  );
}
