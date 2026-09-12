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
import { reviveBigInts } from "@/lib/stacks/json";
import {
  buildZestBorrowTx,
  buildZestCollateralAddTx,
  buildZestCollateralRemoveTx,
  buildZestRepayTx,
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
  type ContractCallSpec,
  transferSip010,
  transferStx,
} from "@/services/stacks/signer";
import { verifyUsdcxFundingTx } from "@/services/stacks/funding-tx";
import {
  getAgentSwapQuote,
  getBitflowSdk,
  publicAgentSwapQuote,
  type AgentSwapToken,
} from "@/services/stacks/bitflow";
import {
  getZestPosition,
  previewZestBorrow,
  serializeZestPosition,
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

function resolveSwapInput(opts: {
  from: AgentSwapToken;
  amountSats?: number;
  amountUsdcx?: number;
  balances: Awaited<ReturnType<typeof getStacksBalances>>;
}): { human: number; raw: bigint } {
  if (opts.from === "sbtc") {
    const raw =
      opts.amountSats != null && Number.isFinite(opts.amountSats)
        ? BigInt(Math.max(0, Math.floor(opts.amountSats)))
        : BigInt(opts.balances.sbtcRaw);
    return { human: Number(raw) / 1e8, raw };
  }
  const raw =
    opts.amountUsdcx != null && Number.isFinite(opts.amountUsdcx)
      ? usdcxRawFromHuman(opts.amountUsdcx)
      : BigInt(opts.balances.usdcxRaw);
  return { human: Number(raw) / 1e6, raw };
}

export async function quoteAgentBitflowSwap(opts: {
  privyUserId: string;
  from?: AgentSwapToken;
  to?: AgentSwapToken;
  amountSats?: number;
  amountUsdcx?: number;
  slippage?: number;
}) {
  if (!swapEnabled()) {
    throw new ServiceError(400, "Bitflow swap is mainnet-only");
  }
  const from = opts.from ?? "sbtc";
  const to = opts.to ?? (from === "sbtc" ? "usdcx" : "sbtc");
  const user = await ensureAgent(opts.privyUserId);
  const signer = agentSignerFromUser(user);
  const balances = await getStacksBalances(signer.address, "mainnet");
  const input = resolveSwapInput({
    from,
    amountSats: opts.amountSats,
    amountUsdcx: opts.amountUsdcx,
    balances,
  });
  if (input.raw <= BigInt(0)) {
    throw new ServiceError(400, `No ${from.toUpperCase()} to quote`);
  }
  const quote = await getAgentSwapQuote({
    from,
    to,
    amountInHuman: input.human,
    slippage: opts.slippage,
  });
  return {
    ok: true as const,
    agentAddress: signer.address,
    quote: publicAgentSwapQuote(quote),
  };
}

export async function swapOnAgent(opts: {
  privyUserId: string;
  from?: AgentSwapToken;
  to?: AgentSwapToken;
  amountSats?: number;
  amountUsdcx?: number;
  slippage?: number;
}): Promise<
  | NeedsDeposit
  | {
      ok: true;
      txId: string;
      quote: ReturnType<typeof publicAgentSwapQuote>;
    }
> {
  if (!swapEnabled()) {
    throw new ServiceError(400, "Bitflow swap is mainnet-only");
  }
  const from = opts.from ?? "sbtc";
  const to = opts.to ?? (from === "sbtc" ? "usdcx" : "sbtc");
  const user = await ensureAgent(opts.privyUserId);
  const signer = agentSignerFromUser(user);
  const balances = await getStacksBalances(signer.address, "mainnet");
  const input = resolveSwapInput({
    from,
    amountSats: opts.amountSats,
    amountUsdcx: opts.amountUsdcx,
    balances,
  });
  if (input.raw <= BigInt(0)) {
    return depositPayload(user, from, from === "sbtc" ? balances.sbtcSats : balances.usdcx, 1);
  }

  const haveRaw =
    from === "sbtc" ? BigInt(balances.sbtcRaw) : BigInt(balances.usdcxRaw);
  if (haveRaw < input.raw) {
    return depositPayload(
      user,
      from,
      from === "sbtc" ? balances.sbtcSats : balances.usdcx,
      from === "sbtc" ? Number(input.raw) : input.human,
    );
  }
  if (balances.stx < 0.02) {
    return depositPayload(user, "stx", balances.stx, 0.1);
  }

  const quote = await getAgentSwapQuote({
    from,
    to,
    amountInHuman: input.human,
    slippage: opts.slippage,
  });
  const sdk = getBitflowSdk();
  const swapParams = await sdk.getSwapParams(
    {
      route: reviveBigInts(quote.route),
      amount: quote.amountIn,
      tokenXDecimals: quote.tokenXDecimals,
      tokenYDecimals: quote.tokenYDecimals,
    },
    signer.address,
    quote.slippage,
  );

  const [{ txId }] = await broadcastContractCalls(signer, [
    {
      contractAddress: swapParams.contractAddress,
      contractName: swapParams.contractName,
      functionName: swapParams.functionName,
      functionArgs: swapParams.functionArgs,
      postConditions: swapParams.postConditions,
    },
  ]);
  await waitZestTx(txId);

  const tokenIn =
    from === "sbtc" ? sbtcToken("mainnet").contract : usdcxToken("mainnet").contract;
  const tokenOut =
    to === "sbtc" ? sbtcToken("mainnet").contract : usdcxToken("mainnet").contract;

  await prisma.stacksSwap.create({
    data: {
      userId: user.id,
      stacksAddress: signer.address,
      txId,
      network: "mainnet",
      tokenIn,
      tokenOut,
      amountInRaw: quote.amountInRaw,
      amountOutRaw: quote.amountOutRaw,
      status: "pending",
    },
  });
  await recordAction({
    userId: user.id,
    tool: "swap",
    txId,
    status: "success",
    params: opts,
    result: { from, to, amountOut: quote.amountOut },
  });

  return {
    ok: true,
    txId,
    quote: publicAgentSwapQuote(quote),
  };
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

function zestCall(tx: {
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: ContractCallSpec["functionArgs"];
  postConditions: ContractCallSpec["postConditions"];
}): ContractCallSpec {
  return {
    contractAddress: tx.contractAddress,
    contractName: tx.contractName,
    functionName: tx.functionName,
    functionArgs: tx.functionArgs,
    postConditions: tx.postConditions,
  };
}

async function waitZestTx(txId: string) {
  try {
    await waitForTxSuccess(txId, { timeoutMs: 35_000 });
  } catch (e) {
    if (e instanceof ServiceError && e.status === 408) return;
    throw e;
  }
}

/** 0.5% + 1¢ so accrued interest does not leave leftover dust debt. */
function zestRepayBuffer(debt: bigint): bigint {
  return debt / BigInt(200) + BigInt(10_000);
}

export async function repayZestBorrow(opts: {
  privyUserId: string;
  amountUsdcx?: number;
  full?: boolean;
}): Promise<
  | NeedsDeposit
  | {
      ok: true;
      txId: string;
      repaidUsdcx: number;
      full: boolean;
      position: ReturnType<typeof serializeZestPosition>;
      instructions: string;
    }
> {
  if (!zestEnabled()) {
    throw new ServiceError(400, "Zest borrow is mainnet-only");
  }
  const user = await ensureAgent(opts.privyUserId);
  const signer = agentSignerFromUser(user);
  const pos = await getZestPosition(signer.address, "mainnet");
  if (pos.debtUsdcxRaw <= BigInt(0)) {
    throw new ServiceError(400, "No Zest USDCx debt to repay");
  }

  const full =
    opts.full === true ||
    (opts.full !== false &&
      (opts.amountUsdcx == null || !Number.isFinite(opts.amountUsdcx)));
  const repayRaw = full
    ? pos.debtUsdcxRaw + zestRepayBuffer(pos.debtUsdcxRaw)
    : usdcxRawFromHuman(opts.amountUsdcx ?? 0);
  if (repayRaw <= BigInt(0)) {
    throw new ServiceError(400, "amountUsdcx must be positive, or set full=true");
  }

  const balances = await getStacksBalances(signer.address, "mainnet");
  if (BigInt(balances.usdcxRaw) < repayRaw) {
    return depositPayload(
      user,
      "usdcx",
      balances.usdcx,
      Number(repayRaw) / 1e6,
    );
  }
  if (balances.stx < 0.02) {
    return depositPayload(user, "stx", balances.stx, 0.1);
  }

  const repay = buildZestRepayTx({
    senderAddress: signer.address,
    amountUsdcxRaw: repayRaw,
  });
  const [{ txId }] = await broadcastContractCalls(signer, [zestCall(repay)]);
  await waitZestTx(txId);
  await prisma.stacksZestTx.create({
    data: {
      userId: user.id,
      stacksAddress: signer.address,
      txId,
      network: "mainnet",
      kind: "repay",
      amountRaw: repayRaw.toString(),
    },
  });
  await recordAction({
    userId: user.id,
    tool: "repay",
    txId,
    status: "success",
    params: opts,
    result: { full, repaidUsdcx: Number(repayRaw) / 1e6 },
  });

  const after = await getZestPosition(signer.address, "mainnet").catch(
    () => pos,
  );
  return {
    ok: true,
    txId,
    repaidUsdcx: Number(repayRaw) / 1e6,
    full,
    position: serializeZestPosition(after),
    instructions:
      after.debtUsdcxRaw === BigInt(0)
        ? "Debt is 0. Call withdraw_collateral to unlock sBTC back to the agent, then withdraw if you want it in Leather."
        : "Call get_borrow_status to confirm remaining debt. Repeat repay or use full=true to close it.",
  };
}

export async function withdrawZestCollateral(opts: {
  privyUserId: string;
  collateralSats?: number;
}): Promise<
  | NeedsDeposit
  | {
      ok: true;
      txId: string;
      collateralSats: string;
      position: ReturnType<typeof serializeZestPosition>;
      instructions: string;
    }
> {
  if (!zestEnabled()) {
    throw new ServiceError(400, "Zest borrow is mainnet-only");
  }
  const user = await ensureAgent(opts.privyUserId);
  const signer = agentSignerFromUser(user);
  const pos = await getZestPosition(signer.address, "mainnet");
  if (pos.collateralSats <= BigInt(0)) {
    throw new ServiceError(400, "No Zest sBTC collateral to withdraw");
  }
  if (pos.debtUsdcxRaw > BigInt(0)) {
    throw new ServiceError(
      400,
      `Repay the ${Number(pos.debtUsdcxRaw) / 1e6} USDCx Zest debt before unlocking sBTC. Call repay with full=true.`,
    );
  }

  const amount =
    opts.collateralSats != null && Number.isFinite(opts.collateralSats)
      ? BigInt(Math.max(0, Math.floor(opts.collateralSats)))
      : pos.collateralSats;
  if (amount <= BigInt(0)) {
    throw new ServiceError(400, "collateralSats must be positive");
  }
  if (amount > pos.collateralSats) {
    throw new ServiceError(
      400,
      `Only ${pos.collateralSats.toString()} sats are locked`,
    );
  }

  const balances = await getStacksBalances(signer.address, "mainnet");
  if (balances.stx < 0.02) {
    return depositPayload(user, "stx", balances.stx, 0.1);
  }

  const feeds = await fetchPythPriceFeedHexes();
  const remove = buildZestCollateralRemoveTx({
    senderAddress: signer.address,
    amountSats: amount,
    priceFeedHexes: feeds,
  });
  const [{ txId }] = await broadcastContractCalls(signer, [zestCall(remove)]);
  await waitZestTx(txId);
  await prisma.stacksZestTx.create({
    data: {
      userId: user.id,
      stacksAddress: signer.address,
      txId,
      network: "mainnet",
      kind: "collateral_remove",
      amountRaw: amount.toString(),
    },
  });
  await recordAction({
    userId: user.id,
    tool: "withdraw_collateral",
    txId,
    status: "success",
    params: opts,
    result: { collateralSats: amount.toString() },
  });

  const after = await getZestPosition(signer.address, "mainnet").catch(
    () => pos,
  );
  return {
    ok: true,
    txId,
    collateralSats: amount.toString(),
    position: serializeZestPosition(after),
    instructions:
      "sBTC is back on the agent. Use withdraw with token=sbtc to send it to Leather if needed.",
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
