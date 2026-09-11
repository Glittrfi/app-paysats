"use client";

import { stacksMcpAuthMessage } from "@/lib/stacks/mcp-oauth";
import {
  connect as stacksConnect,
  getLocalStorage,
  request as stacksRequest,
} from "@stacks/connect";
import { useCallback, useEffect, useState } from "react";

type Phase = "init" | "connect" | "ready" | "working" | "done" | "denied" | "error";

function mainnetAddress(): string | null {
  try {
    const stx = getLocalStorage()?.addresses?.stx ?? [];
    const match = stx.find(
      (a) => a.address.startsWith("SP") || a.address.startsWith("SM"),
    );
    return match?.address ?? null;
  } catch {
    return null;
  }
}

/**
 * Stacks MCP approval — Leather / Xverse only. No Privy, no Google.
 */
export function StacksVerificationClient({
  handle,
  complete,
}: {
  handle: string | null;
  complete: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("init");
  const [message, setMessage] = useState("");
  const [address, setAddress] = useState<string | null>(null);

  const valid = Boolean(handle && complete);

  useEffect(() => {
    if (!valid) {
      setPhase("error");
      setMessage("This link is invalid or has expired. Please start again from Claude.");
      return;
    }
    const stored = mainnetAddress();
    if (stored) {
      setAddress(stored);
      setPhase("ready");
    } else {
      setPhase("connect");
    }
  }, [valid]);

  const returnToMcp = useCallback(
    (params: Record<string, string>) => {
      const url = new URL(complete as string);
      url.searchParams.set("handle", handle as string);
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
      window.location.href = url.toString();
    },
    [complete, handle],
  );

  const onConnect = useCallback(async () => {
    setPhase("working");
    setMessage("Opening Leather / Xverse…");
    try {
      const result = await stacksConnect({ forceWalletSelect: true });
      const stxEntry =
        result.addresses.find(
          (a) => a.address.startsWith("SP") || a.address.startsWith("SM"),
        ) ?? null;
      const addr = stxEntry?.address ?? mainnetAddress();
      if (!addr) {
        setPhase("error");
        setMessage("No mainnet Stacks address returned. Switch your wallet to mainnet and retry.");
        return;
      }
      setAddress(addr);
      setPhase("ready");
      setMessage("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/cancel|denied|rejected|closed/i.test(msg)) {
        setPhase("connect");
        setMessage("");
        return;
      }
      setPhase("error");
      setMessage(msg || "Could not connect a Stacks wallet.");
    }
  }, []);

  const onApprove = useCallback(async () => {
    if (!valid || !address || !handle) return;
    setPhase("working");
    setMessage("Sign in Leather to authorize Claude…");
    try {
      const signed = await stacksRequest("stx_signMessage", {
        message: stacksMcpAuthMessage(handle),
      });
      setPhase("done");
      returnToMcp({
        address,
        signature: signed.signature,
        publicKey: signed.publicKey,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/cancel|denied|rejected|closed/i.test(msg)) {
        setPhase("ready");
        setMessage("");
        return;
      }
      setPhase("error");
      setMessage(msg || "Signature failed.");
    }
  }, [valid, address, handle, returnToMcp]);

  const onDeny = useCallback(() => {
    if (!valid) return;
    setPhase("denied");
    returnToMcp({ denied: "1" });
  }, [valid, returnToMcp]);

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
          Verify Stacks agent access
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: "#6b5c4d", marginBottom: 12 }}>
          Connect Leather or Xverse and sign once so Claude can operate your
          PaySats Stacks agent — Bitflow USDCx→sBTC DCA, Zest borrow, and
          withdraw. This is not a Google / Privy login.
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
          <li>Fund the Stacks agent with USDCx, sBTC, and a little STX</li>
          <li>Set up and manage recurring Bitflow DCA (USDCx → sBTC)</li>
          <li>Borrow USDCx on Zest by collateralizing sBTC</li>
          <li>Withdraw USDCx, sBTC, or STX to Leather / Xverse</li>
        </ul>

        {address ? (
          <div
            style={{
              fontSize: 13,
              color: "#6b5c4d",
              marginBottom: 20,
              padding: "8px 12px",
              background: "#f6efe9",
              borderRadius: 8,
              wordBreak: "break-all",
            }}
          >
            Wallet: <strong>{address}</strong>
          </div>
        ) : null}

        {phase === "init" ? <p>Loading…</p> : null}

        {phase === "connect" ? (
          <button onClick={onConnect} style={primaryBtn}>
            Connect Leather / Xverse
          </button>
        ) : null}

        {phase === "ready" ? (
          <div style={{ display: "grid", gap: 10 }}>
            <button onClick={onApprove} style={primaryBtn}>
              Approve with wallet signature
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
