import {
  DEFAULT_SLIPPAGE,
  getStacksKeeperAddress,
  sbtcToken,
  usdcxToken,
  type StacksTokenInfo,
} from "@/lib/stacks/config";
import { reviveBigInts } from "@/lib/stacks/json";
import { ServiceError } from "@/services/errors";
import { getBitflowSdk, getUsdcxToSbtcQuote } from "@/services/stacks/bitflow";
import { fetchHiroTx, sbtcReceivedByAddress } from "@/services/stacks/funding-tx";
import {
  broadcastContractCall,
  keeperSigner,
  transferSip010 as transferSip010From,
  type BroadcastResult,
} from "@/services/stacks/signer";

export type { BroadcastResult };

export async function transferSip010(opts: {
  token: StacksTokenInfo;
  amountRaw: bigint;
  recipient: string;
}): Promise<BroadcastResult> {
  return transferSip010From({
    signer: keeperSigner(),
    token: opts.token,
    amountRaw: opts.amountRaw,
    recipient: opts.recipient,
  });
}

/** Broadcast USDCx → sBTC via the same Bitflow route as the in-app swap. Does not wait for confirm. */
export async function broadcastUsdcxToSbtcSwap(amountHuman: number): Promise<{
  txId: string;
  quotedOutSats: number;
}> {
  const quote = await getUsdcxToSbtcQuote(amountHuman);
  const keeperAddress = getStacksKeeperAddress();
  const sdk = getBitflowSdk();
  const swapParams = await sdk.getSwapParams(
    {
      route: reviveBigInts(quote.route),
      amount: quote.amountIn,
      tokenXDecimals: quote.tokenXDecimals,
      tokenYDecimals: quote.tokenYDecimals,
    },
    keeperAddress,
    DEFAULT_SLIPPAGE,
  );

  const { txId } = await broadcastContractCall(keeperSigner(), {
    contractAddress: swapParams.contractAddress,
    contractName: swapParams.contractName,
    functionName: swapParams.functionName,
    functionArgs: swapParams.functionArgs,
    postConditions: swapParams.postConditions,
  });

  return { txId, quotedOutSats: quote.amountOutSats };
}

export async function refundUsdcx(opts: {
  amountRaw: bigint;
  recipient: string;
}): Promise<BroadcastResult> {
  return transferSip010({
    token: usdcxToken("mainnet"),
    amountRaw: opts.amountRaw,
    recipient: opts.recipient,
  });
}

export async function payoutSbtc(opts: {
  amountSats: bigint;
  recipient: string;
}): Promise<BroadcastResult> {
  return transferSip010({
    token: sbtcToken("mainnet"),
    amountRaw: opts.amountSats,
    recipient: opts.recipient,
  });
}

/** Actual sBTC the keeper received on a confirmed swap tx. */
export async function sbtcInflowFromSwapTx(txId: string): Promise<bigint> {
  const keeper = getStacksKeeperAddress();
  const tx = await fetchHiroTx(txId);
  if (tx.tx_status !== "success") {
    throw new ServiceError(409, `Swap tx is ${tx.tx_status ?? "unknown"}`);
  }
  const got = sbtcReceivedByAddress(tx.events, keeper);
  if (got > BigInt(0)) return got;

  const fromResult = tx.tx_result?.repr?.match(/\(ok u(\d+)\)/);
  if (fromResult) {
    const n = BigInt(fromResult[1]);
    if (n > BigInt(0)) return n;
  }

  throw new ServiceError(502, "Swap confirmed but no sBTC inflow to keeper");
}
