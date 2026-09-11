import { upsertDbUser } from "@/services/stacks/agent-wallet";
import { verifyAccessToken } from "@/services/oauth/store";
import { getPrivyUserById } from "@/services/privy/server";
import type { User } from "@privy-io/server-auth";
import type { User as DbUser } from "@prisma/client";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { withMcpAuth } from "mcp-handler";

export function mcpText(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function userIdFrom(authInfo: AuthInfo | undefined): string | null {
  const extra = authInfo?.extra;
  const id = extra?.userId ?? extra?.privyUserId;
  return typeof id === "string" ? id : null;
}

export async function resolveMcpUser(
  authInfo: AuthInfo | undefined,
): Promise<User> {
  const privyUserId = userIdFrom(authInfo);
  if (!privyUserId) throw new Error("Tidak terautentikasi");
  const user = await getPrivyUserById(privyUserId);
  if (!user) throw new Error("User tidak ditemukan");
  return user;
}

/** Stacks MCP identity is the PaySats DB row (Leather-linked). No Privy. */
export async function resolveMcpPaysatsUser(
  authInfo: AuthInfo | undefined,
): Promise<{ userId: string; row: DbUser }> {
  const userId = userIdFrom(authInfo);
  if (!userId) throw new Error("Tidak terautentikasi");
  const row = await upsertDbUser(userId);
  return { userId, row };
}

export function withPaysatsMcpAuth(
  handler: Parameters<typeof withMcpAuth>[0],
) {
  return withMcpAuth(
    handler,
    async (_req, bearerToken) => {
      if (!bearerToken) return undefined;
      const row = await verifyAccessToken(bearerToken);
      if (!row) return undefined;
      const info: AuthInfo = {
        token: bearerToken,
        clientId: row.clientId,
        scopes: row.scope ? row.scope.split(" ") : [],
        expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
        extra: { userId: row.privyUserId, privyUserId: row.privyUserId },
      };
      return info;
    },
    { required: true },
  );
}
