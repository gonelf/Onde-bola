/*
 * (app) layout — the main interactive app (home). Nested under the minimal root
 * layout, so it does NOT render <html>/<body>; it only brings the global
 * stylesheet (scoped to this segment), the page metadata, the WebSite/
 * WebApplication JSON-LD, and Vercel Analytics.
 */

import { Analytics } from "@vercel/analytics/react";
import "../../assets/styles.css";

const SITE_URL = "https://hojehabola.com";
const TITLE = "Hoje Há Bola — Football on TV worldwide & where to watch";
const DESCRIPTION =
  "See today's football games from around the world and which TV channels and streaming services are broadcasting them in your country — live scores, kickoff times and where to watch, free or paid.";

// Static 1200×630 branded share card (the "Hoje Há Bola" logo over a stadium).
// A real raster image so it unfurls reliably on Facebook, X/Twitter, WhatsApp,
// LinkedIn, Reddit, etc. — unlike an SVG, and without depending on the live
// /og/today render succeeding at scrape time.
const OG_IMAGE = "/assets/og-home.jpg";
const OG_ALT =
  "Hoje Há Bola — football worldwide and where to watch it on TV";

export const metadata = {
  title: {
    default: TITLE,
    template: "%s · Hoje Há Bola",
  },
  applicationName: "Hoje Há Bola",
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
  authors: [{ name: "Hoje Há Bola" }],
  creator: "Hoje Há Bola",
  publisher: "Hoje Há Bola",
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
    title: "Hoje Há Bola",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    siteName: "Hoje Há Bola",
    title: TITLE,
    description:
      "See today's football games from around the world and which TV channels and streaming services are broadcasting them in your country — live scores, kickoff times and where to watch.",
    url: SITE_URL,
    locale: "en",
    images: [
      {
        url: OG_IMAGE,
        type: "image/jpeg",
        width: 1200,
        height: 630,
        alt: OG_ALT,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description:
      "Today's football games worldwide and which TV channels and streaming services are broadcasting them in your country.",
    images: [{ url: OG_IMAGE, alt: OG_ALT }],
  },
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>",
        type: "image/svg+xml",
      },
    ],
  },
  other: { "google-adsense-account": "ca-pub-2180847694344203" },
};

// WebSite + WebApplication structured data (ported verbatim from index.html).
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: "Hoje Há Bola",
      url: `${SITE_URL}/`,
      description:
        "Hoje Há Bola lists football matches worldwide and the TV channels and streaming services broadcasting them in each country.",
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/icon.svg`,
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: "Hoje Há Bola",
      description:
        "Today's football games from around the world and which TV channels and streaming services are broadcasting them in your country.",
      inLanguage: "en",
      publisher: { "@id": `${SITE_URL}/#org` },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_URL}/?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: "Hoje Há Bola",
      url: `${SITE_URL}/`,
      applicationCategory: "SportsApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript.",
      isAccessibleForFree: true,
      publisher: { "@id": `${SITE_URL}/#org` },
      description:
        "See today's football games worldwide and which TV channels and streaming services broadcast them in your country, with live scores and kickoff times.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    },
  ],
};

export default function AppLayout({ children }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      {children}
      <Analytics />
    </>
  );
}
