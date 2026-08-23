/**
 * Stacks pilot configuration (Milestone 1 — Stacks Endowment grant).
 *
 * Network selection is driven by NEXT_PUBLIC_STACKS_NETWORK ("mainnet" |
 * "testnet"). Wallet connect and balance reads work on both networks; the
 * Bitflow swap aggregator only routes on mainnet (its SDK is hardwired to
 * STACKS_MAINNET), so the swap flow is gated to mainnet.
 */

export type StacksNetworkId = "mainnet" | "testnet";

export function stacksNetworkId(): StacksNetworkId {
  return process.env.NEXT_PUBLIC_STACKS_NETWORK === "testnet"
    ? "testnet"
    : "mainnet";
}

export const HIRO_API_BASE: Record<StacksNetworkId, string> = {
  mainnet: "https://api.hiro.so",
  testnet: "https://api.testnet.hiro.so",
};

export function hiroApiBase(network: StacksNetworkId = stacksNetworkId()) {
  return HIRO_API_BASE[network];
}

export function stacksExplorerTxUrl(
  txId: string,
  network: StacksNetworkId = stacksNetworkId(),
) {
  const suffix = network === "testnet" ? "?chain=testnet" : "?chain=mainnet";
  const id = txId.startsWith("0x") ? txId : `0x${txId}`;
  return `https://explorer.hiro.so/txid/${id}${suffix}`;
}

export function stacksExplorerAddressUrl(
  address: string,
  network: StacksNetworkId = stacksNetworkId(),
) {
  const suffix = network === "testnet" ? "?chain=testnet" : "?chain=mainnet";
  return `https://explorer.hiro.so/address/${address}${suffix}`;
}

// ---------------------------------------------------------------------------
// Token contracts (SIP-010)
// ---------------------------------------------------------------------------

export type StacksTokenInfo = {
  symbol: string;
  /** `{contractAddress}.{contractName}` */
  contract: string;
  /** Fungible token asset name inside the contract (for asset identifiers). */
  assetName: string;
  decimals: number;
};

/** Circle USDCx (via xReserve). Clarity FT name is `usdcx-token`. */
export const USDCX: Record<StacksNetworkId, StacksTokenInfo> = {
  mainnet: {
    symbol: "USDCx",
    contract: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx",
    assetName: "usdcx-token",
    decimals: 6,
  },
  testnet: {
    symbol: "USDCx",
    contract: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx",
    assetName: "usdcx-token",
    decimals: 6,
  },
};

/** sBTC (Bitcoin-settled, 1:1 backed). */
export const SBTC: Record<StacksNetworkId, StacksTokenInfo> = {
  mainnet: {
    symbol: "sBTC",
    contract: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    assetName: "sbtc-token",
    decimals: 8,
  },
  testnet: {
    // Hiro faucet deployment (used by the Hiro Platform testnet faucet).
    symbol: "sBTC",
    contract: "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT.sbtc-token",
    assetName: "sbtc-token",
    decimals: 8,
  },
};

export function usdcxToken(network: StacksNetworkId = stacksNetworkId()) {
  return USDCX[network];
}

export function sbtcToken(network: StacksNetworkId = stacksNetworkId()) {
  return SBTC[network];
}

/** Hiro fungible-token asset identifier: `{contract}::{assetName}`. */
export function assetIdentifier(token: StacksTokenInfo): string {
  return `${token.contract}::${token.assetName}`;
}

// ---------------------------------------------------------------------------
// Bitflow (mainnet-only aggregator)
// ---------------------------------------------------------------------------

/** Bitflow SDK token ids for the pilot pair (from getAvailableTokens). */
export const BITFLOW_TOKEN_ID_USDCX = "token-USDCx-auto";
export const BITFLOW_TOKEN_ID_SBTC = "token-sbtc";

/**
 * Working Bitflow API hosts. The SDK's built-in defaults point at a retired
 * gateway that 404s on getAllTokensAndPools; these are the hosts referenced
 * in Bitflow's rate-limit docs and verified working.
 */
