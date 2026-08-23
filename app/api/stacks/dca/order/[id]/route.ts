import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import {
  executionTxId,
  fetchGroupOrder,
  mapGroupStatus,
  mapOrderStatus,
  orderBroadcastErrors,
  groupNextExecution,
} from "@/services/stacks/bitflow-keeper";
import { advanceInflightForUser } from "@/services/stacks/dca-executor";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/stacks/dca/order/[id]
 * Returns local order + syncs Bitflow group/execution status when a groupId exists.
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({
    where: { privyUserId: privyUser.id },
  });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let order = await prisma.stacksDcaOrder.findFirst({
    where: { id, userId: user.id },
    include: { executions: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!order.groupId) {
    await advanceInflightForUser(user.id);
    order = await prisma.stacksDcaOrder.findFirst({
      where: { id, userId: user.id },
      include: { executions: { orderBy: { createdAt: "asc" } } },
    });
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  if (order.groupId && order.status !== "cancelled") {
    try {
      const { group, orders } = await fetchGroupOrder(order.groupId);
      const status = mapGroupStatus({
        remainingOrders: group.remainingOrders,
        numberOfOrders: order.numberOfOrders,
      });
      order = await prisma.stacksDcaOrder.update({
        where: { id: order.id },
        data: {
          status,
          remainingOrders:
            group.remainingOrders != null
              ? Number(group.remainingOrders)
              : order.remainingOrders,
          nextExecutionAt: groupNextExecution(group),
        },
        include: { executions: { orderBy: { createdAt: "asc" } } },
      });

      let anyRetrying = false;
      let broadcastFailCount = 0;
      for (const ko of orders) {
        const txId = executionTxId(ko);
        const execStatus = mapOrderStatus(String(ko.orderStatus));
        if (execStatus === "retrying") anyRetrying = true;
        const be = orderBroadcastErrors(ko);
        if (be?.actionCount) {
          broadcastFailCount = Math.max(broadcastFailCount, be.actionCount);
        }
        await prisma.stacksDcaExecution.upsert({
          where: {
            orderId_bitflowOrderId: {
              orderId: order.id,
              bitflowOrderId: ko.orderId,
            },
          },
          create: {
            orderId: order.id,
            bitflowOrderId: ko.orderId,
            txId,
            amountInRaw: ko.actionAmount ?? null,
            status: execStatus,
            executedAt: execStatus === "success" ? new Date() : null,
          },
          update: {
            txId: txId ?? undefined,
            status: execStatus,
            executedAt:
              execStatus === "success" ? new Date() : undefined,
          },
        });
      }

      // Elevate local plan status when Bitflow is stuck retrying broadcasts.
      const elevated =
        anyRetrying && status === "active" ? "retrying" : status;
      order = await prisma.stacksDcaOrder.update({
        where: { id: order.id },
        data: { status: elevated },
        include: { executions: { orderBy: { createdAt: "asc" } } },
      });

      return NextResponse.json({
        order: {
          id: order.id,
          stacksAddress: order.stacksAddress,
          network: order.network,
          groupId: order.groupId,
          keeperContractId: order.keeperContractId,
          amountPerOrderRaw: order.amountPerOrderRaw,
          numberOfOrders: order.numberOfOrders,
          executionFrequency: order.executionFrequency,
          fundingAmountRaw: order.fundingAmountRaw,
          fundingTxId: order.fundingTxId,
          quotedOutRaw: order.quotedOutRaw,
          status: order.status,
          nextExecutionAt: order.nextExecutionAt?.toISOString() ?? null,
          remainingOrders: order.remainingOrders,
          lastError: order.lastError ?? null,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
        },
        executions: order.executions.map((e) => ({
          id: e.id,
          bitflowOrderId: e.bitflowOrderId,
          txId: e.txId,
          payoutTxId: e.payoutTxId,
          amountInRaw: e.amountInRaw,
          amountOutRaw: e.amountOutRaw,
          status: e.status,
          executedAt: e.executedAt?.toISOString() ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
        bitflow: {
          broadcastFailCount,
          anyRetrying,
        },
      });
    } catch (e) {
      // Return local state if Bitflow sync fails.
      if (!(e instanceof ServiceError)) {
        console.warn("DCA sync failed", e);
      }
    }
  }

  return NextResponse.json({
    order: {
      id: order.id,
      stacksAddress: order.stacksAddress,
      network: order.network,
      groupId: order.groupId,
      keeperContractId: order.keeperContractId,
      amountPerOrderRaw: order.amountPerOrderRaw,
      numberOfOrders: order.numberOfOrders,
      executionFrequency: order.executionFrequency,
      fundingAmountRaw: order.fundingAmountRaw,
      fundingTxId: order.fundingTxId,
      quotedOutRaw: order.quotedOutRaw,
      status: order.status,
      nextExecutionAt: order.nextExecutionAt?.toISOString() ?? null,
      remainingOrders: order.remainingOrders,
      lastError: order.lastError ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    },
    executions: order.executions.map((e) => ({
      id: e.id,
      bitflowOrderId: e.bitflowOrderId,
      txId: e.txId,
      payoutTxId: e.payoutTxId,
      amountInRaw: e.amountInRaw,
      amountOutRaw: e.amountOutRaw,
      status: e.status,
      executedAt: e.executedAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
