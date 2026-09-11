import { errorMessage, ServiceError } from "@/services/errors";
import { getPrivyUserFromRequest } from "@/services/privy/server";
import {
  forgetAgentWallet,
  generateAgentWallet,
  getAgentWalletView,
  importAgentWallet,
  upsertDbUser,
} from "@/services/stacks/agent-wallet";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/stacks/agent/wallet
 * POST /api/stacks/agent/wallet  { action: "generate" | "import" | "forget", privateKey? }
 */
export async function GET(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const user = await upsertDbUser(privyUser.id);
    const view = await getAgentWalletView(user);
    return NextResponse.json(view);
  } catch (e) {
    const status = e instanceof ServiceError ? e.status : 502;
    return NextResponse.json(
      { error: errorMessage(e, "Failed to load agent account") },
      { status },
    );
  }
}

export async function POST(request: NextRequest) {
  const privyUser = await getPrivyUserFromRequest(request);
  if (!privyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    privateKey?: string;
  };

  try {
    if (body.action === "import") {
      if (typeof body.privateKey !== "string" || !body.privateKey.trim()) {
        return NextResponse.json(
          { error: "privateKey is required" },
          { status: 400 },
        );
      }
      const user = await importAgentWallet(privyUser.id, body.privateKey);
      const view = await getAgentWalletView(user);
      return NextResponse.json(view);
    }
    if (body.action === "forget") {
      await forgetAgentWallet(privyUser.id);
      return NextResponse.json({ ok: true, agentReady: false });
    }

    const { user, gasTxId } = await generateAgentWallet(privyUser.id);
    const view = await getAgentWalletView(user);
    return NextResponse.json({ ...view, gasTxId });
  } catch (e) {
    const status = e instanceof ServiceError ? e.status : 502;
    return NextResponse.json(
      { error: errorMessage(e, "Agent account update failed") },
      { status },
    );
  }
}
