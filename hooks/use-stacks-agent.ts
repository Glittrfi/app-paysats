"use client";

import { fetchWithPrivy } from "@/lib/api";
import type { AgentWalletView } from "@/lib/stacks/agent-types";
import { usePrivy } from "@privy-io/react-auth";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type AgentWalletState =
  | { agentReady: false; connectUrl?: string }
  | (AgentWalletView & { gasTxId?: string | null });

export function useStacksAgent() {
  const { getAccessToken, ready, authenticated } = usePrivy();
  const tokenRef = useRef(getAccessToken);
  useLayoutEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);

  const [wallet, setWallet] = useState<AgentWalletState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gen = useRef(0);

  const reload = useCallback(async () => {
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithPrivy(tokenRef.current, "/api/stacks/agent/wallet");
      const json = (await res.json().catch(() => ({}))) as
        | AgentWalletState
        | { error?: string };
      if (g !== gen.current) return;
      if (!res.ok || ("error" in json && json.error)) {
        setWallet(null);
        setError(
          ("error" in json && json.error) || "Failed to load agent account",
        );
      } else {
        setWallet(json as AgentWalletState);
      }
    } catch {
      if (g === gen.current) {
        setWallet(null);
        setError("Failed to load agent account");
      }
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void reload();
  }, [ready, authenticated, reload]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetchWithPrivy(
          tokenRef.current,
          "/api/stacks/agent/wallet",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        const json = (await res.json().catch(() => ({}))) as
          | AgentWalletState
          | { error?: string; ok?: boolean };
        if (!res.ok || ("error" in json && json.error)) {
          throw new Error(
            ("error" in json && json.error) || "Agent account update failed",
          );
        }
        await reload();
        return json;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Agent account update failed";
        setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const generate = useCallback(() => post({ action: "generate" }), [post]);
  const forget = useCallback(() => post({ action: "forget" }), [post]);
  const importKey = useCallback(
    (privateKey: string) => post({ action: "import", privateKey }),
    [post],
  );

  const withdraw = useCallback(
    async (opts: {
      token: "usdcx" | "sbtc" | "stx";
      amount: number;
      recipient?: string;
    }) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetchWithPrivy(
          tokenRef.current,
          "/api/stacks/agent/withdraw",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(opts),
          },
        );
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          txId?: string;
          error?: string;
          needsDeposit?: boolean;
        };
        if (!res.ok || json.error) {
          throw new Error(json.error || "Withdraw failed");
        }
        await reload();
        return json;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Withdraw failed";
        setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  return {
    wallet,
    loading,
    busy,
    error,
    reload,
    generate,
    importKey,
    forget,
    withdraw,
  };
}
