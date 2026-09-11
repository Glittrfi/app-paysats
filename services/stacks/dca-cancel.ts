import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/services/errors";
import {
  cancelDcaGroupOrder,
  type KeeperAuth,
} from "@/services/stacks/bitflow-keeper";
import { refundableRaw } from "@/services/stacks/dca-executor";
import { refundUsdcx } from "@/services/stacks/node-keeper";
import type { StacksDcaOrder } from "@prisma/client";

export type CancelDcaResult = {
  order: { id: string; status: string };
  refundTxId: string | null;
};

export async function cancelStacksDcaOrder(opts: {
  userId: string;
  orderId: string;
  auth?: KeeperAuth;
}): Promise<CancelDcaResult> {
  const order = await prisma.stacksDcaOrder.findFirst({
    where: { id: opts.orderId, userId: opts.userId },
  });
  if (!order) {
    throw new ServiceError(404, "DCA order not found");
  }
  if (order.status === "cancelled" || order.status === "completed") {
    return { order: { id: order.id, status: order.status }, refundTxId: null };
  }

  if (order.groupId) {
    if (
      !opts.auth ||
      typeof opts.auth.timestamp !== "number" ||
      typeof opts.auth.signature !== "string" ||
      typeof opts.auth.publicKey !== "string"
    ) {
      throw new ServiceError(
        400,
        "Bitflow keeper authorization is required to cancel this plan",
      );
    }
    await cancelDcaGroupOrder({
      groupId: order.groupId,
      stacksAddress: order.stacksAddress,
      auth: opts.auth,
    });
    const updated = await prisma.stacksDcaOrder.update({
      where: { id: order.id },
      data: { status: "cancelled", remainingOrders: 0, lastError: null },
    });
    return {
      order: { id: updated.id, status: updated.status },
      refundTxId: null,
    };
  }

  return cancelNodeKeeperOrder(order);
}

async function cancelNodeKeeperOrder(
  order: StacksDcaOrder,
): Promise<CancelDcaResult> {
  const inflight = await prisma.stacksDcaExecution.findFirst({
    where: {
      orderId: order.id,
      status: { in: ["pending_swap", "pending_payout"] },
    },
  });

  const amount = refundableRaw(order, Boolean(inflight));
  let refundTxId: string | null = null;
  if (amount > BigInt(0)) {
    const r = await refundUsdcx({
      amountRaw: amount,
      recipient: order.stacksAddress,
    });
    refundTxId = r.txId;
  }

  const updated = await prisma.stacksDcaOrder.update({
    where: { id: order.id },
    data: inflight
      ? {
          status: "cancelling",
          remainingOrders: 1,
          lastError:
            "Cancelled. Waiting for the in-flight buy; leftover USDCx was refunded.",
        }
      : {
          status: "cancelled",
          remainingOrders: 0,
          lastError: null,
          nextExecutionAt: null,
        },
  });

  return {
    order: { id: updated.id, status: updated.status },
    refundTxId,
  };
}
