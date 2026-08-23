import { zestEnabled, stacksNetworkId } from "@/lib/stacks/config";
import { errorMessage, ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import {
  previewZestBorrow,
  serializeZestPreview,
} from "@/services/stacks/zest";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/stacks/zest/preview?address=SP...&collateralSats=50000&borrowUsdcx=10
 *
 * Preview health / limits before signing collateral-add + borrow.
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

  const collateralSats = BigInt(
    request.nextUrl.searchParams.get("collateralSats") ?? "0",
  );
  const borrowUsdcx = Number(
    request.nextUrl.searchParams.get("borrowUsdcx") ?? "0",
  );

  if (collateralSats <= BigInt(0) && (!Number.isFinite(borrowUsdcx) || borrowUsdcx <= 0)) {
    return NextResponse.json(
      { error: "Provide `collateralSats` and/or `borrowUsdcx`" },
      { status: 400 },
    );
  }

  const borrowUsdcxRaw = BigInt(
    Math.max(0, Math.floor(borrowUsdcx * 1e6)),
  );

  try {
    const preview = await previewZestBorrow({
      address,
      collateralSats,
      borrowUsdcxRaw,
      network: stacksNetworkId(),
    });
    return NextResponse.json(serializeZestPreview(preview));
  } catch (e) {
    const status = e instanceof ServiceError ? e.status : 502;
    return NextResponse.json(
      { error: errorMessage(e, "Failed to preview Zest borrow") },
      { status },
    );
  }
}
