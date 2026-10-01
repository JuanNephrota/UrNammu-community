import type { NextConfig } from "next";

// Defence-in-depth headers for every response. A full script-src CSP needs
// per-request nonces for Next's inline bootstrap scripts, so this sets the
// directives that do not: clickjacking, base-tag and form hijacking, plugins.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  images: {
    // Allow local images from public/
    unoptimized: false,
  },
  // Ensure Prisma client is bundled correctly for serverless
  serverExternalPackages: ["@prisma/client"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
