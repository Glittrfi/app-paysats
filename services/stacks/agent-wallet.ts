import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import {
  STACKS_DCA_INTERVALS,
  getStacksKeeperAddress,
  stacksNetworkId,
  usdcxToken,
} from "@/lib/stacks/config";
import { hiroFetch } from "@/lib/stacks/hiro";
import { ServiceError } from "@/services/errors";
import { getStacksBalances } from "@/services/stacks/balances";
import { getZestPosition } from "@/services/stacks/zest";
import {
  keeperSigner,
  transferStx,
  type StacksSigner,
} from "@/services/stacks/signer";
import type {
  AgentKeySource,
  AgentWalletView,
} from "@/lib/stacks/agent-types";
import type { User as DbUser } from "@prisma/client";
import { privateKeyToAddress, randomPrivateKey } from "@stacks/transactions";

export type { AgentKeySource, AgentWalletView };

/** Dust STX so a new generated wallet can pay its first fee. 0.1 STX. */
const AGENT_STX_TOPUP_USTX = BigInt(100_000);

const HEX_KEY = /^(0x)?[0-9a-fA-F]{64}(01)?$/;

export function mcpPublicUrl(): string {
  return (
    process.env.STACKS_MCP_PUBLIC_URL ??
    "https://stxmcp.paysats.exchange"
  ).replace(/\/+$/, "");
}

export function appPublicUrl(): string {
  return (
    process.env.VERIFICATION_BASE_URL ?? "https://app.paysats.exchange"
  ).replace(/\/+$/, "");
}

export function isStacksAddress(v: unknown): v is string {
  return typeof v === "string" && /^S[PMTN][0-9A-Z]{28,41}$/.test(v.trim());
}

function normalizePrivateKey(raw: string): string {
  const key = raw.trim().replace(/^0x/i, "");
  if (!HEX_KEY.test(key) && !HEX_KEY.test(`0x${key}`)) {
    throw new ServiceError(
      400,
      "Paste a hex Stacks private key (64 hex chars, optional 01 compressed suffix). Do not paste a 24-word phrase.",
    );
  }
  return key;
}

export async function requireDbUser(privyUserId: string): Promise<DbUser> {
  const row = await prisma.user.findUnique({ where: { privyUserId } });
  if (!row) {
    throw new ServiceError(404, "User not found. Sign in to PaySats first.");
  }
  return row;
}

export async function upsertDbUser(privyUserId: string): Promise<DbUser> {
  return prisma.user.upsert({
    where: { privyUserId },
    create: { privyUserId },
    update: {},
  });
}

export function agentSignerFromUser(user: DbUser): StacksSigner {
  if (!user.stacksAgentAddress || !user.stacksAgentKeyEnc) {
    throw new ServiceError(
      400,
      "No Stacks agent account yet. Create one at /stacks or call setup_sbtc_dca to generate it.",
    );
  }
  return {
    address: user.stacksAgentAddress,
    privateKey: decryptSecret(user.stacksAgentKeyEnc),
  };
}

export async function lookupBnsName(address: string): Promise<string | null> {
  try {
    const res = await hiroFetch(
      `/v1/addresses/stacks/${encodeURIComponent(address)}`,
      { network: "mainnet", cacheTtlMs: 60_000, retries: 1 },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { names?: string[] };
    const names = json.names ?? [];
    const btc = names.find((n) => n.endsWith(".btc"));
    return btc ?? names[0] ?? null;
  } catch {
    return null;
  }
}

async function topUpGeneratedWallet(address: string): Promise<string | null> {
  try {
    const keeperBal = await getStacksBalances(
      getStacksKeeperAddress(),
      "mainnet",
    );
    if (BigInt(keeperBal.stxRaw) < AGENT_STX_TOPUP_USTX + BigInt(50_000)) {
      return null;
    }
    const { txId } = await transferStx({
      signer: keeperSigner(),
      amountUstx: AGENT_STX_TOPUP_USTX,
      recipient: address,
    });
    return txId;
  } catch (e) {
    console.warn("Agent STX top-up skipped:", e);
    return null;
  }
}

export async function generateAgentWallet(privyUserId: string): Promise<{
  user: DbUser;
  gasTxId: string | null;
}> {
  const user = await upsertDbUser(privyUserId);
  if (user.stacksAgentAddress && user.stacksAgentKeyEnc) {
    return { user, gasTxId: null };
  }

  const privateKey = randomPrivateKey();
  const address = privateKeyToAddress(privateKey, "mainnet");
  const enc = encryptSecret(privateKey);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      stacksAgentAddress: address,
      stacksAgentKeyEnc: enc,
      stacksAgentKeySource: "generated",
      stacksAgentCreatedAt: new Date(),
    },
  });

  const gasTxId = await topUpGeneratedWallet(address);
  return { user: updated, gasTxId };
}

