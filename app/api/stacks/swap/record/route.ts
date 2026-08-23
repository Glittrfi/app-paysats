import { prisma } from "@/lib/prisma";
import {
  sbtcToken,
  stacksNetworkId,
  usdcxToken,
} from "@/lib/stacks/config";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import { fetchHiroTx } from "@/services/stacks/funding-tx";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function normalizeTxId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  const id = t.startsWith("0x") ? t : `0x${t}`;
  return /^0x[0-9a-f]{64}$/.test(id) ? id : null;
}

/**
 * POST /api/stacks/swap/record
 *
 * Persists a broadcast USDCx -> sBTC swap (status: pending). Body:
 * `{ txId, stacksAddress, amountInRaw, amountOutRaw? }`.
 */
export async function POST(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    txId?: string;
    stacksAddress?: string;
    amountInRaw?: string;
    amountOutRaw?: string;
  };

  const txId = normalizeTxId(body.txId);
  if (!txId) {
    return NextResponse.json({ error: "Invalid `txId`" }, { status: 400 });
  }
  if (
    typeof body.stacksAddress !== "string" ||
    !/^S[PMTN][0-9A-Z]{28,41}$/.test(body.stacksAddress.trim())
  ) {
    return NextResponse.json(
      { error: "Invalid `stacksAddress`" },
      { status: 400 },
    );
  }
  if (typeof body.amountInRaw !== "string" || !/^\d+$/.test(body.amountInRaw)) {
    return NextResponse.json(
      { error: "Invalid `amountInRaw`" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { privyUserId: privyUser.id },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const network = stacksNetworkId();
  const row = await prisma.stacksSwap.upsert({
    where: { txId },
    create: {
      userId: user.id,
      stacksAddress: body.stacksAddress.trim(),
      txId,
      network,
      tokenIn: usdcxToken(network).contract,
      tokenOut: sbtcToken(network).contract,
      amountInRaw: body.amountInRaw,
      amountOutRaw:
        typeof body.amountOutRaw === "string" && /^\d+$/.test(body.amountOutRaw)
          ? body.amountOutRaw
          : null,
    },
    update: {},
  });

  return NextResponse.json({ ok: true, id: row.id, txId: row.txId });
}

/**
 * PATCH /api/stacks/swap/record
 *
 * Updates a recorded swap once its Stacks tx anchors. Body:
 * `{ txId, status: 'success' | 'failed' }`.
 */
export async function PATCH(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    txId?: string;
    status?: string;
  };
  const txId = normalizeTxId(body.txId);
  if (!txId || (body.status !== "success" && body.status !== "failed")) {
    return NextResponse.json(
      { error: "Invalid `txId` or `status`" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { privyUserId: privyUser.id },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const result = await prisma.stacksSwap.updateMany({
    where: { txId, userId: user.id },
    data: {
      status: body.status,
      confirmedAt: body.status === "success" ? new Date() : null,
    },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Swap not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/stacks/swap/record
 *
 * Recent swap records for the caller (newest first).
 */
export async function GET(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { privyUserId: privyUser.id },
  });
  if (!user) {
    return NextResponse.json({ swaps: [] });
  }

  let swaps = await prisma.stacksSwap.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const stale = swaps.filter((s) => s.status === "pending" || s.status === "failed");
  for (const s of stale.slice(0, 5)) {
    try {
      const tx = await fetchHiroTx(s.txId);
      if (tx.tx_status === "success" && s.status !== "success") {
        await prisma.stacksSwap.update({
          where: { id: s.id },
          data: { status: "success", confirmedAt: new Date() },
        });
      } else if (
        s.status === "pending" &&
        tx.tx_status &&
        tx.tx_status !== "pending" &&
        tx.tx_status !== "not_found"
      ) {
        await prisma.stacksSwap.update({
          where: { id: s.id },
          data: { status: tx.tx_status === "success" ? "success" : "failed" },
        });
      }
    } catch {
      // Keep stored status if Hiro is unavailable.
    }
  }

  swaps = await prisma.stacksSwap.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    swaps: swaps.map((s) => ({
      id: s.id,
      txId: s.txId,
      network: s.network,
      stacksAddress: s.stacksAddress,
      tokenIn: s.tokenIn,
      tokenOut: s.tokenOut,
      amountInRaw: s.amountInRaw,
      amountOutRaw: s.amountOutRaw,
      status: s.status,
      confirmedAt: s.confirmedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}
