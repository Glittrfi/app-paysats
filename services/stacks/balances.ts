import {
  assetIdentifier,
  hiroApiBase,
  sbtcToken,
  stacksNetworkId,
  usdcxToken,
  type StacksNetworkId,
  type StacksTokenInfo,
} from "@/lib/stacks/config";
import { ServiceError } from "@/services/errors";

type HiroBalancesResponse = {
  stx?: { balance?: string };
  fungible_tokens?: Record<string, { balance?: string }>;
};

export type StacksBalances = {
  address: string;
  network: StacksNetworkId;
  /** micro-STX (6 decimals), decimal string. */
  stxRaw: string;
  stx: number;
  /** USDCx minor units (6 decimals), decimal string. */
  usdcxRaw: string;
  usdcx: number;
  /** sBTC minor units (8 decimals = sats), decimal string. */
  sbtcRaw: string;
  /** sBTC balance expressed in sats. */
  sbtcSats: number;
};

function toNumber(raw: string, decimals: number): number {
  const n = Number(raw) / 10 ** decimals;
  return Number.isFinite(n) ? n : 0;
}

function findFtBalance(
  ft: Record<string, { balance?: string }>,
  token: StacksTokenInfo,
): string {
  const exact = assetIdentifier(token);
  if (ft[exact]?.balance != null) return ft[exact].balance!;
  const prefix = `${token.contract}::`;
  for (const [key, val] of Object.entries(ft)) {
    if (key.startsWith(prefix) && val.balance != null) return val.balance;
  }
  return "0";
}

/**
 * Reads STX + USDCx + sBTC balances for a Stacks address in one Hiro API
 * call (`/extended/v1/address/{principal}/balances` includes every SIP-010
 * fungible token the address holds).
 */
export async function getStacksBalances(
  address: string,
  network: StacksNetworkId = stacksNetworkId(),
): Promise<StacksBalances> {
  const url = `${hiroApiBase(network)}/extended/v1/address/${encodeURIComponent(
    address,
  )}/balances`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    // Balances change per-block; never serve a stale cached copy.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ServiceError(
      502,
      `Hiro API error (${res.status}) while reading balances`,
    );
  }
  const json = (await res.json()) as HiroBalancesResponse;

  const usdcx = usdcxToken(network);
  const sbtc = sbtcToken(network);
  const ft = json.fungible_tokens ?? {};

  const stxRaw = json.stx?.balance ?? "0";
  // Prefer the exact asset identifier; fall back to any FT under the same
  // contract (Hiro keys are `{contract}::{ft-name}`, and FT names have
  // drifted across deployments — e.g. usdcx vs usdcx-token).
  const usdcxRaw = findFtBalance(ft, usdcx);
  const sbtcRaw = findFtBalance(ft, sbtc);

  return {
    address,
    network,
    stxRaw,
    stx: toNumber(stxRaw, 6),
    usdcxRaw,
    usdcx: toNumber(usdcxRaw, usdcx.decimals),
    sbtcRaw,
    sbtcSats: Number(sbtcRaw) || 0,
  };
}