export async function importAgentWallet(
  privyUserId: string,
  privateKeyRaw: string,
): Promise<DbUser> {
  const user = await upsertDbUser(privyUserId);
  const privateKey = normalizePrivateKey(privateKeyRaw);
  const address = privateKeyToAddress(privateKey, "mainnet");

  const taken = await prisma.user.findFirst({
    where: { stacksAgentAddress: address, id: { not: user.id } },
  });
  if (taken) {
    throw new ServiceError(409, "That Stacks key is already linked to another account");
  }

  return prisma.user.update({
    where: { id: user.id },
    data: {
      stacksAgentAddress: address,
      stacksAgentKeyEnc: encryptSecret(privateKey),
      stacksAgentKeySource: "imported",
      stacksAgentCreatedAt: new Date(),
    },
  });
}

export async function forgetAgentWallet(privyUserId: string): Promise<void> {
  const user = await requireDbUser(privyUserId);
  if (!user.stacksAgentAddress) return;

  const [dca, zest] = await Promise.all([
    prisma.stacksDcaOrder.findFirst({
      where: {
        userId: user.id,
        status: { in: ["active", "executing", "cancelling", "pending_funding"] },
      },
    }),
    user.stacksAgentAddress
      ? getZestPosition(user.stacksAgentAddress).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (dca) {
    throw new ServiceError(
      409,
      "Cancel the active sBTC DCA on the agent account before removing the key",
    );
  }
  if (zest?.hasPosition) {
    throw new ServiceError(
      409,
      "Close the Zest position (repay and withdraw collateral) before removing the key",
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stacksAgentAddress: null,
      stacksAgentKeyEnc: null,
      stacksAgentKeySource: null,
      stacksAgentCreatedAt: null,
    },
  });
}

export async function getAgentWalletView(
  user: DbUser,
): Promise<AgentWalletView | { agentReady: false; connectUrl: string }> {
  if (!user.stacksAgentAddress) {
    return {
      agentReady: false,
      connectUrl: `${appPublicUrl()}/stacks`,
    };
  }
  const [balances, bnsName] = await Promise.all([
    getStacksBalances(user.stacksAgentAddress, stacksNetworkId()),
    lookupBnsName(user.stacksAgentAddress),
  ]);
  const mcpUrl = `${mcpPublicUrl()}/mcp`;
  return {
    agentReady: true,
    agentAddress: user.stacksAgentAddress,
    keySource: (user.stacksAgentKeySource as AgentKeySource) ?? "generated",
    createdAt: user.stacksAgentCreatedAt?.toISOString() ?? new Date().toISOString(),
    linkedAddress: user.stacksAddress,
    bnsName,
    balances,
    mcp: {
      url: mcpUrl,
      instructions:
        "Add this URL as a remote MCP server in Claude (or another MCP client). Sign in with the same PaySats Google account. The agent signs from this Stacks address — fund it with USDCx, sBTC, and a little STX.",
    },
  };
}

export function frequencySeconds(
  frequency: (typeof STACKS_DCA_INTERVALS)[number]["id"],
): number {
  return (
    STACKS_DCA_INTERVALS.find((i) => i.id === frequency)?.seconds ?? 86_400
  );
}

export function usdcxRawFromHuman(amount: number): bigint {
  const usdcx = usdcxToken("mainnet");
  return BigInt(Math.round(amount * 10 ** usdcx.decimals));
}
