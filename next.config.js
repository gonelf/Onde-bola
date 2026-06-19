/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,

  // Serve the admin console at the clean /admin path (the page itself lives in
  // public/admin.html). Old /admin.html links 308 to /admin so there's a single
  // canonical endpoint.
  async rewrites() {
    return [{ source: "/admin", destination: "/admin.html" }];
  },
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
        source: "/admin",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
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
