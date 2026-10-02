import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mirror/core", "@mirror/db"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.discordapp.com" },
      { protocol: "https", hostname: "cdn.discordapp.com", pathname: "/**" },
      { protocol: "https", hostname: "media.discordapp.net" },
    ],
  },
};

export default nextConfig;
