import { prisma } from "@/lib/prisma";
import {
  getStacksKeeperAddress,
  stacksNetworkId,
  swapEnabled,
  usdcxToken,
} from "@/lib/stacks/config";
import { ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import { advanceInflightForUser } from "@/services/stacks/dca-executor";
import { verifyUsdcxFundingTx } from "@/services/stacks/funding-tx";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isStacksAddress(v: unknown): v is string {
  return typeof v === "string" && /^S[PMTN][0-9A-Z]{28,41}$/.test(v.trim());
}

function normalizeTxId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  const id = t.startsWith("0x") ? t : `0x${t}`;
  return /^0x[0-9a-f]{64}$/.test(id) ? id : null;
}

function serializeOrder(o: {
  id: string;
  stacksAddress: string;
  network: string;
  groupId: string | null;
  keeperContractId: string;
  amountPerOrderRaw: string;
  numberOfOrders: number;
  executionFrequency: number;
  fundingAmountRaw: string;
  fundingTxId: string | null;
  quotedOutRaw: string | null;
  status: string;
  nextExecutionAt: Date | null;
  remainingOrders: number | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: o.id,
    stacksAddress: o.stacksAddress,
    network: o.network,
    groupId: o.groupId,
    keeperContractId: o.keeperContractId,
    amountPerOrderRaw: o.amountPerOrderRaw,
    numberOfOrders: o.numberOfOrders,
    executionFrequency: o.executionFrequency,
    fundingAmountRaw: o.fundingAmountRaw,
    fundingTxId: o.fundingTxId,
    quotedOutRaw: o.quotedOutRaw,
    status: o.status,
    nextExecutionAt: o.nextExecutionAt?.toISOString() ?? null,
    remainingOrders: o.remainingOrders,
    lastError: o.lastError ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { privyUserId: privyUser.id },
  });
  if (!user) {
    return NextResponse.json({ orders: [] });
  }

  await advanceInflightForUser(user.id);

  const orders = await prisma.stacksDcaOrder.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ orders: orders.map(serializeOrder) });
}

/**
 * POST /api/stacks/dca/order
 * After the user transfers prepaid USDCx to the PaySats keeper address.
 * Body: { stacksAddress, amountPerOrder, numberOfOrders, executionFrequency, fundingTxId, quotedOutRaw? }
 */
export async function POST(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!swapEnabled()) {
    return NextResponse.json(
      { error: "Stacks DCA is mainnet-only" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    stacksAddress?: string;
    amountPerOrder?: number;
    numberOfOrders?: number;
    executionFrequency?: number;
    fundingTxId?: string;
    quotedOutRaw?: string;
  };

  if (!isStacksAddress(body.stacksAddress)) {
    return NextResponse.json(
      { error: "Invalid `stacksAddress`" },
      { status: 400 },
    );
  }
  const fundingTxId = normalizeTxId(body.fundingTxId);
  if (!fundingTxId) {
    return NextResponse.json(
      { error: "Invalid `fundingTxId`" },
      { status: 400 },
    );
  }

  const amountPerOrder = Number(body.amountPerOrder);
  const numberOfOrders = Number(body.numberOfOrders);
  const executionFrequency = Number(body.executionFrequency);
  if (!Number.isFinite(amountPerOrder) || amountPerOrder <= 0) {
    return NextResponse.json(
      { error: "Invalid `amountPerOrder`" },
      { status: 400 },
    );
  }
  if (
    !Number.isInteger(numberOfOrders) ||
    numberOfOrders < 2 ||
    numberOfOrders > 52
  ) {
    return NextResponse.json(
      { error: "`numberOfOrders` must be 2–52" },
      { status: 400 },
    );
  }
  if (!Number.isInteger(executionFrequency) || executionFrequency < 60) {
    return NextResponse.json(
      { error: "`executionFrequency` must be at least 60 seconds" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { privyUserId: privyUser.id },
  });
  if (
    !user?.stacksAddress ||
    user.stacksAddress !== body.stacksAddress.trim()
  ) {
    return NextResponse.json(
      { error: "Stacks address is not linked to this account" },
      { status: 403 },
    );
  }

  const existing = await prisma.stacksDcaOrder.findFirst({
    where: { fundingTxId },
  });
  if (existing) {
    return NextResponse.json({ ok: true, order: serializeOrder(existing) });
  }

  const usdcx = usdcxToken("mainnet");
  const amountPerOrderRaw = String(
    Math.round(amountPerOrder * 10 ** usdcx.decimals),
  );
  const fundingAmountRaw = String(
    Math.round(amountPerOrder * numberOfOrders * 10 ** usdcx.decimals),
  );

  try {
    const keeperAddress = getStacksKeeperAddress();
    await verifyUsdcxFundingTx({
      txId: fundingTxId,
      from: body.stacksAddress.trim(),
      minAmountRaw: fundingAmountRaw,
    });

    const row = await prisma.stacksDcaOrder.create({
      data: {
        userId: user.id,
        stacksAddress: body.stacksAddress.trim(),
        network: stacksNetworkId(),
        groupId: null,
        keeperContractId: keeperAddress,
        amountPerOrderRaw,
        numberOfOrders,
        executionFrequency,
        fundingAmountRaw,
        fundingTxId,
        quotedOutRaw:
          typeof body.quotedOutRaw === "string" && /^\d+$/.test(body.quotedOutRaw)
            ? body.quotedOutRaw
            : null,
        status: "active",
        nextExecutionAt: new Date(),
        remainingOrders: numberOfOrders,
      },
    });

    return NextResponse.json({ ok: true, order: serializeOrder(row) });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create DCA order" },
      { status: 502 },
    );
  }
}
