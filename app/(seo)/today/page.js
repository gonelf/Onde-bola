/*
 * /today — shareable page of the day's top games (its OG card unfurls into the
 * /og/today digest image). Standalone document; ports lib/digest-page renderToday.
 */

import { headers } from "next/headers";
import { buildToday, todayYmd, clampN } from "@/lib/digest-render";
import { langForCountryCode } from "@/lib/i18n";
import { brandForHost, langForBrand } from "@/lib/brand";

export const dynamic = "force-dynamic";

async function build(searchParams) {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  const origin = `${proto}://${host}`;
  // English-only domains (footietoday.com / footytoday.co) pin English; the
  // default brand still follows the visitor's country.
  const lang = langForBrand(
    brandForHost(host),
    langForCountryCode(h.get("x-vercel-ip-country") || h.get("x-country") || h.get("cf-ipcountry") || "")
  );
  const sp = (await searchParams) || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date || "") ? sp.date : todayYmd();
  const n = clampN(sp.n);
  return buildToday({ origin, lang, date, n });
}

export async function generateMetadata({ searchParams }) {
  const built = await build(searchParams);
  return {
    title: built.title,
    description: built.description,
    robots: built.robots,
    alternates: { canonical: built.canonical },
    openGraph: {
      type: "website",
      siteName: built.siteName,
      title: built.headline,
      description: built.description,
      url: built.canonical,
      images: [{ url: built.ogImage, type: "image/png", width: 1200, height: 630, alt: built.headline }],
    },
    twitter: {
      card: "summary_large_image",
      title: built.headline,
      description: built.description,
      images: [built.ogImage],
    },
    icons: {
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>",
    },
  };
}

export default async function TodayPage({ searchParams }) {
  const built = await build(searchParams);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: built.css }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: built.jsonLd }} />
      <div dangerouslySetInnerHTML={{ __html: built.bodyHtml }} />
    </>
  );
}
