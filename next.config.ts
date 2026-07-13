import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Keep the dev overlay & its 200KB+ chunk out of the bundle entirely
  devIndicators: false,
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // The app nav labels /matches "Likes" and the route allowlist
      // reserves /likes - alias the guessable URL instead of 404ing it.
      { source: "/likes", destination: "/matches", permanent: false },
    ];
  },
  async rewrites() {
    return [
      // /api/v1 is the CANONICAL versioned surface (Phase 0D): a
      // transparent rewrite onto the existing handlers - the transport
      // contract is versioned, the implementation is not duplicated.
      // Bare /api/* remains the legacy alias for the current web client
      // during migration (deprecation rules: docs/API-CONTRACT.md).
      { source: "/api/v1/:path*", destination: "/api/:path*" },
    ];
  },
  poweredByHeader: false,
};

export default nextConfig;
