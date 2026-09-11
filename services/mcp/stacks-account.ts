import { prisma } from "@/lib/prisma";
import { stacksExplorerTxUrl } from "@/lib/stacks/config";
import { ServiceError } from "@/services/errors";
import { getAgentWalletView } from "@/services/stacks/agent-wallet";
import {
  getZestPosition,
  serializeZestPosition,
} from "@/services/stacks/zest";
import type { User as DbUser } from "@prisma/client";

export async function stacksAccountPayload(user: DbUser) {
  const wallet = await getAgentWalletView(user);
  if (!wallet.agentReady) return wallet;

  const [orders, zest, actions] = await Promise.all([
    prisma.stacksDcaOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    getZestPosition(wallet.agentAddress).catch((e) => {
      if (e instanceof ServiceError && e.status === 400) return null;
      throw e;
    }),
    prisma.stacksAgentAction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return {
    ...wallet,
    dcaOrders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      amountPerOrderUsdcx: Number(o.amountPerOrderRaw) / 1e6,
      numberOfOrders: o.numberOfOrders,
      remainingOrders: o.remainingOrders,
      executionFrequency: o.executionFrequency,
      fundingTxId: o.fundingTxId,
      nextExecutionAt: o.nextExecutionAt?.toISOString() ?? null,
    })),
    zest: zest ? serializeZestPosition(zest) : null,
    recentAgentActions: actions.map((a) => ({
      tool: a.tool,
      txId: a.txId,
      explorerUrl: a.txId ? stacksExplorerTxUrl(a.txId) : null,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function sbtcDcaHistory(userId: string) {
  const executions = await prisma.stacksDcaExecution.findMany({
    where: { order: { userId } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { order: { select: { id: true, amountPerOrderRaw: true } } },
  });
  return {
    count: executions.length,
    executions: executions.map((e) => ({
      orderId: e.orderId,
      swapTxId: e.txId,
      payoutTxId: e.payoutTxId,
      usdcxSpent: e.amountInRaw ? Number(e.amountInRaw) / 1e6 : null,
      satsReceived: e.amountOutRaw ? Number(e.amountOutRaw) : null,
      status: e.status,
      executedAt: e.executedAt?.toISOString() ?? null,
      explorerUrl: e.payoutTxId
        ? stacksExplorerTxUrl(e.payoutTxId)
        : e.txId
          ? stacksExplorerTxUrl(e.txId)
          : null,
    })),
  };
}
