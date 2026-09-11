import { getPublicOrigin, metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";

/**
 * RFC 9728 protected-resource metadata.
 * Claude looks this up after OAuth and must see resource = `{origin}/mcp`
 * (the streamable HTTP endpoint), not the bare origin.
 */
export function GET(req: Request): Response {
  const origin = getPublicOrigin(req);
  return protectedResourceHandler({
    authServerUrls: [origin],
    resourceUrl: `${origin}/mcp`,
  })(req);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
