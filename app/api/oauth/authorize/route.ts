import { createPendingAuth, getClient } from "@/services/oauth/store";
import {
  baseAppPublicUrl,
  isStacksMcpRequest,
  stacksAppPublicUrl,
} from "@/services/mcp/host";
import { requestDeviceCode } from "@/services/privy/device-auth";
import { getPublicOrigin } from "mcp-handler";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * OAuth 2.1 authorization endpoint (bridged onto Privy's device-authorization
 * grant). Validates the client + PKCE params, starts a Privy device
 * authorization, persists the device/user codes against a pending-auth handle,
 * then redirects the user's browser to the hosted Verification page
 * (app.paysats.exchange for Base, stx.paysats.exchange for Stacks). After
 * approval the page returns to /api/oauth/device-complete.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Behind nginx, req.url reflects the internal address — derive the public
  // origin (https://privymcp.paysats.exchange) from forwarded headers so the
  // verification page returns to a publicly reachable callback.
  const origin = getPublicOrigin(req);

  const responseType = searchParams.get("response_type");
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method") || "S256";
  const state = searchParams.get("state") || undefined;
  const scope = searchParams.get("scope") || undefined;

  if (responseType !== "code") {
    return errorRedirect(redirectUri, state, "unsupported_response_type");
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (codeChallengeMethod !== "S256") {
    return errorRedirect(redirectUri, state, "invalid_request");
  }

  const client = await getClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
  }

  // Start the Privy device authorization. The agent (this server) is the device.
  let device;
  try {
    device = await requestDeviceCode();
  } catch {
    return errorRedirect(redirectUri, state, "server_error");
  }

  const { handle } = await createPendingAuth({
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    scope,
    clientState: state,
    deviceCode: device.deviceCode,
    userCode: device.userCode,
  });

  // Privy's dashboard Verification URI is a single URL (app.paysats.exchange).
  // For the Stacks MCP, rewrite that origin to stx.paysats.exchange so the
  // approval page is the Stacks app, not the Base/IDRX app.
  const stacks = isStacksMcpRequest(req);
  const verifyUrl = buildVerificationUrl(
    device.verificationUriComplete,
    device.userCode,
    stacks,
  );
  verifyUrl.searchParams.set("handle", handle);
  verifyUrl.searchParams.set("complete", `${origin}/api/oauth/device-complete`);
  verifyUrl.searchParams.set("flavor", stacks ? "stacks" : "base");

  return NextResponse.redirect(verifyUrl);
}

function buildVerificationUrl(
  complete: string,
  userCode: string,
  stacks: boolean,
): URL {
  const base = stacks ? stacksAppPublicUrl() : baseAppPublicUrl();
  let fromPrivy: URL | null = null;
  if (complete) {
    try {
      fromPrivy = new URL(complete);
    } catch {
      fromPrivy = null;
    }
  }
  const url = fromPrivy
    ? new URL(fromPrivy.pathname + fromPrivy.search, base)
    : new URL("/verification", base);
  if (!url.searchParams.get("user_code")) {
    url.searchParams.set("user_code", userCode);
  }
  return url;
}

function errorRedirect(
  redirectUri: string | null,
  state: string | undefined,
  error: string,
) {
  if (!redirectUri) {
    return NextResponse.json({ error }, { status: 400 });
  }
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
