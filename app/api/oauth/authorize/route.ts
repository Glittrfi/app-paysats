import { createPendingAuth, getClient } from "@/services/oauth/store";
import { baseAppPublicUrl, isStacksMcpRequest } from "@/services/mcp/host";
import { requestDeviceCode } from "@/services/privy/device-auth";
import { getPublicOrigin } from "mcp-handler";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * OAuth 2.1 authorization endpoint.
 *
 * Stacks MCP: Leather / Xverse signature on /verification. No Privy.
 * Base MCP: Privy device-authorization grant (Google), hosted on
 * app.paysats.exchange.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
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

  const stacks = isStacksMcpRequest(req);
  const complete = `${origin}/api/oauth/device-complete`;

  if (stacks) {
    const { handle } = await createPendingAuth({
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scope,
      clientState: state,
    });
    // Host approval on this MCP origin so OAuth never depends on Privy or
    // the Vercel product app.
    const verifyUrl = new URL("/verification", origin);
    verifyUrl.searchParams.set("handle", handle);
    verifyUrl.searchParams.set("complete", complete);
    verifyUrl.searchParams.set("flavor", "stacks");
    return NextResponse.redirect(verifyUrl);
  }

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

  const verifyUrl = buildBaseVerificationUrl(
    device.verificationUriComplete,
    device.userCode,
  );
  verifyUrl.searchParams.set("handle", handle);
  verifyUrl.searchParams.set("complete", complete);
  verifyUrl.searchParams.set("flavor", "base");

  return NextResponse.redirect(verifyUrl);
}

function buildBaseVerificationUrl(complete: string, userCode: string): URL {
  const base = baseAppPublicUrl();
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
