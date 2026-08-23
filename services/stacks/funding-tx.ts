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
  const id = normalizeTxId(opts.txId);
  const res = await hiroFetch(`/extended/v1/tx/${id}`, {
    network: "mainnet",
    cacheTtlMs: 0,
    retries: 3,
  });
  if (res.status === 404) {
    throw new ServiceError(
      409,
      "Funding transaction is not on chain yet. Wait for it to confirm, then try again.",
    );
  }
  if (!res.ok) {
    throw new ServiceError(502, `Hiro API error (${res.status}) reading funding tx`);
  }
  const tx = (await res.json()) as HiroTx;
  if (tx.tx_status === "pending") {
    throw new ServiceError(
      409,
      "Funding transaction is still pending. Wait for confirmation, then try again.",
    );
  }
  if (tx.tx_status !== "success") {
    throw new ServiceError(400, `Funding transaction failed (${tx.tx_status ?? "unknown"})`);
  }

  const usdcx = usdcxToken("mainnet");
  const wantAsset = assetIdentifier(usdcx).toLowerCase();
  const from = opts.from.trim();
  const min = BigInt(opts.minAmountRaw);
  let credited = BigInt(0);

  for (const ev of tx.events ?? []) {
    if (ev.event_type !== "fungible_token_asset") continue;
    if (ev.asset?.asset_event_type !== "transfer") continue;
    const asset = (ev.asset.asset_id ?? "").toLowerCase();
    if (!asset.includes("usdcx") && asset !== wantAsset) continue;
    if (ev.asset.sender !== from) continue;
    if (ev.asset.recipient !== keeper) continue;
    const amt = ev.asset.amount ?? "0";
    if (/^\d+$/.test(amt)) credited += BigInt(amt);
  }

  if (credited < min) {
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
