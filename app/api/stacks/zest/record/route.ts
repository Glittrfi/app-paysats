import { prisma } from "@/lib/prisma";
import { stacksNetworkId } from "@/lib/stacks/config";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import { fetchHiroTx } from "@/services/stacks/funding-tx";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const KINDS = [
  "collateral_add",
  "borrow",
  "repay",
  "collateral_remove",
] as const;
type ZestKind = (typeof KINDS)[number];

function normalizeTxId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  const id = t.startsWith("0x") ? t : `0x${t}`;
  return /^0x[0-9a-f]{64}$/.test(id) ? id : null;
}

function isKind(v: unknown): v is ZestKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

/**
 * POST /api/stacks/zest/record
 *
 * Persist a broadcast Zest tx. Body:
 * `{ txId, stacksAddress, kind, amountRaw }`.
 */
export async function POST(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    txId?: string;
    stacksAddress?: string;
    kind?: string;
    amountRaw?: string;
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
  if (!isKind(body.kind)) {
    return NextResponse.json({ error: "Invalid `kind`" }, { status: 400 });
  }
  if (typeof body.amountRaw !== "string" || !/^\d+$/.test(body.amountRaw)) {
    return NextResponse.json({ error: "Invalid `amountRaw`" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { privyUserId: privyUser.id },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const row = await prisma.stacksZestTx.upsert({
    where: { txId },
    create: {
      userId: user.id,
      stacksAddress: body.stacksAddress.trim(),
      txId,
      network: stacksNetworkId(),
      kind: body.kind,
      amountRaw: body.amountRaw,
    },
    update: {},
  });

  return NextResponse.json({ ok: true, id: row.id, txId: row.txId });
}

/**
 * PATCH /api/stacks/zest/record
 * `{ txId, status: 'success' | 'failed' }`
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

  const result = await prisma.stacksZestTx.updateMany({
    where: { txId, userId: user.id },
    data: {
      status: body.status,
      confirmedAt: body.status === "success" ? new Date() : null,
    },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Tx not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/stacks/zest/record
 *
 * Recent Zest txs for the caller (newest first).
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
    return NextResponse.json({ txs: [] });
  }

  let txs = await prisma.stacksZestTx.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const stale = txs.filter(
    (s) => s.status === "pending" || s.status === "failed",
  );
  for (const s of stale.slice(0, 5)) {
    try {
      const tx = await fetchHiroTx(s.txId);
      if (tx.tx_status === "success" && s.status !== "success") {
        await prisma.stacksZestTx.update({
          where: { id: s.id },
          data: { status: "success", confirmedAt: new Date() },
        });
      } else if (
        s.status === "pending" &&
        tx.tx_status &&
        tx.tx_status !== "pending" &&
        tx.tx_status !== "not_found"
      ) {
        await prisma.stacksZestTx.update({
          where: { id: s.id },
          data: { status: tx.tx_status === "success" ? "success" : "failed" },
        });
      }
    } catch {
      // Keep stored status if Hiro is unavailable.
    }
  }

  txs = await prisma.stacksZestTx.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    txs: txs.map((s) => ({
      id: s.id,
      txId: s.txId,
      network: s.network,
      stacksAddress: s.stacksAddress,
      kind: s.kind,
      amountRaw: s.amountRaw,
      status: s.status,
      confirmedAt: s.confirmedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}
