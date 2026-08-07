import { stacksNetworkId } from "@/lib/stacks/config";
import { errorMessage, ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import { getStacksBalances } from "@/services/stacks/balances";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/stacks/balances?address=SP...
 *
 * STX + USDCx + sBTC balances for a Stacks address on the configured network.
 */
export async function GET(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address || !/^S[PMTN][0-9A-Z]{28,41}$/.test(address)) {
    return NextResponse.json(
      { error: "Missing or invalid `address`" },
      { status: 400 },
    );
  }

  try {
    const balances = await getStacksBalances(address, stacksNetworkId());
    return NextResponse.json(balances);
  } catch (e) {
    const status = e instanceof ServiceError ? e.status : 502;
    return NextResponse.json(
      { error: errorMessage(e, "Failed to load Stacks balances") },
      { status },
    );
  }
}
