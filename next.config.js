/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,

  // The admin console is now React routes under app/(admin)/admin/*. Static
  // assets it imports (admin.css, replay-sim.js) still live under public/admin/
  // and are served straight from the filesystem. Old /admin.html 308s to /admin.
  async redirects() {
    return [{ source: "/admin.html", destination: "/admin", permanent: true }];
  },

  async headers() {
    return [
      {
        // Baseline security + correct referrer behaviour site-wide.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
      {
        // Keep non-content endpoints out of search indexes belt-and-braces
        // (robots.txt already disallows them).
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // Admin console: never index, and never cache (so updates to the static
        // pages/assets take effect immediately instead of serving stale copies).
        source: "/admin/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
      {
        source: "/admin",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
      {
        // Immutable, fingerprint-free static assets — cache hard.
        source: "/assets/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/icon.svg",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800, immutable" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
