import { previewStacksDca } from "@/services/stacks/dca-preview";
import { ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import { swapEnabled } from "@/lib/stacks/config";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/stacks/dca/quote?amountPerOrder=&numberOfOrders=&executionFrequency=
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

  const sp = request.nextUrl.searchParams;
  const amountPerOrder = Number(sp.get("amountPerOrder"));
  const numberOfOrders = Number(sp.get("numberOfOrders"));
  const executionFrequency = Number(sp.get("executionFrequency"));

  try {
    const preview = await previewStacksDca({
      amountPerOrder,
      numberOfOrders,
      executionFrequency,
    });
    return NextResponse.json(preview);
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Quote failed" },
      { status: 502 },
    );
  }
}
