import { prisma } from "@/lib/prisma";
import {
  STACKS_DCA_INTERVALS,
  getStacksKeeperAddress,
  sbtcToken,
  stacksNetworkId,
  swapEnabled,
  usdcxToken,
  zestEnabled,
} from "@/lib/stacks/config";
import {
  buildZestBorrowTx,
  buildZestCollateralAddTx,
} from "@/lib/stacks/zest-tx";
import { ServiceError } from "@/services/errors";
import { previewStacksDca } from "@/services/stacks/dca-preview";
import { cancelStacksDcaOrder } from "@/services/stacks/dca-cancel";
import { kickExecuteDueDcaOrders } from "@/services/stacks/dca-executor";
import { waitForTxSuccess } from "@/services/stacks/funding-tx";
import { fetchPythPriceFeedHexes } from "@/services/stacks/pyth";
import {
  agentSignerFromUser,
  appPublicUrl,
  frequencySeconds,
  generateAgentWallet,
  isStacksAddress,
  requireDbUser,
  usdcxRawFromHuman,
} from "@/services/stacks/agent-wallet";
import { getStacksBalances } from "@/services/stacks/balances";
import {
  broadcastContractCalls,
  transferSip010,
  transferStx,
} from "@/services/stacks/signer";
import { verifyUsdcxFundingTx } from "@/services/stacks/funding-tx";
import {
  previewZestBorrow,
  serializeZestPreview,
} from "@/services/stacks/zest";
import type { User as DbUser } from "@prisma/client";

export type NeedsDeposit = {
  ok: false;
  needsDeposit: true;
  agentAddress: string;
  depositUrl: string;
  token: "usdcx" | "sbtc" | "stx";
  have: number;
  required: number;
  shortfall: number;
  instructions: string;
};

async function recordAction(opts: {
  userId: string;
  tool: string;
  txId?: string | null;
  status: "pending" | "success" | "failed";
  params?: unknown;
  result?: unknown;
  error?: string;
}) {
  await prisma.stacksAgentAction.create({
    data: {
      userId: opts.userId,
      tool: opts.tool,
      txId: opts.txId ?? null,
      network: stacksNetworkId(),
      status: opts.status,
      paramsJson: opts.params ? JSON.stringify(opts.params) : null,
      resultJson: opts.result ? JSON.stringify(opts.result) : null,
      error: opts.error ?? null,
    },
  });
}

async function ensureAgent(privyUserId: string): Promise<DbUser> {
  const { user } = await generateAgentWallet(privyUserId);
  if (!user.stacksAgentAddress) {
    throw new ServiceError(500, "Failed to create Stacks agent account");
  }
  return user;
}

function depositPayload(
  user: DbUser,
  token: NeedsDeposit["token"],
  have: number,
  required: number,
): NeedsDeposit {
  const agentAddress = user.stacksAgentAddress!;
  const shortfall = Math.max(0, required - have);
  return {
    ok: false,
    needsDeposit: true,
    agentAddress,
    depositUrl: `${appPublicUrl()}/stacks`,
    token,
    have,
    required,
    shortfall,
    instructions: `Send ${shortfall} ${token.toUpperCase()} to the agent address ${agentAddress}, then retry. Open depositUrl to copy the address from the app.`,
  };
}

export async function setupSbtcDca(opts: {
  privyUserId: string;
  amountUsdcx: number;
  numberOfOrders: number;
  frequency: (typeof STACKS_DCA_INTERVALS)[number]["id"];
}): Promise<
  | NeedsDeposit
  | {
      ok: true;
      orderId: string;
      fundingTxId: string;
      preview: Awaited<ReturnType<typeof previewStacksDca>>;
    }
