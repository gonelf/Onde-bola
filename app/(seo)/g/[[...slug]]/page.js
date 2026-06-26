/*
 * /g/<…> — the per-game and league-hub SEO pages.
 *
 * One catch-all route handles every /g form (the old vercel.json rewrites):
 *   /g/<id>                              -> per-game page (by FotMob id)
 *   /g/<league>                          -> league hub
 *   /g/<date>/<home>-vs-<away>           -> per-game page (resolved from slug)
 *   /g/<league>/<date>/<home>-vs-<away>  -> per-game page
 *   /g?home=&away=…                      -> per-game page (legacy query)
 *
 * Standalone document: the (seo) layout provides only <html>/<body>; this page
 * brings its own <head> (generateMetadata), inline <style> and JSON-LD.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildShare, buildLeague } from "@/lib/seo-render";
import { langForCountryCode } from "@/lib/i18n";
import { brandForHost, langForBrand } from "@/lib/brand";
import { forwardAuthHeaders } from "@/lib/forward-auth";
import AdSlot from "@/components/AdSlot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function getContext() {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  const code = h.get("x-vercel-ip-country") || h.get("x-country") || h.get("cf-ipcountry") || "";
  // English-only domains pin English; the default brand follows the visitor.
  const lang = langForBrand(brandForHost(host), langForCountryCode(code));
  return { origin: `${proto}://${host}`, lang, auth: forwardAuthHeaders(h) };
}

async function build(params, searchParams) {
  const { origin, lang, auth } = await getContext();
  const parts = (params && params.slug) || [];
  const query = (await searchParams) || {};
  // A single non-numeric segment is a league hub; everything else is a game page.
  if (parts.length === 1 && !/^\d+$/.test(parts[0])) {
    return buildLeague({ origin, lang, leagueSlug: parts[0], auth });
  }
  return buildShare({ origin, lang, parts, query, auth });
}

export async function generateMetadata({ params, searchParams }) {
  const p = await params;
  const built = await build(p, searchParams);
  if (built.redirect) return {};
  const images = built.ogImage
    ? [{ url: built.ogImage, type: "image/png", width: 1200, height: 630, alt: built.headline }]
    : undefined;
  return {
    title: built.title,
    description: built.description,
    robots: built.robots,
    alternates: { canonical: built.canonical },
    openGraph: {
      type: built.ogType,
      siteName: built.siteName,
      title: built.headline,
      description: built.description,
      url: built.canonical,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: built.headline,
      description: built.description,
      images: built.ogImage ? [built.ogImage] : undefined,
    },
    icons: {
      icon: "/icon.svg",
    },
  };
}

export default async function GamePage({ params, searchParams }) {
  const p = await params;
  const built = await build(p, searchParams);
  if (built.redirect) redirect(built.redirect);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: built.css }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: built.jsonLd }} />
      <AdSlot name="detail-top" />
      <div dangerouslySetInnerHTML={{ __html: built.bodyHtml }} />
      <AdSlot name="detail-bottom" />
    </>
  );
}
