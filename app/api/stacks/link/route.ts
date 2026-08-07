import { prisma } from "@/lib/prisma";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Loose sanity check for a Stacks c32 principal (SP/SM mainnet, ST/SN testnet). */
function isStacksAddress(v: unknown): v is string {
  return (
    typeof v === "string" && /^S[PMTN][0-9A-Z]{28,41}$/.test(v.trim())
  );
}

/**
 * POST /api/stacks/link
 *
 * Links (or unlinks with `address: null`) an externally-connected Stacks
 * wallet to the caller's PaySats account. The wallet itself stays
 * self-custodial (Leather/Xverse); we only persist the address so the
 * product can show history and, later, power MCP reads.
 */
export async function POST(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    address?: string | null;
    network?: string;
  };

  if (body.address === null) {
    await prisma.user.update({
      where: { privyUserId: privyUser.id },
      data: { stacksAddress: null, stacksNetwork: null, stacksLinkedAt: null },
    });
    return NextResponse.json({ ok: true, stacksAddress: null });
  }

  if (!isStacksAddress(body.address)) {
    return NextResponse.json(
      { error: "Invalid Stacks address" },
      { status: 400 },
    );
  }
  const network = body.network === "testnet" ? "testnet" : "mainnet";

  const row = await prisma.user.update({
    where: { privyUserId: privyUser.id },
    data: {
      stacksAddress: body.address.trim(),
      stacksNetwork: network,
      stacksLinkedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    stacksAddress: row.stacksAddress,
    stacksNetwork: row.stacksNetwork,
  });
}
