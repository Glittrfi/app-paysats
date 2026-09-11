import { baseMcpRootHandler } from "@/services/mcp/base-handler";
import { isBaseMcpHost, mcpRequestHost } from "@/services/mcp/host";
import { stacksMcpRootHandler } from "@/services/mcp/stacks-handler";
import { metadataCorsOptionsRequestHandler } from "mcp-handler";

export const dynamic = "force-dynamic";

/**
 * Public MCP URL is https://{privymcp|stxmcp}.paysats.exchange/mcp
 * mcp-handler matches pathname === `${basePath}/mcp`, so these handlers
 * use basePath "" (not the /api/... routes).
 */
function dispatch(req: Request) {
  if (isBaseMcpHost(mcpRequestHost(req))) {
    return baseMcpRootHandler(req);
  }
  return stacksMcpRootHandler(req);
}

export const GET = dispatch;
export const POST = dispatch;
export const DELETE = dispatch;
export const OPTIONS = metadataCorsOptionsRequestHandler();
