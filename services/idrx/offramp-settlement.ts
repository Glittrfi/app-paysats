import type { IdrxDepositRedeemRecord } from "./types";
import type { TranslationKey } from "@/lib/translations";

export type OfframpStage =
  | "pending_transfer"
  | "swapping"
  | "burning"
  | "disbursed"
  | "failed";

export type OfframpSettlement = {
  stage: OfframpStage;
  /** Short human-readable status line (Indonesian fallback) */
  summary: string;
  /** Translation key the UI should render so the summary respects the locale */
  summaryKey: TranslationKey;
  /** Whether this redeem is in a terminal state */
  terminal: boolean;
};

/**
 * Derive a coarse stage from an IDRX DEPOSIT_REDEEM record. Stages:
 *
 *   pending_transfer – IDRX has seen the transferTxHash but hasn't swapped yet
 *   swapping         – swap is in-flight (or pending), burn not yet recorded
 *   burning          – swap complete, IDRX burn tx in-flight
 *   disbursed        – redeem fully settled, amountRedeem present
 *   failed           – explicit FAIL/ERROR status
 */
/**
 * Exact IDRX terminal-failure statuses. Substring matching (e.g. includes("FAIL"))
 * is unsafe because IDRX occasionally returns transient composite strings that
 * aren't real terminal failures — we'd rather over-wait than falsely terminate.
 */
const FAILURE_STATUSES = new Set([
  "FAILED",
  "FAIL",
  "ERROR",
  "REJECTED",
  "CANCELLED",
  "CANCELED",
  "EXPIRED",
]);

export function deriveOfframpStage(
  r: IdrxDepositRedeemRecord,
): OfframpSettlement {
  const status = (r.status ?? "").toUpperCase().trim();

  const hasSwap = Boolean(r.swapTxHash);
  const hasBurn = Boolean(r.burnTxHash);
  const hasRedeem = Boolean(r.amountRedeem && r.amountRedeem !== "0");
  const success = status === "SUCCESS" || status === "SUCCEED";

  // Treat SUCCESS as authoritative even if amountRedeem hasn't propagated yet,
  // since the swap/burn txs are on-chain and verifiable.
  if (success && (hasRedeem || hasBurn)) {
    return {
      stage: "disbursed",
      summary: "IDR sudah dikirim ke rekening/e-wallet",
      summaryKey: "offramp.summaryDisbursed",
      terminal: true,
    };
  }

  // Only mark failed when IDRX gives us an explicit, known terminal error
  // status AND there's no evidence of forward progress (no burn tx).
  if (FAILURE_STATUSES.has(status) && !hasBurn && !hasRedeem) {
    return {
      stage: "failed",
      summary: "Redeem gagal — dana akan dikembalikan",
      summaryKey: "offramp.summaryFailed",
      terminal: true,
    };
  }

  if (hasBurn) {
    return {
      stage: "burning",
      summary: "IDRX dibakar — menunggu pencairan IDR",
      summaryKey: "offramp.summaryBurning",
      terminal: false,
    };
  }

  if (hasSwap) {
    return {
      stage: "burning",
      summary: "Swap selesai — sedang diproses ke IDR",
      summaryKey: "offramp.summarySwapped",
      terminal: false,
    };
  }

  // Transfer seen by IDRX, no swap yet
  return {
    stage: r.transferTxHash ? "swapping" : "pending_transfer",
    summary: r.transferTxHash
      ? "Menukar USDC ke IDRX…"
      : "Menunggu konfirmasi transfer on-chain…",
    summaryKey: r.transferTxHash
      ? "offramp.summarySwapping"
      : "offramp.summaryPendingTransfer",
    terminal: false,
  };
}

/** For records we've only persisted locally (no IDRX match yet). */
export function pendingLocalSettlement(): OfframpSettlement {
  return {
    stage: "pending_transfer",
    summary: "Menunggu konfirmasi IDRX…",
    summaryKey: "offramp.summaryPendingIdrx",
    terminal: false,
  };
}
