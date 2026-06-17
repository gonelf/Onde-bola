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

export const metadata = {
  title: TITLE,
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
  robots: { index: true, follow: true, "max-image-preview": "large" },
  alternates: { canonical: "/" },
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
        url: "/assets/og-image.svg",
        type: "image/svg+xml",
        width: 1200,
        height: 630,
        alt: "Hoje Há Bola — football on TV worldwide and where to watch it",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description:
      "Today's football games worldwide and which TV channels and streaming services are broadcasting them in your country.",
    images: [
      {
        url: "/assets/og-image.svg",
        alt: "Hoje Há Bola — football on TV worldwide and where to watch it",
      },
    ],
  },
  icons: {
    icon:
      "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>",
  },
  other: { "google-adsense-account": "ca-pub-2180847694344203" },
};

// WebSite + WebApplication structured data (ported verbatim from index.html).
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: "Hoje Há Bola",
      description:
        "Today's football games from around the world and which TV channels and streaming services are broadcasting them in your country.",
      inLanguage: "en",
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
