import { errorMessage, ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import { withdrawFromAgent } from "@/services/stacks/agent-actions";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * POST /api/stacks/agent/withdraw
 * { token: "usdcx" | "sbtc" | "stx", amount: number, recipient?: string }
 */
export async function POST(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    amount?: number;
    recipient?: string;
  };
  if (
    body.token !== "usdcx" &&
    body.token !== "sbtc" &&
    body.token !== "stx"
  ) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  try {
    const result = await withdrawFromAgent({
      privyUserId: privyUser.id,
      token: body.token,
      amount: Number(body.amount),
      recipient: body.recipient,
    });
    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof ServiceError ? e.status : 502;
    return NextResponse.json(
      { error: errorMessage(e, "Withdraw failed") },
      { status },
    );
  }
}
