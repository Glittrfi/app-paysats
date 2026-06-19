import type { TranslationKey } from "@/lib/translations";

export type MintSettlementInfo = {
  paymentComplete: boolean;
  mintComplete: boolean;
  summary: string;
  /** Translation key the UI renders so the summary respects the locale */
  summaryKey: TranslationKey;
};

export type MintTransaction = {
  id: string;
  paymentAmount: number;
  toBeMinted: string;
  destinationWalletAddress: string;
  paymentStatus: string;
  adminMintStatus: string;
  userMintStatus: string;
  reference?: string;
  merchantOrderId?: string;
  createdAt: string;
  txHash?: string | null;
  expiryTimestamp?: string | null;
  /** Dari API PaySats setelah cek status IDRX */
  settlement?: MintSettlementInfo;
};
