/*
 * Web app manifest (served at /manifest.webmanifest). Next.js automatically
 * injects the <link rel="manifest"> tag. Makes the site installable as a PWA
 * and gives search engines/app surfaces a richer identity.
 *
 * Reading the request host makes the install identity (name/short_name) match
 * whichever brand the visitor is on, and renders the manifest per request.
 */

import { headers } from "next/headers";
import { brandForHost } from "@/lib/brand";

export default async function manifest() {
  const h = await headers();
  const name = brandForHost(h.get("x-forwarded-host") || h.get("host") || "hojehabola.com").name;
  return {
    name: `${name} — Football on TV worldwide`,
    short_name: name,
    description:
      "See today's football games from around the world and which TV channels and streaming services are broadcasting them in your country.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f1722",
    theme_color: "#0f1722",
    lang: "en",
    categories: ["sports", "entertainment", "news"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
  };
}
