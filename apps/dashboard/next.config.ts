import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A production build can be checked next to a running dev server: NEXT_DIST_DIR=.next-check pnpm build
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // ESLint is its own step (pnpm lint, CI); a style remark must not block a deploy.
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ["@mirror/core", "@mirror/db"],
  // Read by Node as they are: the .xlsx reader drags in packages a bundler cannot follow.
  serverExternalPackages: ["exceljs"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.discordapp.com" },
      { protocol: "https", hostname: "cdn.discordapp.com", pathname: "/**" },
      { protocol: "https", hostname: "media.discordapp.net" },
    ],
  },
};

export default nextConfig;