export const BITFLOW_HOSTS = {
  BITFLOW_API_HOST:
    process.env.NEXT_PUBLIC_BITFLOW_API_HOST ??
    "https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev",
  /** Live Keeper API (SDK default gateway is retired / 404s). */
  KEEPER_API_HOST:
    process.env.NEXT_PUBLIC_KEEPER_API_HOST ??
    "https://keeper.bitflowapis.finance",
  /** Bitflow's `node.bitflowapis.finance` no longer resolves; Hiro is the same Stacks /v2 RPC. */
  READONLY_CALL_API_HOST:
    process.env.NEXT_PUBLIC_READONLY_CALL_API_HOST ??
    "https://api.hiro.so",
} as const;

/**
 * Bitflow fee recipient used by live Keeper orders. Override via
 * NEXT_PUBLIC_BITFLOW_PROVIDER_ADDRESS / BITFLOW_PROVIDER_ADDRESS.
 */
export const BITFLOW_FEE_RECIPIENT =
  process.env.NEXT_PUBLIC_BITFLOW_PROVIDER_ADDRESS ??
  process.env.BITFLOW_PROVIDER_ADDRESS ??
  "SP3MCM8K9KEJMFM6MN191JVN5CA51MDS7AM3SGYQ6";

/** DCA interval presets (seconds) for Bitflow createGroupOrder. */
export const STACKS_DCA_INTERVALS = [
  /** Testing-only short interval — remove/hide before production pilot. */
  { id: "1min", label: "1 min", seconds: 60 },
  { id: "daily", label: "Daily", seconds: 86_400 },
  { id: "weekly", label: "Weekly", seconds: 604_800 },
  { id: "monthly", label: "Monthly", seconds: 2_592_000 },
] as const;

export type StacksDcaIntervalId = (typeof STACKS_DCA_INTERVALS)[number]["id"];

/** Bitflow routing/execution only exists on mainnet. */
export function swapEnabled(
  network: StacksNetworkId = stacksNetworkId(),
): boolean {
  return network === "mainnet";
}

/**
 * PaySats-owned Stacks address that holds prepaid USDCx and broadcasts
 * Bitflow swaps. Safe to expose (NEXT_PUBLIC_) — users transfer to it.
 */
export function publicStacksKeeperAddress(): string | null {
  const a = (
    process.env.NEXT_PUBLIC_STACKS_KEEPER_ADDRESS ??
    process.env.STACKS_KEEPER_ADDRESS ??
    ""
  ).trim();
  return /^S[PMTN][0-9A-Z]{28,41}$/.test(a) ? a : null;
}

export function getStacksKeeperAddress(): string {
  const a = publicStacksKeeperAddress();
  if (!a) {
    throw new Error(
      "Set NEXT_PUBLIC_STACKS_KEEPER_ADDRESS (or STACKS_KEEPER_ADDRESS)",
    );
  }
  return a;
}

/** Hex private key for the keeper (server-only). May include 01 compressed suffix. */
export function getStacksKeeperPrivateKey(): string {
  const key = (process.env.STACKS_KEEPER_PRIVATE_KEY ?? "").trim();
  if (!/^(0x)?[0-9a-fA-F]{64}(01)?$/.test(key)) {
    throw new Error("Set STACKS_KEEPER_PRIVATE_KEY to a hex Stacks private key");
  }
  return key.startsWith("0x") ? key.slice(2) : key;
}

export function stacksDcaCronSecret(): string | null {
  const s = (process.env.STACKS_DCA_CRON_SECRET ?? "").trim();
  return s.length >= 16 ? s : null;
}

/** Hiro testnet STX faucet (users need STX for gas). */
export const STACKS_TESTNET_FAUCET_URL = "https://platform.hiro.so/faucet";

/** Multi-hop USDCx → sBTC matches Bitflow app’s typical 4% tolerance. */
export const DEFAULT_SLIPPAGE = 0.04;
