import {
  BITFLOW_TOKEN_ID_SBTC,
  BITFLOW_TOKEN_ID_USDCX,
  getStacksKeeperAddress,
  usdcxToken,
} from "@/lib/stacks/config";
import { ServiceError } from "@/services/errors";
import { getUsdcxToSbtcQuote } from "@/services/stacks/bitflow";

export type DcaPreview = {
  amountPerOrder: number;
  numberOfOrders: number;
  executionFrequency: number;
  fundingAmountRaw: string;
  fundingAmount: number;
  quotedOutSats: number;
  quotedOutSatsTotal: number;
  tokenXId: string;
  tokenYId: string;
  /** PaySats Stacks keeper address users prefund with USDCx. */
  keeperAddress: string;
  note: string;
};

/** Preview a prepaid DCA using the same Bitflow aggregator quote as M1 swaps. */
export async function previewStacksDca(opts: {
  amountPerOrder: number;
  numberOfOrders: number;
  executionFrequency: number;
}): Promise<DcaPreview> {
  const { amountPerOrder, numberOfOrders, executionFrequency } = opts;
  if (!Number.isFinite(amountPerOrder) || amountPerOrder <= 0) {
    throw new ServiceError(400, "amountPerOrder must be a positive number");
  }
  if (
    !Number.isInteger(numberOfOrders) ||
    numberOfOrders < 2 ||
    numberOfOrders > 52
  ) {
    throw new ServiceError(400, "numberOfOrders must be an integer from 2 to 52");
  }
  if (!Number.isInteger(executionFrequency) || executionFrequency < 60) {
    throw new ServiceError(400, "executionFrequency must be at least 60 seconds");
  }

  const quote = await getUsdcxToSbtcQuote(amountPerOrder);
  const usdcx = usdcxToken("mainnet");
  const fundingAmountRaw = String(
    Math.round(amountPerOrder * numberOfOrders * 10 ** usdcx.decimals),
  );

  let keeperAddress: string;
  try {
    keeperAddress = getStacksKeeperAddress();
  } catch (e) {
    throw new ServiceError(
      503,
      e instanceof Error ? e.message : "Stacks keeper is not configured",
    );
  }

  return {
    amountPerOrder,
    numberOfOrders,
    executionFrequency,
    fundingAmountRaw,
    fundingAmount: amountPerOrder * numberOfOrders,
    quotedOutSats: quote.amountOutSats,
    quotedOutSatsTotal: quote.amountOutSats * numberOfOrders,
    tokenXId: BITFLOW_TOKEN_ID_USDCX,
    tokenYId: BITFLOW_TOKEN_ID_SBTC,
    keeperAddress,
    note:
      "You send prepaid USDCx to PaySats' Stacks keeper. We swap on Bitflow on schedule and send sBTC to your wallet.",
  };
}