> {
  if (!swapEnabled()) {
    throw new ServiceError(400, "Stacks DCA is mainnet-only");
  }
  const user = await ensureAgent(opts.privyUserId);
  const signer = agentSignerFromUser(user);
  const executionFrequency = frequencySeconds(opts.frequency);
  const preview = await previewStacksDca({
    amountPerOrder: opts.amountUsdcx,
    numberOfOrders: opts.numberOfOrders,
    executionFrequency,
  });

  const balances = await getStacksBalances(signer.address, "mainnet");
  if (balances.usdcx + 1e-9 < preview.fundingAmount) {
    return depositPayload(
      user,
      "usdcx",
      balances.usdcx,
      preview.fundingAmount,
    );
  }
  if (balances.stx < 0.01) {
    return depositPayload(user, "stx", balances.stx, 0.1);
  }

  const fundingAmountRaw = BigInt(preview.fundingAmountRaw);
  const { txId } = await transferSip010({
    signer,
    token: usdcxToken("mainnet"),
    amountRaw: fundingAmountRaw,
    recipient: getStacksKeeperAddress(),
  });

  await waitForTxSuccess(txId);
  await verifyUsdcxFundingTx({
    txId,
    from: signer.address,
    minAmountRaw: preview.fundingAmountRaw,
  });

  const existing = await prisma.stacksDcaOrder.findFirst({
    where: { fundingTxId: txId },
  });
  if (existing) {
    await recordAction({
      userId: user.id,
      tool: "setup_sbtc_dca",
      txId,
      status: "success",
      params: opts,
      result: { orderId: existing.id },
    });
    return { ok: true, orderId: existing.id, fundingTxId: txId, preview };
  }

  const amountPerOrderRaw = String(
    Math.round(opts.amountUsdcx * 10 ** usdcxToken("mainnet").decimals),
  );

  const row = await prisma.stacksDcaOrder.create({
    data: {
      userId: user.id,
      stacksAddress: signer.address,
      network: stacksNetworkId(),
      groupId: null,
      keeperContractId: getStacksKeeperAddress(),
      amountPerOrderRaw,
      numberOfOrders: opts.numberOfOrders,
      executionFrequency,
      fundingAmountRaw: preview.fundingAmountRaw,
      fundingTxId: txId,
      quotedOutRaw: String(preview.quotedOutSats),
      status: "active",
      nextExecutionAt: new Date(),
      remainingOrders: opts.numberOfOrders,
    },
  });

  kickExecuteDueDcaOrders();
  await recordAction({
    userId: user.id,
    tool: "setup_sbtc_dca",
    txId,
    status: "success",
    params: opts,
    result: { orderId: row.id },
  });

  return { ok: true, orderId: row.id, fundingTxId: txId, preview };
}

export async function cancelSbtcDca(opts: {
  privyUserId: string;
  orderId?: string;
}) {
  const user = await requireDbUser(opts.privyUserId);
  const order =
    opts.orderId != null
      ? await prisma.stacksDcaOrder.findFirst({
          where: { id: opts.orderId, userId: user.id },
        })
      : await prisma.stacksDcaOrder.findFirst({
          where: {
            userId: user.id,
            status: { in: ["active", "executing", "cancelling"] },
          },
          orderBy: { createdAt: "desc" },
        });
  if (!order) {
    throw new ServiceError(404, "No active sBTC DCA order to cancel");
  }
  if (order.groupId) {
    throw new ServiceError(
      400,
      "This DCA was created with Bitflow Keepers and must be cancelled in the app with a wallet signature.",
    );
  }

  const result = await cancelStacksDcaOrder({
    userId: user.id,
    orderId: order.id,
  });
  await recordAction({
    userId: user.id,
    tool: "cancel_sbtc_dca",
    txId: result.refundTxId,
    status: "success",
    params: { orderId: order.id },
    result,
  });
  return { ok: true, ...result };
}

export async function borrowUsdcxAgainstSbtc(opts: {
  privyUserId: string;
  collateralSats: number;
  borrowUsdcx: number;
}): Promise<
  | NeedsDeposit
  | {
      ok: true;
      collateralTxId: string | null;
      borrowTxId: string | null;
      preview: ReturnType<typeof serializeZestPreview>;
    }
