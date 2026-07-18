import type { NextConfig } from "next";

// Static security headers applied to every response. The full Content-Security-Policy
// is set per-request (with a nonce) in middleware.ts; X-Frame-Options still covers
// framing on routes the middleware doesn't match (static assets, /api/auth).
const securityHeaders = [
  // No `preload` by default: self-hosters may deploy on a shared parent domain,
  // and preload-listing forces HTTPS on every sibling subdomain and is hard to
  // undo. Deployers on a dedicated domain can add `; preload` and submit it.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
