import { stacksDcaCronSecret } from "@/lib/stacks/config";
import { ServiceError } from "@/services/errors";
import { executeDueDcaOrders } from "@/services/stacks/dca-executor";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function authorizeCron(request: NextRequest): boolean {
  const secret = stacksDcaCronSecret();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * POST /api/stacks/dca/execute
 * Cron-guarded worker: swap due DCA slices and pay out sBTC.
 * Returns `nextWakeAt` so the self-hosted worker can sleep until the next
 * due slice (or ~45s while a swap/payout is in flight).
 *
 *   npm run dca:execute
 *   npm run dca:cron
 */
export async function POST(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await executeDueDcaOrders();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "DCA execution failed",
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
