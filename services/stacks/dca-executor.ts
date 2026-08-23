import { prisma } from "@/lib/prisma";
import { getStacksKeeperAddress, usdcxToken } from "@/lib/stacks/config";
import { getStacksBalances } from "@/services/stacks/balances";
import { ServiceError } from "@/services/errors";
import { fetchHiroTx } from "@/services/stacks/funding-tx";
import {
  broadcastUsdcxToSbtcSwap,
  payoutSbtc,
  sbtcInflowFromSwapTx,
} from "@/services/stacks/node-keeper";
import type { Prisma, StacksDcaExecution, StacksDcaOrder } from "@prisma/client";

const MAX_DUE_ORDERS = 3;
/** Poll Hiro this often while a swap or payout is in flight. */
export const INFLIGHT_POLL_MS = 45_000;
/** Longest idle sleep so a missed create-kick cannot stall forever. */
export const MAX_IDLE_MS = 5 * 60_000;
const MIN_SLEEP_MS = 2_000;

export type DcaExecuteSummary = {
  processed: number;
  advanced: number;
  started: number;
  failed: number;
  skipped: number;
  inflight: boolean;
  nextExecutionAt: string | null;
  nextWakeAt: string;
  /** True when another execute tick is already running in this process. */
  busy?: boolean;
  reason?: string;
  results: Array<{
    orderId: string;
    status: string;
    error?: string;
    swapTxId?: string;
    payoutTxId?: string;
  }>;
};

export function computeNextWakeAt(
  inflight: boolean,
  nextExecutionAt: Date | null,
  now = new Date(),
): Date {
  if (inflight) return new Date(now.getTime() + INFLIGHT_POLL_MS);
  if (nextExecutionAt) {
    const wait = Math.min(
      Math.max(nextExecutionAt.getTime() - now.getTime(), MIN_SLEEP_MS),
      MAX_IDLE_MS,
    );
    return new Date(now.getTime() + wait);
  }
  return new Date(now.getTime() + MAX_IDLE_MS);
}

function withWake(
  partial: Omit<
    DcaExecuteSummary,
    "inflight" | "nextExecutionAt" | "nextWakeAt"
  > & {
    inflight: boolean;
    nextExecutionAt: Date | null;
  },
): DcaExecuteSummary {
  const now = new Date();
  return {
    ...partial,
    nextExecutionAt: partial.nextExecutionAt?.toISOString() ?? null,
    nextWakeAt: computeNextWakeAt(
      partial.inflight,
      partial.nextExecutionAt,
      now,
    ).toISOString(),
  };
}

function sliceKey(orderId: string, sliceIndex: number) {
  return `${orderId}:slice-${sliceIndex}`;
}

function reservedRaw(order: Pick<StacksDcaOrder, "remainingOrders" | "amountPerOrderRaw">) {
  const rem = BigInt(order.remainingOrders ?? 0);
  return rem * BigInt(order.amountPerOrderRaw);
}

async function reservedByOtherActiveOrders(exceptOrderId: string): Promise<bigint> {
  const others = await prisma.stacksDcaOrder.findMany({
    where: {
      id: { not: exceptOrderId },
      status: { in: ["active", "executing", "cancelling"] },
    },
    select: { remainingOrders: true, amountPerOrderRaw: true },
  });
  return others.reduce((sum, o) => sum + reservedRaw(o), BigInt(0));
}

async function markOrderError(orderId: string, status: string, lastError: string) {
  await prisma.stacksDcaOrder.update({
    where: { id: orderId },
    data: { status, lastError: lastError.slice(0, 500) },
  });
}

