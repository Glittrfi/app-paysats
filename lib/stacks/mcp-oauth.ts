/**
 * Shared Claude ↔ Leather OAuth message. The verification page signs this;
 * the MCP server verifies the same string. No Privy.
 */
export function stacksMcpAuthMessage(handle: string): string {
  return [
    "PaySats Stacks MCP",
    "",
    "Authorize this Claude connection to operate your PaySats Stacks agent (DCA, Zest, withdraw).",
    `Handle: ${handle}`,
  ].join("\n");
}

export function stacksUserSubject(address: string): string {
  return `stx:${address.trim()}`;
}
