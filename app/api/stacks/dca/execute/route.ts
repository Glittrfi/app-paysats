import { stacksDcaCronSecret } from "@/lib/stacks/config";
import { ServiceError } from "@/services/errors";
import { executeDueDcaOrders } from "@/services/stacks/dca-executor";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function authorizeCron(request: NextRequest): boolean {
  const secrets = [stacksDcaCronSecret(), process.env.CRON_SECRET?.trim()].filter(
    (s): s is string => Boolean(s && s.length >= 16),
  );
  if (secrets.length === 0) return false;
  const auth = request.headers.get("authorization");
  return secrets.some((s) => auth === `Bearer ${s}`);
}

/**
 * POST /api/stacks/dca/execute
 * Cron-guarded worker: swap due DCA slices and pay out sBTC.
 *
 * Local: `curl -X POST -H "Authorization: Bearer $STACKS_DCA_CRON_SECRET" http://localhost:3000/api/stacks/dca/execute`
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

/** Vercel Cron invokes GET by default. */
export async function GET(request: NextRequest) {
  return POST(request);
}
