"use client";

import { usePostLoginSync } from "@/hooks/use-post-login-sync";
import { useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";

const PRIVY_AUTH_BASE = "https://auth.privy.io";

type Phase = "init" | "login" | "ready" | "working" | "done" | "denied" | "error";

/**
 * Hosted browser approval page for Privy's device-authorization grant.
 * Base / Privy MCP only (app.paysats.exchange). Stacks MCP uses
 * StacksVerificationClient (Leather, no Privy).
 */
export function VerificationClient({
  userCode,
  handle,
  complete,
}: {
  userCode: string | null;
  handle: string | null;
  complete: string | null;
}) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { initOAuth } = useLoginWithOAuth();
  const sync = usePostLoginSync();

  const [phase, setPhase] = useState<Phase>("init");
  const [message, setMessage] = useState<string>("");

  const valid = Boolean(userCode && handle && complete);

  useEffect(() => {
    if (!ready) return;
    if (!valid) {
      setPhase("error");
      setMessage("This link is invalid or has expired. Please start again from Claude.");
      return;
    }
    setPhase(authenticated ? "ready" : "login");
  }, [ready, authenticated, valid]);

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

  const onLogin = useCallback(async () => {
    try {
      await initOAuth({ provider: "google" });
    } catch {
      setPhase("error");
      setMessage("Sign-in failed. Please try again.");
    }
  }, [initOAuth]);

  const deviceVerify = useCallback(
    async (action: "approve" | "deny") => {
      const token = await getAccessToken();
      if (!token) throw new Error("Sesi tidak ditemukan");
      const res = await fetch(`${PRIVY_AUTH_BASE}/api/oauth/v2/device_verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "privy-app-id": appId,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_code: userCode, action }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Verification failed");
      }
    },
    [appId, getAccessToken, userCode],
  );

  const returnToMcp = useCallback(
    (denied: boolean) => {
      const url = new URL(complete as string);
      url.searchParams.set("handle", handle as string);
      if (denied) url.searchParams.set("denied", "1");
      window.location.href = url.toString();
    },
    [complete, handle],
  );

  const onApprove = useCallback(async () => {
    if (!valid) return;
    setPhase("working");
    setMessage("Preparing your wallet…");
    try {
      await sync().catch(() => undefined);
      setMessage("Granting agent access…");
      await deviceVerify("approve");
      setPhase("done");
      returnToMcp(false);
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, [valid, sync, deviceVerify, returnToMcp]);

  const onDeny = useCallback(async () => {
    if (!valid) return;
    setPhase("working");
    setMessage("Cancelling…");
    try {
      await deviceVerify("deny").catch(() => undefined);
    } finally {
      setPhase("denied");
      returnToMcp(true);
    }
  }, [valid, deviceVerify, returnToMcp]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#faf7f4",
        color: "#2b2017",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#fff",
          borderRadius: 16,
          padding: 28,
          boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Verify agent access
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: "#6b5c4d", marginBottom: 12 }}>
          Sign in with Google and approve agent access so Claude can act on
          your behalf. It&apos;s a one-time approval — after this Claude can
          help you directly without opening the browser again.
        </p>
        <ul
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: "#6b5c4d",
            margin: "0 0 16px",
            paddingLeft: 18,
          }}
        >
          <li>Deposit IDR and mint IDRX to your wallet</li>
          <li>Set up and manage recurring DCA into Bitcoin (cbBTC)</li>
          <li>Borrow IDRX by collateralizing your BTC</li>
        </ul>

        {userCode ? (
          <div
            style={{
              fontSize: 13,
              color: "#6b5c4d",
              marginBottom: 20,
              padding: "8px 12px",
              background: "#f6efe9",
              borderRadius: 8,
            }}
          >
            Device code: <strong style={{ letterSpacing: 2 }}>{userCode}</strong>
          </div>
        ) : null}

        {phase === "init" ? <p>Loading…</p> : null}

        {phase === "login" ? (
          <button onClick={onLogin} style={primaryBtn}>
            Sign in with Google
          </button>
        ) : null}

        {phase === "ready" ? (
          <div style={{ display: "grid", gap: 10 }}>
            <button onClick={onApprove} style={primaryBtn}>
              Approve agent access
            </button>
            <button onClick={onDeny} style={secondaryBtn}>
              Deny
            </button>
          </div>
        ) : null}

        {phase === "working" ? <p>{message || "Processing…"}</p> : null}

        {phase === "done" ? <p>Success! Redirecting you back to Claude…</p> : null}

        {phase === "denied" ? <p>Access denied. Redirecting…</p> : null}

        {phase === "error" ? <p style={{ color: "#b3261e" }}>{message}</p> : null}
      </div>
    </main>
  );
}

const primaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 12,
  border: "none",
  background: "#b85c38",
  color: "#fff",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid #d9c9bc",
  background: "#fff",
  color: "#6b5c4d",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
