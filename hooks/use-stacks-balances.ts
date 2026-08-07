"use client";

import { fetchWithPrivy } from "@/lib/api";
import type { StacksBalances } from "@/services/stacks/balances";
import { usePrivy } from "@privy-io/react-auth";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type StacksBalancesState = {
  balances: StacksBalances | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/** USDCx / sBTC / STX balances for a connected Stacks address. */
export function useStacksBalances(address: string | null): StacksBalancesState {
  const { getAccessToken, ready, authenticated } = usePrivy();
  const [balances, setBalances] = useState<StacksBalances | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenRef = useRef(getAccessToken);
  useLayoutEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);

  const gen = useRef(0);

  const reload = useCallback(async () => {
    if (!address) {
      gen.current += 1;
      setBalances(null);
      setError(null);
      return;
    }
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ address }).toString();
      const res = await fetchWithPrivy(
        tokenRef.current,
        `/api/stacks/balances?${qs}`,
      );
      const json = (await res.json().catch(() => ({}))) as
        | StacksBalances
        | { error?: string };
      if (g !== gen.current) return;
      if (!res.ok || "error" in json) {
        setBalances(null);
        setError(
          ("error" in json && json.error) || "Failed to load balances",
        );
      } else {
        setBalances(json as StacksBalances);
      }
    } catch {
      if (g === gen.current) {
        setBalances(null);
        setError("Failed to load balances");
      }
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void reload();
  }, [ready, authenticated, reload]);

  return { balances, loading, error, reload };
}
