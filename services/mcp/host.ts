/** Host header for the public MCP vhost (nginx sets Host / X-Forwarded-Host). */
export function mcpRequestHost(req: Request): string {
  const raw =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return raw.split(",")[0].trim().toLowerCase();
}

export function isStacksMcpHost(host: string): boolean {
  return host.startsWith("stxmcp.") || host.includes(".stxmcp.");
}

export function isBaseMcpHost(host: string): boolean {
  return host.startsWith("privymcp.") || host.includes(".privymcp.");
}

/** Stacks product app (Vercel), distinct from stxmcp (MCP) and app.paysats.exchange (Base). */
export function isStacksAppHost(host: string): boolean {
  const h = host.split(":")[0].toLowerCase();
  return h === "stx.paysats.exchange" || h.startsWith("stx.");
}

export function stacksAppPublicUrl(): string {
  return (
    process.env.STACKS_APP_PUBLIC_URL ?? "https://stx.paysats.exchange"
  ).replace(/\/+$/, "");
}

export function baseAppPublicUrl(): string {
  return (
    process.env.VERIFICATION_BASE_URL ?? "https://app.paysats.exchange"
  ).replace(/\/+$/, "");
}

/**
 * Dedicated process pin. Set MCP_PRODUCT=stacks on the stxmcp Next server
 * so OAuth always goes to stx.paysats.exchange even if Host is missing.
 * privymcp (paysats_v2 on :3400) stays Base/Privy and does not set this.
 */
export function mcpProduct(): "stacks" | "base" | null {
  const v = (process.env.MCP_PRODUCT ?? "").trim().toLowerCase();
  if (v === "stacks" || v === "base") return v;
  return null;
}

/** True when this OAuth/MCP request is the Stacks agent server. */
export function isStacksMcpRequest(req: Request): boolean {
  const product = mcpProduct();
  if (product === "stacks") return true;
  if (product === "base") return false;
  return isStacksMcpHost(mcpRequestHost(req));
}

export function isStacksVerification(
  flavor: string | null,
  complete: string | null,
  host?: string | null,
): boolean {
  if (flavor === "stacks") return true;
  if (flavor === "base") return false;
  if (mcpProduct() === "stacks") return true;
  if (mcpProduct() === "base") return false;
  if (host && (isStacksAppHost(host) || isStacksMcpHost(host))) return true;
  if (!complete) return false;
  try {
    return isStacksMcpHost(new URL(complete).hostname);
  } catch {
    return false;
  }
}
