import { hiroApiBase, type StacksNetworkId } from "./config";

export type StacksTxStatus = "pending" | "success" | "failed";

/**
 * One-shot Stacks tx status read from the Hiro API (browser-safe; Hiro
 * allows CORS). Mempool/unanchored txs report "pending".
 */
export async function fetchStacksTxStatus(
  txId: string,
  network: StacksNetworkId,
): Promise<StacksTxStatus> {
  const id = txId.startsWith("0x") ? txId : `0x${txId}`;
  const res = await fetch(`${hiroApiBase(network)}/extended/v1/tx/${id}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return "pending"; // not yet indexed
  if (!res.ok) throw new Error(`Hiro API error (${res.status})`);
  const json = (await res.json()) as { tx_status?: string };
  if (json.tx_status === "success") return "success";
  if (json.tx_status === "pending" || json.tx_status == null) return "pending";
  return "failed"; // abort_by_response, abort_by_post_condition, dropped_*
}
