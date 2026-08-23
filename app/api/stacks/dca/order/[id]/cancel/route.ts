import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import {
  cancelDcaGroupOrder,
  type KeeperAuth,
} from "@/services/stacks/bitflow-keeper";
import { refundableRaw } from "@/services/stacks/dca-executor";
import { refundUsdcx } from "@/services/stacks/node-keeper";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

function isKeeperAuth(v: unknown): v is KeeperAuth {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.timestamp === "number" &&
    typeof a.signature === "string" &&
    typeof a.publicKey === "string"
  );
}

export async function POST(request: NextRequest, ctx: Ctx) {
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

  const order = await prisma.stacksDcaOrder.findFirst({
    where: { id, userId: user.id },
  });
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (order.status === "cancelled" || order.status === "completed") {
    return NextResponse.json({
      ok: true,
      order: { id: order.id, status: order.status },
    });
  }

  const body = (await request.json().catch(() => ({}))) as {
    auth?: unknown;
  };

  try {
    // Legacy Bitflow Keepers plans still need a signed cancel.
    if (order.groupId) {
      if (!isKeeperAuth(body.auth)) {
        return NextResponse.json(
          { error: "Bitflow keeper authorization is required to cancel this plan" },
          { status: 400 },
        );
      }
      await cancelDcaGroupOrder({
        groupId: order.groupId,
        stacksAddress: order.stacksAddress,
        auth: body.auth,
      });
      const updated = await prisma.stacksDcaOrder.update({
        where: { id: order.id },
        data: { status: "cancelled", remainingOrders: 0, lastError: null },
      });
      return NextResponse.json({
        ok: true,
        order: { id: updated.id, status: updated.status },
      });
    }

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

    return NextResponse.json({
      ok: true,
      order: { id: updated.id, status: updated.status },
      refundTxId,
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cancel failed" },
      { status: 502 },
    );
  }
}
