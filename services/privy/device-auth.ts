/**
 * Privy OAuth 2.0 Device Authorization Grant client (server-side).
 *
 * Implements the "Authorized wallet access for self-hosted agents" flow where
 * our MCP server (privymcp.paysats.exchange) is the *agent/device*:
 *   1. request a device + user code,
 *   2. the user approves in a browser at the hosted Verification URI
 *      (app.paysats.exchange for Base, stx.paysats.exchange for Stacks)
 *      which calls device_verify,
 *   3. we poll the token endpoint for the per-user access + refresh tokens.
 *
 * The resulting access_token is a standard Privy user access token; we feed it
 * to @privy-io/node as a `user_jwt` so the SDK transparently requests the user
 * signing key (HPKE) and signs wallet RPC. See services/dca/signing-service.ts.
 */

const PRIVY_AUTH_BASE = "https://auth.privy.io";

function appId(): string {
  const id = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!id) throw new Error("NEXT_PUBLIC_PRIVY_APP_ID must be set");
  return id;
}

async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${PRIVY_AUTH_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "privy-app-id": appId(),
    },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

export type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

/** Step 1 — request a device code. Call once at the start of the flow. */
export async function requestDeviceCode(): Promise<DeviceAuthorization> {
  const { status, json } = await postJson("/api/oauth/v2/device_authorization", {});
  if (status !== 200) {
    const err = (json.error as string) || `device_authorization_failed_${status}`;
    throw new Error(err);
  }
  return {
    deviceCode: String(json.device_code),
    userCode: String(json.user_code),
    verificationUri: String(json.verification_uri ?? ""),
    verificationUriComplete: String(json.verification_uri_complete ?? ""),
    expiresIn: Number(json.expires_in ?? 600),
    interval: Number(json.interval ?? 5),
  };
}

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  /** Unix ms when the access token expires. */
  expiresAt: number;
};

export type PollResult =
  | { status: "ok"; tokens: TokenSet }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "error"; error: string };

function toTokenSet(json: Record<string, unknown>): TokenSet {
  const expiresInSec = Number(json.expires_in ?? 900);
  return {
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token ?? ""),
    expiresAt: Date.now() + expiresInSec * 1000,
  };
}

/** Step 3 — poll once for a token using the device code. */
export async function pollDeviceToken(deviceCode: string): Promise<PollResult> {
  const { status, json } = await postJson("/api/oauth/v2/token", {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: deviceCode,
  });
  if (status === 200 && json.access_token) {
    return { status: "ok", tokens: toTokenSet(json) };
  }
  const err = String(json.error ?? `token_error_${status}`);
  switch (err) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down" };
    case "expired_token":
      return { status: "expired" };
    case "access_denied":
      return { status: "denied" };
    default:
      return { status: "error", error: err };
  }
}

/**
 * Poll the token endpoint until the user approves or we time out. Used by the
 * device-complete callback, which runs right after the browser approval, so a
 * couple of polls is normally enough.
 */
export async function awaitDeviceToken(
  deviceCode: string,
  opts: { intervalSec?: number; timeoutMs?: number } = {},
): Promise<PollResult> {
  let interval = Math.max(1, opts.intervalSec ?? 2);
  const deadline = Date.now() + (opts.timeoutMs ?? 25_000);
  // First attempt immediately.
  let result = await pollDeviceToken(deviceCode);
  while (Date.now() < deadline) {
    if (result.status === "ok") return result;
    if (result.status === "denied" || result.status === "expired" || result.status === "error") {
      return result;
    }
    if (result.status === "slow_down") interval += 5;
    await new Promise((r) => setTimeout(r, interval * 1000));
    result = await pollDeviceToken(deviceCode);
  }
  return result;
}

/** Exchange a refresh token for a fresh access token (refresh token rotates). */
export async function refreshDeviceToken(refreshToken: string): Promise<TokenSet> {
  const { status, json } = await postJson("/api/oauth/v2/token", {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (status !== 200 || !json.access_token) {
    throw new Error(String(json.error ?? `refresh_failed_${status}`));
  }
  return toTokenSet(json);
}
