import { getPendingAuth, issueAuthCode } from "@/services/oauth/store";
import { isStacksMcpRequest } from "@/services/mcp/host";
import { prisma } from "@/lib/prisma";
import { ensureIdrxOnboarding } from "@/services/idrx/onboarding-service";
import { awaitDeviceToken } from "@/services/privy/device-auth";
import { saveDeviceSession } from "@/services/privy/device-session";
import {
  getEmbeddedWalletId,
  getPreferredEthereumAddress,
  getPrivyServerClient,
} from "@/services/privy/server";
import {
  userFromLinkedStacksAddress,
  verifyStacksMcpSignature,
} from "@/services/stacks/mcp-oauth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Callback after the user approves agent access in the browser.
 * Stacks: Leather signature (no Privy). Base: Privy device-grant poll.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const handle = searchParams.get("handle");
  const denied = searchParams.get("denied");

  if (!handle) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const pending = await getPendingAuth(handle);
  if (!pending) {
    return NextResponse.json({ error: "expired_or_invalid_handle" }, { status: 400 });
  }

  if (denied) {
    return clientRedirect(pending.redirectUri, pending.clientState, { error: "access_denied" });
  }

  const stacks =
    isStacksMcpRequest(req) ||
    Boolean(searchParams.get("signature") && searchParams.get("publicKey"));

  if (stacks) {
    return completeStacks(req, pending);
  }

  return completePrivy(pending);
}

async function completeStacks(
  req: NextRequest,
  pending: NonNullable<Awaited<ReturnType<typeof getPendingAuth>>>,
) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  const signature = searchParams.get("signature");
  const publicKey = searchParams.get("publicKey");
  if (!address || !signature || !publicKey) {
    return clientRedirect(pending.redirectUri, pending.clientState, {
      error: "invalid_request",
    });
  }

  let recovered: string;
  try {
    recovered = verifyStacksMcpSignature({
      handle: pending.handle,
      address,
      signature,
      publicKey,
    });
  } catch (e) {
    console.error("[device-complete] stacks signature failed:", e);
    return clientRedirect(pending.redirectUri, pending.clientState, {
      error: "access_denied",
    });
  }

  try {
    const user = await userFromLinkedStacksAddress(recovered);
    const { code } = await issueAuthCode({
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      scope: pending.scope,
      privyUserId: user.privyUserId,
    });
    return clientRedirect(pending.redirectUri, pending.clientState, { code });
  } catch (e) {
    console.error("[device-complete] stacks persist failed:", e);
    return clientRedirect(pending.redirectUri, pending.clientState, {
      error: "server_error",
    });
  }
}

async function completePrivy(
  pending: NonNullable<Awaited<ReturnType<typeof getPendingAuth>>>,
) {
  if (!pending.deviceCode) {
    return NextResponse.json({ error: "expired_or_invalid_handle" }, { status: 400 });
  }

  const result = await awaitDeviceToken(pending.deviceCode, { intervalSec: 2, timeoutMs: 30_000 });
  if (result.status !== "ok") {
    console.error("[device-complete] token poll not ok:", result.status, "error" in result ? result.error : "");
    const error =
      result.status === "denied"
        ? "access_denied"
        : result.status === "expired"
          ? "expired_token"
          : "authorization_pending";
    return clientRedirect(pending.redirectUri, pending.clientState, { error });
  }

  const privy = getPrivyServerClient();
  let privyUser;
  try {
    const userId = await resolvePrivyUserId(result.tokens.accessToken);
    if (!userId) throw new Error("no_user_id_in_token");
    privyUser = await privy.getUser(userId);
  } catch (e) {
    console.error("[device-complete] user resolution failed:", e);
    return clientRedirect(pending.redirectUri, pending.clientState, {
      error: "server_error",
    });
  }

  const walletAddress = getPreferredEthereumAddress(privyUser) ?? null;
  const walletId = getEmbeddedWalletId(privyUser) ?? null;

  try {
    await prisma.user.upsert({
      where: { privyUserId: privyUser.id },
      create: {
        privyUserId: privyUser.id,
        ...(walletAddress ? { walletAddress } : {}),
      },
      update: {},
    });

    await saveDeviceSession({
      privyUserId: privyUser.id,
      tokens: result.tokens,
      walletId,
      walletAddress,
    });

    await ensureIdrxOnboarding(privyUser).catch((e) =>
      console.error("[device-complete] idrx onboarding (non-fatal):", e),
    );
  } catch (e) {
    console.error("[device-complete] persist failed:", e);
    return clientRedirect(pending.redirectUri, pending.clientState, {
      error: "server_error",
    });
  }

  const { code } = await issueAuthCode({
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: pending.codeChallengeMethod,
    scope: pending.scope,
    privyUserId: privyUser.id,
  });

  return clientRedirect(pending.redirectUri, pending.clientState, { code });
}

async function resolvePrivyUserId(accessToken: string): Promise<string | null> {
  try {
    const claims = await getPrivyServerClient().verifyAuthToken(accessToken);
    if (claims?.userId) return claims.userId;
  } catch {
    // fall through to decoding
  }
  const sub = decodeJwtClaim(accessToken, "sub");
  if (sub) {
    console.error("[device-complete] resolved user via decoded sub:", sub);
    return sub.startsWith("did:privy:") ? sub : `did:privy:${sub}`;
  }
  return null;
}

function decodeJwtClaim(token: string, claim: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const v = payload[claim];
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

function clientRedirect(
  redirectUri: string,
  state: string | null,
  params: { code?: string; error?: string },
) {
  const url = new URL(redirectUri);
  if (params.code) url.searchParams.set("code", params.code);
  if (params.error) url.searchParams.set("error", params.error);
  if (state) url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
