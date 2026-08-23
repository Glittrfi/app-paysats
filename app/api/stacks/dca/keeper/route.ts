import { prisma } from "@/lib/prisma";
import { swapEnabled } from "@/lib/stacks/config";
import { ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import {
  ensureKeeperContract,
  getKeeperPrepaidInfo,
  listKeeperContracts,
  pickMultiActionContract,
  pickReusableFundingTx,
  type KeeperAuth,
} from "@/services/stacks/bitflow-keeper";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isStacksAddress(v: unknown): v is string {
  return typeof v === "string" && /^S[PMTN][0-9A-Z]{28,41}$/.test(v.trim());
}

function parseAuth(body: unknown): KeeperAuth | null {
  if (!body || typeof body !== "object") return null;
  const a = body as Record<string, unknown>;
  if (
    typeof a.timestamp !== "number" ||
    typeof a.signature !== "string" ||
    typeof a.publicKey !== "string" ||
    !a.signature ||
    !a.publicKey
  ) {
    return null;
  }
  return {
    timestamp: a.timestamp,
    signature: a.signature,
    publicKey: a.publicKey,
  };
}

/**
 * GET /api/stacks/dca/keeper?stacksAddress=
 * Lists the caller's Bitflow Keeper contracts.
 */
export async function GET(request: NextRequest) {
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

  const stacksAddress = request.nextUrl.searchParams.get("stacksAddress");
  if (!isStacksAddress(stacksAddress)) {
    return NextResponse.json(
      { error: "Invalid `stacksAddress`" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { privyUserId: privyUser.id },
  });
  if (!user?.stacksAddress || user.stacksAddress !== stacksAddress.trim()) {
    return NextResponse.json(
      { error: "Stacks address is not linked to this account" },
      { status: 403 },
    );
  }

  try {
    const contracts = await listKeeperContracts(stacksAddress.trim());
    const amountNeeded = request.nextUrl.searchParams.get("amountRaw");
    // Only pull funding-tx history when creating / reusing a prepaid amount.
    const prepaid = await getKeeperPrepaidInfo(
      stacksAddress.trim(),
      contracts,
      { includeFundingTxs: Boolean(amountNeeded) },
    );
    // Prefer a deployed keeper that already holds enough prepaid USDCx.
    let preferred = pickMultiActionContract(contracts);
    if (amountNeeded && /^\d+$/.test(amountNeeded)) {
      const funded = prepaid.contracts
        .filter(
          (c) =>
            String(c.contractStatus).toLowerCase().includes("success") &&
            BigInt(c.usdcxRaw) >= BigInt(amountNeeded),
        )
        .sort((a, b) => Number(BigInt(a.usdcxRaw) - BigInt(b.usdcxRaw)));
      if (funded[0]) {
        preferred =
          contracts.find(
            (c) => c.contractIdentifier === funded[0]!.contractIdentifier,
          ) ?? preferred;
      }
    }
    const reusableFunding =
      preferred && amountNeeded && /^\d+$/.test(amountNeeded)
        ? pickReusableFundingTx(prepaid.fundingCandidates, {
            contractIdentifier: preferred.contractIdentifier,
            amountRaw: amountNeeded,
          })
        : null;

    return NextResponse.json({
      contracts: prepaid.contracts.map((c) => ({
        ...c,
        keeperType: "MULTI_ACTION_V1",
      })),
      preferred: preferred
        ? {
            contractIdentifier: preferred.contractIdentifier,
            contractStatus: preferred.contractStatus,
            usdcxRaw:
              prepaid.contracts.find(
                (c) =>
                  c.contractIdentifier === preferred.contractIdentifier,
              )?.usdcxRaw ?? "0",
          }
        : null,
      prepaidUsdcxRaw: prepaid.prepaidUsdcxRaw,
      prepaidUsdcx: prepaid.prepaidUsdcx,
      fundingCandidates: prepaid.fundingCandidates,
      reusableFunding,
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list keepers" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/stacks/dca/keeper
 * Creates (or reuses) a Bitflow MULTI_ACTION keeper contract.
 * Body: `{ stacksAddress, auth: { timestamp, signature, publicKey } }`
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
    auth?: unknown;
  };
  if (!isStacksAddress(body.stacksAddress)) {
    return NextResponse.json(
      { error: "Invalid `stacksAddress`" },
      { status: 400 },
    );
  }
  const auth = parseAuth(body.auth);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid signed `auth` (timestamp, signature, publicKey)" },
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

  try {
    const { contract, created } = await ensureKeeperContract({
      stacksAddress: body.stacksAddress.trim(),
      auth,
    });
    return NextResponse.json({
      created,
      contract: {
        contractIdentifier: contract.contractIdentifier,
        contractStatus: contract.contractStatus,
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create keeper" },
      { status: 502 },
    );
  }
}
