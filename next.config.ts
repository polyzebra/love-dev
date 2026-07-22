import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera=(self): the AWS Face Liveness component (FaceLivenessDetectorCore)
  // runs first-party and needs getUserMedia. `camera=()` is an EMPTY allowlist
  // that denies the camera to EVERY origin including same-origin, which silently
  // prevents the liveness camera from ever opening. Microphone stays denied
  // (liveness is video-only); geolocation stays self.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
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
      // Legal Centre canonical-slug aliases (L2.1). The published pages
      // use descriptive slugs; the L2.1 URL map lists shorter synonyms.
      // Alias the synonyms onto the canonical routes so every documented
      // legal URL resolves without duplicating pages or breaking links.
      { source: "/legal/refunds", destination: "/legal/refund-policy", permanent: true },
      { source: "/legal/subscriptions", destination: "/legal/subscription-terms", permanent: true },
      {
        source: "/legal/biometric-information",
        destination: "/legal/biometric-data",
        permanent: true,
      },
      { source: "/legal/safety-centre", destination: "/safety", permanent: true },
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
