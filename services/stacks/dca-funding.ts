import { assetIdentifier, usdcxToken } from "@/lib/stacks/config";
import { hiroFetch } from "@/lib/stacks/hiro";
import { ServiceError } from "@/services/errors";

type HiroFtTransfer = {
  asset_identifier?: string;
  amount?: string;
  sender?: string;
  recipient?: string;
};

type HiroTxWithTransfers = {
  tx?: { tx_id?: string; tx_status?: string };
  ft_transfers?: HiroFtTransfer[];
};

function normalizeTxId(txId: string): string {
  const t = txId.trim().toLowerCase();
  return t.startsWith("0x") ? t : `0x${t}`;
}

/**
 * Verify a successful USDCx transfer from the user into the PaySats keeper.
 */
export async function verifyDcaFundingTx(opts: {
  fundingTxId: string;
  fromAddress: string;
  keeperAddress: string;
  minAmountRaw: string;
}): Promise<{ amountRaw: string }> {
  const txId = normalizeTxId(opts.fundingTxId);
  const usdcx = usdcxToken("mainnet");
  const asset = assetIdentifier(usdcx).toLowerCase();
  const min = BigInt(opts.minAmountRaw);

  const res = await hiroFetch(`/extended/v1/tx/${txId}`, {
    network: "mainnet",
    retries: 2,
  });
  if (res.status === 404) {
    throw new ServiceError(400, "Funding transaction not found on Hiro yet");
  }
  if (!res.ok) {
    throw new ServiceError(502, `Hiro API error (${res.status})`);
  }

  const json = (await res.json()) as HiroTxWithTransfers & {
    tx_status?: string;
    events?: Array<{
      event_type?: string;
      asset?: { asset_id?: string; amount?: string };
      sender?: string;
      recipient?: string;
    }>;
  };

  const status = json.tx?.tx_status ?? json.tx_status;
  if (status !== "success") {
    throw new ServiceError(
      400,
      status === "pending"
        ? "Funding transaction is still pending"
        : "Funding transaction did not succeed",
    );
  }

  let matched = BigInt(0);
  for (const ft of json.ft_transfers ?? []) {
    if ((ft.asset_identifier ?? "").toLowerCase() !== asset) continue;
    if (ft.sender !== opts.fromAddress) continue;
    if (ft.recipient !== opts.keeperAddress) continue;
    matched += BigInt(ft.amount ?? "0");
  }

  for (const ev of json.events ?? []) {
    if (ev.event_type !== "ft_transfer_event") continue;
    const assetId = (ev.asset?.asset_id ?? "").toLowerCase();
    if (!assetId.includes("usdcx")) continue;
    if (ev.sender !== opts.fromAddress) continue;
    if (ev.recipient !== opts.keeperAddress) continue;
    matched += BigInt(ev.asset?.amount ?? "0");
  }

  if (matched < min) {
    throw new ServiceError(
      400,
      `Funding transfer must send at least ${opts.minAmountRaw} USDCx minor units to the keeper`,
    );
  }

  return { amountRaw: matched.toString() };
}
