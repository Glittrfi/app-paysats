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
  async rewrites() {
    return [
      {
        source: "/mcp",
        has: [{ type: "host", value: "stxmcp.paysats.exchange" }],
        destination: "/api/stxmcp/mcp",
      },
      {
        source: "/mcp",
        has: [{ type: "host", value: "privymcp.paysats.exchange" }],
        destination: "/api/mcp/mcp",
      },
    ];
  },
};

export default nextConfig;
