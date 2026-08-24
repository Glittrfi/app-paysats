import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  async redirects() {
    return [
      { source: "/dca", destination: "/save", permanent: false },
      { source: "/dca/:path*", destination: "/save/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