> {
  if (!zestEnabled()) {
    throw new ServiceError(400, "Zest borrow is mainnet-only");
  }
  const user = await ensureAgent(opts.privyUserId);
  const signer = agentSignerFromUser(user);
  const collateralSats = BigInt(Math.max(0, Math.floor(opts.collateralSats)));
  const borrowUsdcxRaw = usdcxRawFromHuman(opts.borrowUsdcx);
  if (collateralSats <= BigInt(0) && borrowUsdcxRaw <= BigInt(0)) {
    throw new ServiceError(400, "Provide collateralSats and/or borrowUsdcx");
  }

  const preview = await previewZestBorrow({
    address: signer.address,
    collateralSats,
    borrowUsdcxRaw,
    network: "mainnet",
  });
  if (!preview.withinLimit) {
    throw new ServiceError(
      400,
      `Borrow is above the safe LTV cap (max ${Number(preview.maxBorrowRaw) / 1e6} USDCx)`,
    );
  }

  const balances = await getStacksBalances(signer.address, "mainnet");
  if (collateralSats > BigInt(0) && BigInt(balances.sbtcRaw) < collateralSats) {
    return depositPayload(
      user,
      "sbtc",
      balances.sbtcSats,
      Number(collateralSats),
    );
  }
  if (balances.stx < 0.02) {
    return depositPayload(user, "stx", balances.stx, 0.1);
  }

  const feeds = await fetchPythPriceFeedHexes();
  const calls = [];
  if (collateralSats > BigInt(0)) {
    const add = buildZestCollateralAddTx({
      senderAddress: signer.address,
      amountSats: collateralSats,
      priceFeedHexes: feeds,
    });
    calls.push({
      contractAddress: add.contractAddress,
      contractName: add.contractName,
      functionName: add.functionName,
      functionArgs: add.functionArgs,
      postConditions: add.postConditions,
    });
  }
  if (borrowUsdcxRaw > BigInt(0)) {
    const bor = buildZestBorrowTx({
      senderAddress: signer.address,
      amountUsdcxRaw: borrowUsdcxRaw,
      priceFeedHexes: feeds,
    });
    calls.push({
      contractAddress: bor.contractAddress,
      contractName: bor.contractName,
      functionName: bor.functionName,
      functionArgs: bor.functionArgs,
      postConditions: bor.postConditions,
    });
  }

  const results = await broadcastContractCalls(signer, calls);
  let i = 0;
  let collateralTxId: string | null = null;
  let borrowTxId: string | null = null;
  if (collateralSats > BigInt(0)) {
    collateralTxId = results[i++]?.txId ?? null;
    if (collateralTxId) {
      await prisma.stacksZestTx.create({
        data: {
          userId: user.id,
          stacksAddress: signer.address,
          txId: collateralTxId,
          network: "mainnet",
          kind: "collateral_add",
          amountRaw: collateralSats.toString(),
        },
      });
    }
  }
  if (borrowUsdcxRaw > BigInt(0)) {
    borrowTxId = results[i++]?.txId ?? null;
    if (borrowTxId) {
      await prisma.stacksZestTx.create({
        data: {
          userId: user.id,
          stacksAddress: signer.address,
          txId: borrowTxId,
          network: "mainnet",
          kind: "borrow",
          amountRaw: borrowUsdcxRaw.toString(),
        },
      });
    }
  }

  await recordAction({
    userId: user.id,
    tool: "borrow",
    txId: borrowTxId ?? collateralTxId,
    status: "success",
    params: opts,
    result: { collateralTxId, borrowTxId },
  });

  return {
    ok: true,
    collateralTxId,
    borrowTxId,
    preview: serializeZestPreview(preview),
  };
}

export async function withdrawFromAgent(opts: {
  privyUserId: string;
  token: "usdcx" | "sbtc" | "stx";
  amount: number;
  recipient?: string;
}): Promise<
  | NeedsDeposit
  | { ok: true; txId: string; recipient: string; amount: number; token: string }
> {
  const user = await requireDbUser(opts.privyUserId);
  const signer = agentSignerFromUser(user);
  const recipient = (opts.recipient ?? user.stacksAddress ?? "").trim();
  if (!isStacksAddress(recipient)) {
    throw new ServiceError(
      400,
      "Set a withdraw destination: connect Leather at /stacks, or pass recipient (SP…).",
    );
  }
  if (recipient === signer.address) {
    throw new ServiceError(400, "Recipient is the agent account itself");
  }
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) {
    throw new ServiceError(400, "amount must be positive");
  }

  const balances = await getStacksBalances(signer.address, "mainnet");
  if (opts.token === "stx") {
    const raw = BigInt(Math.round(opts.amount * 1e6));
    if (BigInt(balances.stxRaw) < raw) {
      return depositPayload(user, "stx", balances.stx, opts.amount);
    }
    const { txId } = await transferStx({
      signer,
      amountUstx: raw,
      recipient,
    });
    await recordAction({
      userId: user.id,
      tool: "withdraw",
      txId,
      status: "success",
      params: opts,
      result: { recipient },
    });
    return { ok: true, txId, recipient, amount: opts.amount, token: "stx" };
  }

  const token = opts.token === "sbtc" ? sbtcToken("mainnet") : usdcxToken("mainnet");
  const raw =
    opts.token === "sbtc"
      ? BigInt(Math.round(opts.amount))
      : usdcxRawFromHuman(opts.amount);
  const haveRaw =
    opts.token === "sbtc" ? BigInt(balances.sbtcRaw) : BigInt(balances.usdcxRaw);
  if (haveRaw < raw) {
    return depositPayload(
      user,
      opts.token,
      opts.token === "sbtc" ? balances.sbtcSats : balances.usdcx,
      opts.amount,
    );
  }

  const { txId } = await transferSip010({
    signer,
    token,
    amountRaw: raw,
    recipient,
  });
  await recordAction({
    userId: user.id,
    tool: "withdraw",
    txId,
    status: "success",
    params: opts,
    result: { recipient },
  });
  return { ok: true, txId, recipient, amount: opts.amount, token: opts.token };
}
