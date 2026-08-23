import { zestEnabled, stacksNetworkId } from "@/lib/stacks/config";
import { errorMessage, ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import { fetchPythPriceFeedHexes } from "@/services/stacks/pyth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/stacks/zest/price-feeds
 *
 * One Pyth Pro (Lazer) EVM update for v0-7-market in-band oracle.
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

  try {
    const hexes = await fetchPythPriceFeedHexes();
    return NextResponse.json({ hexes });
  } catch (e) {
    const status = e instanceof ServiceError ? e.status : 502;
    return NextResponse.json(
      { error: errorMessage(e, "Failed to fetch Pyth price feeds") },
      { status },
    );
  }
}
