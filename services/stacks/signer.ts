import {
  getStacksKeeperAddress,
  getStacksKeeperPrivateKey,
  type StacksTokenInfo,
} from "@/lib/stacks/config";
import { hiroFetch } from "@/lib/stacks/hiro";
import { Cl, Pc } from "@/lib/stacks/cl";
import { ServiceError } from "@/services/errors";
import { STACKS_MAINNET } from "@stacks/network";
import {
  broadcastTransaction,
  makeContractCall,
  makeSTXTokenTransfer,
} from "@stacks/transactions";

export type StacksSigner = {
  address: string;
  privateKey: string;
};

export type BroadcastResult = { txId: string; nonce: number };

export type ContractCallSpec = {
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: Parameters<typeof makeContractCall>[0]["functionArgs"];
  postConditions: Parameters<typeof makeContractCall>[0]["postConditions"];
};

const locks = new Map<string, Promise<unknown>>();

/** Serialize broadcasts per sender so nonces do not collide. */
function withAddressLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(address) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    address,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export function keeperSigner(): StacksSigner {
  return {
    address: getStacksKeeperAddress(),
    privateKey: getStacksKeeperPrivateKey(),
  };
}

export async function nextNonce(address: string): Promise<number> {
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

function normalizeTxId(txId: string): string {
  return txId.startsWith("0x") ? txId : `0x${txId}`;
}

async function sendSignedTx(
  tx: Parameters<typeof broadcastTransaction>[0]["transaction"],
): Promise<string> {
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
  return normalizeTxId(txId);
}

export async function broadcastContractCall(
  signer: StacksSigner,
  spec: ContractCallSpec,
): Promise<BroadcastResult> {
  const [row] = await broadcastContractCalls(signer, [spec]);
  return row;
}

/** Broadcast several contract calls from one sender, incrementing nonce locally. */
export async function broadcastContractCalls(
  signer: StacksSigner,
  specs: ContractCallSpec[],
): Promise<BroadcastResult[]> {
  if (specs.length === 0) return [];
  return withAddressLock(signer.address, async () => {
    let nonce = await nextNonce(signer.address);
    const out: BroadcastResult[] = [];
    for (const spec of specs) {
      const tx = await makeContractCall({
        contractAddress: spec.contractAddress,
        contractName: spec.contractName,
        functionName: spec.functionName,
        functionArgs: spec.functionArgs,
        postConditions: spec.postConditions,
        postConditionMode: "deny",
        senderKey: signer.privateKey,
        nonce,
        network: STACKS_MAINNET,
      });
      const txId = await sendSignedTx(tx);
      out.push({ txId, nonce });
      nonce += 1;
    }
    return out;
  });
}

export async function transferSip010(opts: {
  signer: StacksSigner;
  token: StacksTokenInfo;
  amountRaw: bigint;
  recipient: string;
}): Promise<BroadcastResult> {
  const [contractAddress, contractName] = opts.token.contract.split(".");
  if (!contractAddress || !contractName) {
    throw new ServiceError(500, "Invalid token contract");
  }
  if (opts.amountRaw <= BigInt(0)) {
    throw new ServiceError(400, "Transfer amount must be positive");
  }

  return broadcastContractCall(opts.signer, {
    contractAddress,
    contractName,
    functionName: "transfer",
    functionArgs: [
      Cl.uint(opts.amountRaw),
      Cl.principal(opts.signer.address),
      Cl.principal(opts.recipient),
      Cl.none(),
    ],
    postConditions: [
      Pc.principal(opts.signer.address)
        .willSendEq(opts.amountRaw)
        .ft(opts.token.contract as `${string}.${string}`, opts.token.assetName),
    ],
  });
}

export async function transferStx(opts: {
  signer: StacksSigner;
  amountUstx: bigint;
  recipient: string;
}): Promise<BroadcastResult> {
  if (opts.amountUstx <= BigInt(0)) {
    throw new ServiceError(400, "STX amount must be positive");
  }
  return withAddressLock(opts.signer.address, async () => {
    const nonce = await nextNonce(opts.signer.address);
    const tx = await makeSTXTokenTransfer({
      recipient: opts.recipient,
      amount: opts.amountUstx,
      senderKey: opts.signer.privateKey,
      nonce,
      network: STACKS_MAINNET,
    });
    const txId = await sendSignedTx(tx);
    return { txId, nonce };
  });
}
