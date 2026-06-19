import type { MintTransaction } from "@/types/transaction";
import type { TranslationKey } from "@/lib/translations";

/** Mengacu ke docs IDRX: paymentStatus + userMintStatus / adminMintStatus */
export type MintSettlement = {
  paymentComplete: boolean;
  mintComplete: boolean;
  /** Ringkasan untuk UI (Indonesian fallback for non-localized contexts) */
  summary: string;
  /** Translation key the UI should render so the summary respects the locale */
  summaryKey: TranslationKey;
};

export function deriveMintSettlement(tx: MintTransaction): MintSettlement {
  const ps = tx.paymentStatus?.toUpperCase() ?? "";
  const um = tx.userMintStatus?.toUpperCase() ?? "";
  const am = tx.adminMintStatus?.toUpperCase() ?? "";

  const paymentComplete = ps === "PAID" || ps.includes("SUCCESS");
  const mintComplete =
    (um === "MINTED" || am === "MINTED") &&
    !um.includes("FAIL") &&
    !am.includes("FAIL");

  let summary: string;
  let summaryKey: TranslationKey;
  if (mintComplete && paymentComplete) {
    summary = "Pembayaran & mint selesai";
    summaryKey = "tx.settle.done";
  } else if (paymentComplete && !mintComplete) {
    summary = "Dibayar — mint sedang diproses";
    summaryKey = "tx.settle.paidMinting";
  } else if (ps.includes("WAITING")) {
    summary = "Menunggu pembayaran";
    summaryKey = "tx.settle.waitingPayment";
  } else if (ps.includes("EXPIRED")) {
    summary = "Pembayaran kedaluwarsa";
    summaryKey = "tx.settle.expired";
  } else if (um.includes("FAIL") || am.includes("FAIL")) {
    summary = "Mint gagal";
    summaryKey = "tx.settle.mintFailed";
  } else {
    summary = "Dalam proses";
    summaryKey = "tx.settle.processing";
  }

  return { paymentComplete, mintComplete, summary, summaryKey };
}
