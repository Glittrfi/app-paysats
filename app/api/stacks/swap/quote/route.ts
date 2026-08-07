import { stacksNetworkId, swapEnabled } from "@/lib/stacks/config";
import { errorMessage, ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import { getUsdcxToSbtcQuote } from "@/services/stacks/bitflow";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/stacks/swap/quote?amount=100
 *
 * Best USDCx -> sBTC route + quote from the Bitflow aggregator (mainnet).
 * `amount` is in human USDCx units. The returned `route` is fed back into
 * the client-side Bitflow executeSwap so the executed route matches the
 * quoted one.
 */
export async function GET(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!swapEnabled(stacksNetworkId())) {
    return NextResponse.json(
      {
        error:
          "Swaps are mainnet-only: the Bitflow aggregator does not route on testnet. Set NEXT_PUBLIC_STACKS_NETWORK=mainnet.",
      },
      { status: 400 },
    );
  }

  const amount = Number(request.nextUrl.searchParams.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "Missing or invalid `amount`" },
      { status: 400 },
    );
  }

  try {
    const quote = await getUsdcxToSbtcQuote(amount);
    return NextResponse.json(quote);
  } catch (e) {
    const status = e instanceof ServiceError ? e.status : 502;
    return NextResponse.json(
      { error: errorMessage(e, "Failed to fetch swap quote") },
      { status },
    );
  }
}
