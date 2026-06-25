/*
 * lib/brand — central brand registry, keyed by request host.
 *
 * The same app runs on several domains. The default brand is the Portuguese
 * "Hoje Há Bola"; footietoday.com and footytoday.co are English-first spins on
 * the same product — their own wordmark plus a pinned English locale, so the
 * SEO copy, page titles and share images stay in English regardless of where
 * the visitor is (the default brand still follows the visitor's country).
 *
 * Every host-aware server surface (the /g and /today SEO pages, the share
 * images, the sitemap, robots, llms.txt, the plain-text post, the home shell)
 * resolves its identity through here, so adding or renaming a domain is a
 * one-line change instead of a find-and-replace across the codebase.
 */

export const DEFAULT_BRAND = {
  key: "hojehabola",
  name: "Hoje Há Bola",
  domain: "hojehabola.com",
  tagline: "Football worldwide & where to watch it",
  // null → follow the visitor's country (Portuguese in Portugal, English else).
  lang: null,
};

const BRANDS = {
  "footietoday.com": {
    key: "footie",
    name: "Footie Today",
    domain: "footietoday.com",
    tagline: "Football on TV today & where to watch it",
    lang: "en",
  },
  "footytoday.co": {
    key: "footy",
    name: "Footy Today",
    domain: "footytoday.co",
    tagline: "Football on TV today & where to watch it",
    lang: "en",
  },
};

// Normalise a Host header value: lower-case, drop any port and a leading "www.".
// Tolerates a comma-joined x-forwarded-host ("a.com, b.com") by taking the first.
export function normalizeHost(host) {
  return String(host || "")
    .toLowerCase()
    .trim()
    .split(",")[0]
    .trim()
    .split(":")[0]
    .replace(/^www\./, "");
}

// Resolve the brand for a host (e.g. "footietoday.com", "www.footytoday.co:443").
export function brandForHost(host) {
  return BRANDS[normalizeHost(host)] || DEFAULT_BRAND;
}

// Resolve the brand from an origin/URL string (e.g. "https://footietoday.com").
// Falls back to treating the input as a bare host if it does not parse.
export function brandForOrigin(origin) {
  let host = origin;
  try {
    host = new URL(origin).host;
  } catch (e) {
    host = origin;
  }
  return brandForHost(host);
}

// Language for a brand: an English-only domain pins "en"; otherwise fall back to
// the per-visitor language the caller already computed (Portuguese for Portugal).
export function langForBrand(brand, fallbackLang) {
  return (brand && brand.lang) || fallbackLang;
}

// Split a wordmark into a leading part and its final word, so renderers can
// accent the last word: "Hoje Há |Bola|", "Footie |Today|".
export function brandWordmark(brand) {
  const name = (brand && brand.name) || DEFAULT_BRAND.name;
  const i = name.lastIndexOf(" ");
  return i < 0 ? { head: "", tail: name } : { head: name.slice(0, i), tail: name.slice(i + 1) };
}
