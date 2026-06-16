import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow local images from public/
    unoptimized: false,
  },
  // Ensure Prisma client is bundled correctly for serverless
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
