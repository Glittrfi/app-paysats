import { hiroApiBase, type StacksNetworkId } from "@/lib/stacks/config";
import { ServiceError } from "@/services/errors";
import {
  type ClarityValue,
  cvToHex,
  hexToCV,
} from "@stacks/transactions";

function hiroHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const key = process.env.HIRO_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;
  return headers;
}

/**
 * Call a Clarity read-only function via Hiro's `/v2/contracts/call-read` RPC.
 */
export async function callReadOnlyFunction(opts: {
  contract: string;
  functionName: string;
  functionArgs: ClarityValue[];
  sender: string;
  network?: StacksNetworkId;
}): Promise<ClarityValue> {
  const network = opts.network ?? "mainnet";
  const [contractAddress, contractName] = opts.contract.split(".");
  if (!contractAddress || !contractName) {
    throw new ServiceError(500, `Invalid contract id: ${opts.contract}`);
  }

  const base = hiroApiBase(network).replace(/\/$/, "");
  const url = `${base}/v2/contracts/call-read/${contractAddress}/${contractName}/${opts.functionName}`;

  const res = await fetch(url, {
    method: "POST",
    headers: hiroHeaders(),
    body: JSON.stringify({
      sender: opts.sender,
      arguments: opts.functionArgs.map((a) => cvToHex(a)),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text();
  let json: { okay?: boolean; result?: string; cause?: string };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new ServiceError(
      502,
      `Hiro read-only call failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  if (!res.ok || !json.okay || !json.result) {
    throw new ServiceError(
      502,
      json.cause ?? `Read-only call failed for ${opts.functionName}`,
    );
  }

  return hexToCV(json.result);
}
