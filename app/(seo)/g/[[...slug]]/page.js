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

export const dynamic = "force-dynamic";

async function getOrigin() {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  return `${proto}://${host}`;
}

async function build(params, searchParams) {
  const origin = await getOrigin();
  const parts = (params && params.slug) || [];
  const query = (await searchParams) || {};
  // A single non-numeric segment is a league hub; everything else is a game page.
  if (parts.length === 1 && !/^\d+$/.test(parts[0])) {
    return buildLeague({ origin, leagueSlug: parts[0] });
  }
  return buildShare({ origin, parts, query });
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
      siteName: "Hoje Há Bola",
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
      icon:
        "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>",
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
      <div dangerouslySetInnerHTML={{ __html: built.bodyHtml }} />
    </>
  );
}