async function advancePending(exec: StacksDcaExecution): Promise<{
  status: string;
  error?: string;
  swapTxId?: string;
  payoutTxId?: string;
}> {
  const order = await prisma.stacksDcaOrder.findUniqueOrThrow({
    where: { id: exec.orderId },
  });

  if (exec.status === "failed" && exec.txId) {
    const tx = await fetchHiroTx(exec.txId);
    if (tx.tx_status === "success") {
      exec = { ...exec, status: "pending_swap" };
    } else {
      return { status: "failed", swapTxId: exec.txId };
    }
  }

  if (exec.status === "pending_swap") {
    if (!exec.txId) {
      // Worker is still broadcasting. Never mark failed from a status poll.
      return { status: "pending_swap" };
    }
    const tx = await fetchHiroTx(exec.txId);
    if (tx.tx_status === "not_found" || tx.tx_status === "pending") {
      return { status: "pending_swap", swapTxId: exec.txId };
    }
    if (tx.tx_status !== "success") {
      await prisma.stacksDcaExecution.update({
        where: { id: exec.id },
        data: { status: "failed" },
      });
      await markOrderError(
        order.id,
        "active",
        `Swap failed: ${tx.tx_status ?? "unknown"}`,
      );
      return { status: "failed", error: `Swap failed: ${tx.tx_status}`, swapTxId: exec.txId };
    }

    const sats = await sbtcInflowFromSwapTx(exec.txId);
    await prisma.stacksDcaExecution.update({
      where: { id: exec.id },
      data: {
        status: "pending_payout",
        amountOutRaw: sats.toString(),
      },
    });
    return advancePending({
      ...exec,
      status: "pending_payout",
      amountOutRaw: sats.toString(),
    });
  }

  if (exec.status === "pending_payout") {
    if (exec.payoutTxId) {
      const tx = await fetchHiroTx(exec.payoutTxId);
      if (tx.tx_status === "not_found" || tx.tx_status === "pending") {
        return {
          status: "pending_payout",
          swapTxId: exec.txId ?? undefined,
          payoutTxId: exec.payoutTxId,
        };
      }
      if (tx.tx_status !== "success") {
        await prisma.stacksDcaExecution.update({
          where: { id: exec.id },
          data: { payoutTxId: null },
        });
        await markOrderError(
          order.id,
          "executing",
          `Payout failed (${tx.tx_status}); will retry`,
        );
        return {
          status: "pending_payout",
          error: `Payout failed: ${tx.tx_status}`,
          swapTxId: exec.txId ?? undefined,
        };
      }
      return completeSlice(order, exec);
    }

    const sats = BigInt(exec.amountOutRaw ?? "0");
    if (sats <= BigInt(0)) {
      await markOrderError(order.id, "executing", "No sBTC amount to pay out");
      return { status: "pending_payout", error: "No sBTC amount to pay out" };
    }
    try {
      const { txId } = await payoutSbtc({
        amountSats: sats,
        recipient: order.stacksAddress,
      });
      await prisma.stacksDcaExecution.update({
        where: { id: exec.id },
        data: { payoutTxId: txId },
      });
      return {
        status: "pending_payout",
        swapTxId: exec.txId ?? undefined,
        payoutTxId: txId,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Payout broadcast failed";
      await markOrderError(order.id, "executing", msg);
      return { status: "pending_payout", error: msg, swapTxId: exec.txId ?? undefined };
    }
  }

  return { status: exec.status };
}

async function completeSlice(
  order: StacksDcaOrder,
  exec: StacksDcaExecution,
): Promise<{
  status: string;
  swapTxId?: string;
  payoutTxId?: string;
}> {
  const remaining = (order.remainingOrders ?? 0) - 1;
  const completed = remaining <= 0;
  const cancelling = order.status === "cancelling";
  await prisma.$transaction([
    prisma.stacksDcaExecution.update({
      where: { id: exec.id },
      data: { status: "success", executedAt: new Date() },
    }),
    prisma.stacksDcaOrder.update({
      where: { id: order.id },
      data: {
        status: cancelling ? "cancelled" : completed ? "completed" : "active",
        remainingOrders: cancelling ? 0 : remaining,
        lastError: null,
        nextExecutionAt:
          cancelling || completed
            ? null
            : new Date(Date.now() + order.executionFrequency * 1000),
      },
    }),
  ]);
  return {
    status: "success",
    swapTxId: exec.txId ?? undefined,
    payoutTxId: exec.payoutTxId ?? undefined,
  };
}

async function startSlice(order: StacksDcaOrder): Promise<{
  status: string;
  error?: string;
  swapTxId?: string;
}> {
  const remaining = order.remainingOrders ?? 0;
  if (remaining <= 0) {
    return { status: "skipped", error: "No remaining orders" };
  }

  const locked = await prisma.stacksDcaOrder.updateMany({
    where: { id: order.id, status: "active" },
    data: { status: "executing", lastError: null },
  });
  if (locked.count === 0) {
    return { status: "skipped", error: "Could not acquire lock" };
  }

  const keeper = getStacksKeeperAddress();
  const bal = await getStacksBalances(keeper, "mainnet");
  const others = await reservedByOtherActiveOrders(order.id);
  const available = BigInt(bal.usdcxRaw) - others;
  const need = BigInt(order.amountPerOrderRaw);
  if (available < need) {
    await markOrderError(
      order.id,
      "active",
      `Keeper USDCx short for this slice (have ${available.toString()}, need ${need.toString()})`,
    );
    return { status: "skipped", error: "Insufficient reserved USDCx on keeper" };
  }

  const sliceIndex = order.numberOfOrders - remaining + 1;
  const sliceId = sliceKey(order.id, sliceIndex);
  const usdcx = usdcxToken("mainnet");
  const amountHuman = Number(order.amountPerOrderRaw) / 10 ** usdcx.decimals;

  try {
    const { txId } = await broadcastUsdcxToSbtcSwap(amountHuman);
    await prisma.stacksDcaExecution.upsert({
      where: {
        orderId_bitflowOrderId: { orderId: order.id, bitflowOrderId: sliceId },
      },
      create: {
        orderId: order.id,
        bitflowOrderId: sliceId,
        amountInRaw: order.amountPerOrderRaw,
        txId,
        status: "pending_swap",
      },
      update: {
        txId,
        status: "pending_swap",
        amountInRaw: order.amountPerOrderRaw,
      },
    });
    return { status: "pending_swap", swapTxId: txId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Swap broadcast failed";
    await markOrderError(order.id, "active", msg);
    return { status: "failed", error: msg };
  }
}

const RECOVERABLE: Prisma.StacksDcaExecutionWhereInput = {
  OR: [
    { status: { in: ["pending_swap", "pending_payout"] } },
    { status: "failed", txId: { not: null }, payoutTxId: null },
  ],
};

/** Confirm in-flight swaps/payouts for this user's plans. Does not start new slices. */
export async function advanceInflightForUser(userId: string): Promise<void> {
  const inflight = await prisma.stacksDcaExecution.findMany({
    where: {
      AND: [{ order: { userId } }, RECOVERABLE],
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  for (const exec of inflight) {
    try {
      await advancePending(exec);
    } catch {
      // Next poll retries; do not fail the status read.
    }
  }
}

const DUE_ORDER: Prisma.StacksDcaOrderWhereInput = {
  status: "active",
  remainingOrders: { gt: 0 },
};

async function soonestFutureExecutionAt(now: Date): Promise<Date | null> {
  const row = await prisma.stacksDcaOrder.findFirst({
    where: {
      ...DUE_ORDER,
      nextExecutionAt: { gt: now },
    },
    orderBy: { nextExecutionAt: "asc" },
    select: { nextExecutionAt: true },
  });
  return row?.nextExecutionAt ?? null;
}

async function workPending(): Promise<{
  inflightRows: number;
  dueRows: number;
  executing: number;
}> {
  const now = new Date();
  const [inflightRows, dueRows, executing] = await Promise.all([
    prisma.stacksDcaExecution.count({ where: RECOVERABLE }),
    prisma.stacksDcaOrder.count({
      where: {
        ...DUE_ORDER,
        OR: [{ nextExecutionAt: null }, { nextExecutionAt: { lte: now } }],
      },
    }),
    prisma.stacksDcaOrder.count({
      where: { status: { in: ["executing", "cancelling"] } },
    }),
  ]);
  return { inflightRows, dueRows, executing };
}

async function attachWake(
  summary: Omit<DcaExecuteSummary, "inflight" | "nextExecutionAt" | "nextWakeAt">,
): Promise<DcaExecuteSummary> {
  const now = new Date();
  const pending = await workPending();
  const inflight =
    pending.inflightRows > 0 ||
    pending.dueRows > 0 ||
    pending.executing > 0 ||
    summary.started > 0;
  const nextExecutionAt = inflight ? null : await soonestFutureExecutionAt(now);
  return withWake({ ...summary, inflight, nextExecutionAt });
}

let executeRunning = false;

/**
 * Advance in-flight slices, then start due swaps. Never waits for Stacks finality.
 * Overlapping calls in this process return immediately with `busy: true`.
 */
export async function executeDueDcaOrders(): Promise<DcaExecuteSummary> {
  if (executeRunning) {
    return withWake({
      processed: 0,
      advanced: 0,
      started: 0,
      failed: 0,
      skipped: 0,
      results: [],
      inflight: true,
      nextExecutionAt: null,
      busy: true,
      reason: "busy",
    });
  }
  executeRunning = true;
  try {
    return await executeDueDcaOrdersInner();
  } finally {
    executeRunning = false;
  }
}

/** Fire-and-forget after a new order is stored so the first slice does not wait for idle sleep. */
export function kickExecuteDueDcaOrders(): void {
  void executeDueDcaOrders().catch((e) => {
    console.error("DCA kick after order create failed:", e);
  });
}

async function executeDueDcaOrdersInner(): Promise<DcaExecuteSummary> {
  const empty = {
    processed: 0,
    advanced: 0,
    started: 0,
    failed: 0,
    skipped: 0,
    results: [] as DcaExecuteSummary["results"],
  };

  const pending = await workPending();
  if (
    pending.inflightRows === 0 &&
    pending.dueRows === 0 &&
    pending.executing === 0
  ) {
    const nextExecutionAt = await soonestFutureExecutionAt(new Date());
    return withWake({ ...empty, inflight: false, nextExecutionAt });
  }

  const summary = { ...empty };

  const inflight = await prisma.stacksDcaExecution.findMany({
    where: RECOVERABLE,
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  for (const exec of inflight) {
    summary.processed += 1;
    try {
      const r = await advancePending(exec);
      if (r.status === "success") summary.advanced += 1;
      else if (r.status === "failed") summary.failed += 1;
      else summary.advanced += 1;
      summary.results.push({ orderId: exec.orderId, ...r });
    } catch (e) {
      const msg = e instanceof ServiceError ? e.message : e instanceof Error ? e.message : "Advance failed";
      summary.failed += 1;
      summary.results.push({ orderId: exec.orderId, status: "failed", error: msg });
    }
  }

  const now = new Date();
  const due = await prisma.stacksDcaOrder.findMany({
    where: {
      ...DUE_ORDER,
      OR: [{ nextExecutionAt: null }, { nextExecutionAt: { lte: now } }],
    },
    orderBy: { nextExecutionAt: "asc" },
    take: MAX_DUE_ORDERS,
  });

  for (const order of due) {
    const slicePending = await prisma.stacksDcaExecution.findFirst({
      where: {
        orderId: order.id,
        status: { in: ["pending_swap", "pending_payout"] },
      },
    });
    if (slicePending) {
      summary.skipped += 1;
      summary.results.push({
        orderId: order.id,
        status: "skipped",
        error: "Slice already in flight",
      });
      continue;
    }
    summary.processed += 1;
    const r = await startSlice(order);
    if (r.status === "pending_swap") summary.started += 1;
    else if (r.status === "failed") summary.failed += 1;
    else summary.skipped += 1;
    summary.results.push({ orderId: order.id, ...r });
  }

  return attachWake(summary);
}

/** USDCx to refund on cancel: remaining slices that are not mid-swap. */
export function refundableRaw(order: StacksDcaOrder, inflight: boolean): bigint {
  const rem = BigInt(order.remainingOrders ?? 0);
  const skip = inflight ? BigInt(1) : BigInt(0);
  const n = rem > skip ? rem - skip : BigInt(0);
  return n * BigInt(order.amountPerOrderRaw);
}
