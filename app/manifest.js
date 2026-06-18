/*
 * Web app manifest (served at /manifest.webmanifest). Next.js automatically
 * injects the <link rel="manifest"> tag. Makes the site installable as a PWA
 * and gives search engines/app surfaces a richer identity.
 */

export default function manifest() {
  return {
    name: "Hoje Há Bola — Football on TV worldwide",
    short_name: "Hoje Há Bola",
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
