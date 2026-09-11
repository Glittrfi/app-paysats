import { assetIdentifier, getStacksKeeperAddress, usdcxToken } from "@/lib/stacks/config";
import { hiroFetch } from "@/lib/stacks/hiro";
import { ServiceError } from "@/services/errors";

type HiroFtEvent = {
  event_type?: string;
  asset?: {
    asset_event_type?: string;
    sender?: string;
    recipient?: string;
    amount?: string;
    asset_id?: string;
  };
};

type HiroTx = {
  tx_status?: string;
  sender_address?: string;
  events?: HiroFtEvent[];
  event_count?: number;
  tx_result?: { hex?: string; repr?: string };
};

function normalizeTxId(txId: string): string {
  const t = txId.trim().toLowerCase();
  return t.startsWith("0x") ? t : `0x${t}`;
}

/** Confirm a user → PaySats-keeper USDCx transfer on Hiro. */
export async function verifyUsdcxFundingTx(opts: {
  txId: string;
  from: string;
  minAmountRaw: string;
}): Promise<{ amountRaw: string }> {
  const keeper = getStacksKeeperAddress();
  const tx = await fetchHiroTx(opts.txId);
  if (tx.tx_status === "not_found" || tx.tx_status == null) {
    throw new ServiceError(
      409,
      "Funding transaction is not on chain yet. Wait for it to confirm, then try again.",
    );
  }
  if (tx.tx_status === "pending") {
    throw new ServiceError(
      409,
      "Funding transaction is still pending. Wait for confirmation, then try again.",
    );
  }
  if (tx.tx_status !== "success") {
    throw new ServiceError(400, `Funding transaction failed (${tx.tx_status})`);
  }

  const usdcx = usdcxToken("mainnet");
  const wantAsset = assetIdentifier(usdcx).toLowerCase();
  const from = opts.from.trim();
  const min = BigInt(opts.minAmountRaw);
  let credited = BigInt(0);

  for (const ev of tx.events ?? []) {
    const eventType = ev.event_type ?? "";
    if (
      eventType !== "fungible_token_asset" &&
      eventType !== "ft_transfer_event"
    ) {
      continue;
    }
    if (ev.asset?.asset_event_type && ev.asset.asset_event_type !== "transfer") {
      continue;
    }
    const asset = (ev.asset?.asset_id ?? "").toLowerCase();
    if (!asset.includes("usdcx") && asset !== wantAsset) continue;
    const sender = ev.asset?.sender;
    const recipient = ev.asset?.recipient;
    if (sender !== from) continue;
    if (recipient !== keeper) continue;
    const amt = ev.asset?.amount ?? "0";
    if (/^\d+$/.test(amt)) credited += BigInt(amt);
  }

  if (credited < min) {
    if ((tx.events?.length ?? 0) === 0) {
      throw new ServiceError(
        409,
        "Funding transaction confirmed, waiting for Hiro to index the USDCx transfer.",
      );
    }
    throw new ServiceError(
      400,
      `Funding tx did not send enough USDCx to the PaySats keeper (got ${credited.toString()}, need ${opts.minAmountRaw})`,
    );
  }
  return { amountRaw: credited.toString() };
}

export function sbtcReceivedByAddress(
  events: HiroFtEvent[] | undefined,
  recipient: string,
): bigint {
  let out = BigInt(0);
  for (const ev of events ?? []) {
    if (ev.event_type !== "fungible_token_asset") continue;
    if (ev.asset?.asset_event_type !== "transfer") continue;
    const asset = (ev.asset.asset_id ?? "").toLowerCase();
    if (!asset.includes("sbtc")) continue;
    if (ev.asset.recipient !== recipient) continue;
    const amt = ev.asset.amount ?? "0";
    if (/^\d+$/.test(amt)) out += BigInt(amt);
  }
  return out;
}

async function fetchHiroTxPage(
  id: string,
  eventOffset: number,
): Promise<HiroTx> {
  const qs = new URLSearchParams({
    event_offset: String(eventOffset),
    event_limit: "50",
  });
  const res = await hiroFetch(`/extended/v1/tx/${id}?${qs}`, {
    network: "mainnet",
    cacheTtlMs: 0,
    retries: 2,
  });
  if (res.status === 404) return { tx_status: "not_found" };
  if (!res.ok) {
    throw new ServiceError(502, `Hiro API error (${res.status})`);
  }
  return (await res.json()) as HiroTx;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll Hiro until a tx succeeds, fails, or times out. */
export async function waitForTxSuccess(
  txId: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<HiroTx & { tx_status?: string }> {
  const timeoutMs = opts?.timeoutMs ?? 180_000;
  const intervalMs = opts?.intervalMs ?? 4_000;
  const deadline = Date.now() + timeoutMs;
  let last: HiroTx & { tx_status?: string } = { tx_status: "pending" };
  while (Date.now() < deadline) {
    last = await fetchHiroTx(txId);
    if (last.tx_status === "success") return last;
    if (
      last.tx_status &&
      last.tx_status !== "pending" &&
      last.tx_status !== "not_found"
    ) {
      throw new ServiceError(400, `Transaction failed (${last.tx_status})`);
    }
    await sleep(intervalMs);
  }
  throw new ServiceError(
    408,
    `Transaction ${txId} did not confirm within ${Math.round(timeoutMs / 1000)}s`,
  );
}

/** Hiro returns the first 20 events by default; multi-hop swaps have more. */
export async function fetchHiroTx(txId: string): Promise<HiroTx & { tx_status?: string }> {
  const id = normalizeTxId(txId);
  const first = await fetchHiroTxPage(id, 0);
  if (first.tx_status === "not_found") return first;

  const events = [...(first.events ?? [])];
  const total = first.event_count ?? events.length;
  while (events.length < total) {
    const page = await fetchHiroTxPage(id, events.length);
    const more = page.events ?? [];
    if (more.length === 0) break;
    events.push(...more);
  }
  return { ...first, events };
}
