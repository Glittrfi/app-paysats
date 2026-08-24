import {
  DEFAULT_SLIPPAGE,
  getStacksKeeperAddress,
  getStacksKeeperPrivateKey,
  sbtcToken,
  usdcxToken,
  type StacksTokenInfo,
} from "@/lib/stacks/config";
import { hiroFetch } from "@/lib/stacks/hiro";
import { reviveBigInts } from "@/lib/stacks/json";
import { ServiceError } from "@/services/errors";
import { getBitflowSdk, getUsdcxToSbtcQuote } from "@/services/stacks/bitflow";
import { fetchHiroTx, sbtcReceivedByAddress } from "@/services/stacks/funding-tx";
import { STACKS_MAINNET } from "@stacks/network";
import { Cl, Pc } from "@/lib/stacks/cl";
import { broadcastTransaction, makeContractCall } from "@stacks/transactions";

export type BroadcastResult = { txId: string };

let broadcastChain: Promise<unknown> = Promise.resolve();

/** Serialize keeper broadcasts so nonces do not collide. */
function withBroadcastLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = broadcastChain.then(fn, fn);
  broadcastChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function nextNonce(address: string): Promise<number> {
  const res = await hiroFetch(
    `/extended/v1/address/${encodeURIComponent(address)}/nonces`,
    { network: "mainnet", cacheTtlMs: 0, retries: 2 },
  );
  if (!res.ok) {
    throw new ServiceError(502, `Hiro nonce error (${res.status})`);
  }
  const json = (await res.json()) as {
    possible_next_nonce?: number;
    last_mempool_tx_nonce?: number | null;
    last_executed_tx_nonce?: number | null;
  };
  if (typeof json.possible_next_nonce === "number") {
    return json.possible_next_nonce;
  }
  const last = json.last_mempool_tx_nonce ?? json.last_executed_tx_nonce ?? -1;
  return last + 1;
}

async function broadcastContractCall(opts: {
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: Parameters<typeof makeContractCall>[0]["functionArgs"];
  postConditions: Parameters<typeof makeContractCall>[0]["postConditions"];
}): Promise<BroadcastResult> {
  return withBroadcastLock(async () => {
    const senderKey = getStacksKeeperPrivateKey();
    const senderAddress = getStacksKeeperAddress();
    const nonce = await nextNonce(senderAddress);
    const tx = await makeContractCall({
      contractAddress: opts.contractAddress,
      contractName: opts.contractName,
      functionName: opts.functionName,
      functionArgs: opts.functionArgs,
      postConditions: opts.postConditions,
      postConditionMode: "deny",
      senderKey,
      nonce,
      network: STACKS_MAINNET,
    });

    const result = await broadcastTransaction({
      transaction: tx,
      network: STACKS_MAINNET,
    });

    if ("error" in result && result.error) {
      throw new ServiceError(
        502,
        `Broadcast failed: ${result.error}${result.reason ? ` (${result.reason})` : ""}`,
      );
    }
    const txId = result.txid;
    if (!txId) {
      throw new ServiceError(502, "Broadcast did not return a transaction id");
    }
    return { txId: txId.startsWith("0x") ? txId : `0x${txId}` };
  });
}

export async function transferSip010(opts: {
  token: StacksTokenInfo;
  amountRaw: bigint;
  recipient: string;
}): Promise<BroadcastResult> {
  const keeperAddress = getStacksKeeperAddress();
  const [contractAddress, contractName] = opts.token.contract.split(".");
  if (!contractAddress || !contractName) {
    throw new ServiceError(500, "Invalid token contract");
  }
  if (opts.amountRaw <= BigInt(0)) {
    throw new ServiceError(400, "Transfer amount must be positive");
  }

  return broadcastContractCall({
    contractAddress,
    contractName,
    functionName: "transfer",
    functionArgs: [
      Cl.uint(opts.amountRaw),
      Cl.principal(keeperAddress),
      Cl.principal(opts.recipient),
      Cl.none(),
    ],
    postConditions: [
      Pc.principal(keeperAddress)
        .willSendEq(opts.amountRaw)
        .ft(opts.token.contract as `${string}.${string}`, opts.token.assetName),
    ],
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

  const { txId } = await broadcastContractCall({
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
