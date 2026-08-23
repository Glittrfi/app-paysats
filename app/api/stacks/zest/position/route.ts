import { zestEnabled, stacksNetworkId } from "@/lib/stacks/config";
import { errorMessage, ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import {
  getZestPosition,
  serializeZestPosition,
} from "@/services/stacks/zest";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/stacks/zest/position?address=SP...
 *
 * Live Zest V2 position + health for sBTC collateral / USDCx debt.
 */
export async function GET(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!zestEnabled(stacksNetworkId())) {
    return NextResponse.json(
      { error: "Zest borrow is mainnet-only." },
      { status: 400 },
    );
  }

  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address || !/^S[PMTN][0-9A-Z]{28,41}$/.test(address)) {
    return NextResponse.json(
      { error: "Missing or invalid `address`" },
      { status: 400 },
    );
  }

  try {
    const position = await getZestPosition(address, stacksNetworkId());
    return NextResponse.json(serializeZestPosition(position));
  } catch (e) {
    const status = e instanceof ServiceError ? e.status : 502;
    return NextResponse.json(
      { error: errorMessage(e, "Failed to load Zest position") },
      { status },
    );
  }
}
