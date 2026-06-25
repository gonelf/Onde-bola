/*
 * (app) layout — the main interactive app (home). Nested under the minimal root
 * layout, so it does NOT render <html>/<body>; it only brings the global
 * stylesheet (scoped to this segment), the page metadata, the WebSite/
 * WebApplication JSON-LD, and Vercel Analytics.
 *
 * Both the metadata and the JSON-LD are resolved per request host, so the same
 * app presents the right brand identity on each domain it serves
 * (hojehabola.com, footietoday.com, footytoday.co).
 */

import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/react";
import { brandForHost } from "@/lib/brand";
import "../../assets/styles.css";
import "../../assets/replay.css";

const DESCRIPTION =
  "See today's football games from around the world and which TV channels and streaming services are broadcasting them in your country — live scores, kickoff times and where to watch, free or paid.";

// Static 1200×630 branded share card (the "Hoje Há Bola" logo over a stadium).
// A real raster image so it unfurls reliably on Facebook, X/Twitter, WhatsApp,
// LinkedIn, Reddit, etc. — unlike an SVG, and without depending on the live
// /og/today render succeeding at scrape time.
const OG_IMAGE = "/assets/og-home.jpg";

async function brandContext() {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  return { origin: `${proto}://${host}`, brand: brandForHost(host) };
}

export async function generateMetadata() {
  const { origin, brand } = await brandContext();
  const name = brand.name;
  const title = `${name} — Football on TV worldwide & where to watch`;
  const ogAlt = `${name} — football worldwide and where to watch it on TV`;

  return {
    title: {
      default: title,
      template: `%s · ${name}`,
    },
    applicationName: name,
    description: DESCRIPTION,
    keywords: [
      "football on TV",
      "soccer on TV",
      "where to watch football",
      "live football today",
      "football TV schedule",
      "football streaming",
      "TV listings football",
      "live scores",
    ],
    authors: [{ name }],
    creator: name,
    publisher: name,
    category: "sports",
    referrer: "origin-when-cross-origin",
    formatDetection: { telephone: false, email: false, address: false },
    robots: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
    alternates: { canonical: "/" },
    appleWebApp: {
      capable: true,
      title: name,
      statusBarStyle: "black-translucent",
    },
    openGraph: {
      type: "website",
      siteName: name,
      title,
      description:
        "See today's football games from around the world and which TV channels and streaming services are broadcasting them in your country — live scores, kickoff times and where to watch.",
      url: origin,
      locale: "en",
      images: [
        {
          url: OG_IMAGE,
          type: "image/jpeg",
          width: 1200,
          height: 630,
          alt: ogAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description:
        "Today's football games worldwide and which TV channels and streaming services are broadcasting them in your country.",
      images: [{ url: OG_IMAGE, alt: ogAlt }],
    },
    icons: {
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    },
    other: { "google-adsense-account": "ca-pub-2180847694344203" },
  };
}

// WebSite + WebApplication structured data, resolved per host/brand.
function jsonLd(origin, name) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#org`,
        name,
        url: `${origin}/`,
        description: `${name} lists football matches worldwide and the TV channels and streaming services broadcasting them in each country.`,
        logo: {
          "@type": "ImageObject",
          url: `${origin}/icon.svg`,
        },
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: `${origin}/`,
        name,
        description:
          "Today's football games from around the world and which TV channels and streaming services are broadcasting them in your country.",
        inLanguage: "en",
        publisher: { "@id": `${origin}/#org` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${origin}/?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "WebApplication",
        "@id": `${origin}/#app`,
        name,
        url: `${origin}/`,
        applicationCategory: "SportsApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript.",
        isAccessibleForFree: true,
        publisher: { "@id": `${origin}/#org` },
        description:
          "See today's football games worldwide and which TV channels and streaming services broadcast them in your country, with live scores and kickoff times.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      },
    ],
  };
}

export default async function AppLayout({ children }) {
  const { origin, brand } = await brandContext();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(origin, brand.name)) }}
      />
      {children}
      <Analytics />
    </>
  );
}
