import {
  BITFLOW_HOSTS,
  BITFLOW_TOKEN_ID_SBTC,
  BITFLOW_TOKEN_ID_USDCX,
  DEFAULT_SLIPPAGE,
} from "@/lib/stacks/config";
import { serializeBigInts } from "@/lib/stacks/json";
import { ServiceError } from "@/services/errors";
import {
  BitflowSDK,
  type QuoteResult,
  type SelectedSwapRoute,
} from "@bitflowlabs/core-sdk";

let _sdk: BitflowSDK | undefined;

/**
 * Server-side Bitflow SDK singleton. The SDK's built-in default API host is
 * retired (404s); BITFLOW_HOSTS carries the working gateway URLs.
 * Note: the Bitflow aggregator routes on Stacks mainnet only.
 */
export function getBitflowSdk(): BitflowSDK {
  if (!_sdk) {
    _sdk = new BitflowSDK({
      ...BITFLOW_HOSTS,
      BITFLOW_API_KEY: process.env.BITFLOW_API_KEY || undefined,
      READONLY_CALL_API_KEY:
        process.env.READONLY_CALL_API_KEY ||
        process.env.HIRO_API_KEY ||
        undefined,
      KEEPER_API_KEY: process.env.KEEPER_API_KEY || undefined,
    });
  }
  return _sdk;
}

export type SwapQuote = {
  tokenXId: string;
  tokenYId: string;
  /** Human-unit USDCx amount in. */
  amountIn: number;
  /** Human-unit sBTC amount out (best route quote). */
  amountOut: number;
  /** sBTC out in sats. */
  amountOutSats: number;
  /** DEX hops the aggregator selected, e.g. ["BITFLOW_STABLE_XY_4", ...]. */
  dexPath: string[];
  /** Token hops, e.g. ["token-USDCx-auto", "token-aeusdc", ...]. */
  tokenPath: string[];
  tokenXDecimals: number;
  tokenYDecimals: number;
  /**
   * The full route object. The client feeds this back into the Bitflow SDK's
   * executeSwap (as SwapExecutionData.route) so the executed swap matches the
   * quoted route exactly.
   */
  route: SelectedSwapRoute;
};

/** Best USDCx -> sBTC route + quote from the Bitflow aggregator. */
export async function getUsdcxToSbtcQuote(amountIn: number): Promise<SwapQuote> {
  if (!Number.isFinite(amountIn) || amountIn <= 0) {
    throw new ServiceError(400, "Amount must be a positive number");
  }

  const sdk = getBitflowSdk();
  let result: QuoteResult;
  try {
    result = await sdk.getQuoteForRoute(
      BITFLOW_TOKEN_ID_USDCX,
      BITFLOW_TOKEN_ID_SBTC,
      amountIn,
    );
  } catch (e) {
    throw new ServiceError(
      502,
      `Bitflow quote failed: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  const best = result.bestRoute;
  if (!best || best.quote == null || best.quote <= 0) {
    const detail = result.allRoutes
      ?.map((r) => ("error" in r && r.error ? String(r.error) : null))
      .filter(Boolean)
      .slice(0, 2)
      .join("; ");
    throw new ServiceError(
      502,
      detail
        ? `Bitflow quote failed (${detail})`
        : "No USDCx -> sBTC route available on Bitflow right now",
    );
  }

  return {
    tokenXId: BITFLOW_TOKEN_ID_USDCX,
    tokenYId: BITFLOW_TOKEN_ID_SBTC,
    amountIn,
    amountOut: best.quote,
    amountOutSats: Math.round(best.quote * 1e8),
    dexPath: best.dexPath,
    tokenPath: best.tokenPath,
    tokenXDecimals: best.tokenXDecimals,
    tokenYDecimals: best.tokenYDecimals,
    // Route embeds Clarity amounts as BigInt — tag them so NextResponse.json
    // can serialize. Client revives via reviveBigInts before executeSwap.
    route: serializeBigInts(best.route),
  };
}

export type AgentSwapToken = "sbtc" | "usdcx";

export type AgentSwapQuote = {
  from: AgentSwapToken;
  to: AgentSwapToken;
  amountIn: number;
  amountInRaw: string;
  amountOut: number;
  amountOutRaw: string;
  minOut: number;
  minOutRaw: string;
  slippage: number;
  dexPath: string[];
  tokenPath: string[];
  tokenXDecimals: number;
  tokenYDecimals: number;
  route: SelectedSwapRoute;
};

const BITFLOW_ID: Record<AgentSwapToken, string> = {
  usdcx: BITFLOW_TOKEN_ID_USDCX,
  sbtc: BITFLOW_TOKEN_ID_SBTC,
};

function tokenDecimals(token: AgentSwapToken): number {
  return token === "sbtc" ? 8 : 6;
}

/** Best Bitflow route for USDCx ↔ sBTC. `amountInHuman` is USDCx or BTC, not sats. */
export async function getAgentSwapQuote(opts: {
  from: AgentSwapToken;
  to: AgentSwapToken;
  amountInHuman: number;
  slippage?: number;
}): Promise<AgentSwapQuote> {
  if (opts.from === opts.to) {
    throw new ServiceError(400, "from and to must be different tokens");
  }
  if (!Number.isFinite(opts.amountInHuman) || opts.amountInHuman <= 0) {
    throw new ServiceError(400, "Amount must be a positive number");
  }

  const slippage = opts.slippage ?? DEFAULT_SLIPPAGE;
  if (slippage < 0.005 || slippage > 0.2) {
    throw new ServiceError(400, "slippage must be between 0.5% and 20%");
  }

  const sdk = getBitflowSdk();
  let result: QuoteResult;
  try {
    result = await sdk.getQuoteForRoute(
      BITFLOW_ID[opts.from],
      BITFLOW_ID[opts.to],
      opts.amountInHuman,
    );
  } catch (e) {
    throw new ServiceError(
      502,
      `Bitflow quote failed: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  const best = result.bestRoute;
  if (!best || best.quote == null || best.quote <= 0) {
    const pair = `${opts.from} -> ${opts.to}`;
    const detail = result.allRoutes
      ?.map((r) => ("error" in r && r.error ? String(r.error) : null))
      .filter(Boolean)
      .slice(0, 2)
      .join("; ");
    throw new ServiceError(
      502,
      detail
        ? `Bitflow quote failed (${detail})`
        : `No ${pair} route available on Bitflow right now`,
    );
  }

  const inDec = tokenDecimals(opts.from);
  const outDec = tokenDecimals(opts.to);
  const minOut = best.quote * (1 - slippage);
  return {
    from: opts.from,
    to: opts.to,
    amountIn: opts.amountInHuman,
    amountInRaw: String(Math.round(opts.amountInHuman * 10 ** inDec)),
    amountOut: best.quote,
    amountOutRaw: String(Math.round(best.quote * 10 ** outDec)),
    minOut,
    minOutRaw: String(Math.round(minOut * 10 ** outDec)),
    slippage,
    dexPath: best.dexPath,
    tokenPath: best.tokenPath,
    tokenXDecimals: best.tokenXDecimals,
    tokenYDecimals: best.tokenYDecimals,
    route: serializeBigInts(best.route),
  };
}

export function publicAgentSwapQuote(q: AgentSwapQuote) {
  const { route: _route, ...rest } = q;
  return rest;
}
