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
  KEEPER_API_HOST:
    process.env.NEXT_PUBLIC_KEEPER_API_HOST ??
    "https://bitflow-keeper-7owjsmt8.uc.gateway.dev",
  READONLY_CALL_API_HOST:
    process.env.NEXT_PUBLIC_READONLY_CALL_API_HOST ??
    "https://node.bitflowapis.finance",
} as const;

/** Bitflow routing/execution only exists on mainnet. */
export function swapEnabled(
  network: StacksNetworkId = stacksNetworkId(),
): boolean {
  return network === "mainnet";
}

/** Hiro testnet STX faucet (users need STX for gas). */
export const STACKS_TESTNET_FAUCET_URL = "https://platform.hiro.so/faucet";

export const DEFAULT_SLIPPAGE = 0.01; // 1%
