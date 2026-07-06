import type { NextConfig } from "next";

// App-wide security headers (DEBT-025). The CSP is intentionally permissive on
// img/connect (map tiles + Vercel Blob are served over https from several hosts)
// and allows inline styles/scripts, which the map libraries and Next's runtime
// still require without a nonce pipeline. Tighten script-src/style-src to nonces
// once a nonce/middleware strategy is in place.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
  },
];

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      // Vercel Blob — listing photos. Wildcard subdomain so it keeps working
      // across stores (the subdomain encodes the store id).
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
