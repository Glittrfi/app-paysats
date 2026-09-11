import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import { cancelStacksDcaOrder } from "@/services/stacks/dca-cancel";
import type { KeeperAuth } from "@/services/stacks/bitflow-keeper";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

function isKeeperAuth(v: unknown): v is KeeperAuth {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.timestamp === "number" &&
    typeof a.signature === "string" &&
    typeof a.publicKey === "string"
  );
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({
    where: { privyUserId: privyUser.id },
  });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    auth?: unknown;
  };

  try {
    const result = await cancelStacksDcaOrder({
      userId: user.id,
      orderId: id,
      auth: isKeeperAuth(body.auth) ? body.auth : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cancel failed" },
      { status: 502 },
    );
  }
}
