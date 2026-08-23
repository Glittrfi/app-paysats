"use client";

import { fetchWithPrivy } from "@/lib/api";
import { stacksNetworkId, zestEnabled } from "@/lib/stacks/config";
import {
  buildZestBorrowTx,
  buildZestCollateralAddTx,
  buildZestCollateralRemoveTx,
  buildZestRepayTx,
  type ZestTxKind,
} from "@/lib/stacks/zest-tx";
import { fetchStacksTxStatus, type StacksTxStatus } from "@/lib/stacks/tx";
import { usePrivy } from "@privy-io/react-auth";
import { request as stacksRequest } from "@stacks/connect";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type ZestSerializedPosition = {
  address: string;
  network: string;
  hasPosition: boolean;
  collateralSats: string;
  collateralBtc: number;
  debtUsdcxRaw: string;
  debtUsdcx: number;
  collateralUsd: number;
  debtUsd: number;
  btcPriceUsd: number;
  usdcPriceUsd: number;
  risk: {
    ltvBorrowBps: number;
    ltvPartialBps: number;
    ltvFullBps: number;
    ltvBorrowPercent: number;
    ltvPartialPercent: number;
    ltvFullPercent: number;
  };
  health: {
    healthFactor: number;
    ltvPercent: number;
    zone: "safe" | "warning" | "danger";
    safetyScore: number;
  };
  maxBorrowRaw: string;
  maxBorrowUsdcx: number;
  maxAdditionalBorrowRaw: string;
  maxAdditionalBorrowUsdcx: number;
  liquidationBtcPrice: number | null;
};

export type ZestSerializedPreview = {
  collateralSats: string;
  borrowUsdcxRaw: string;
  collateralUsd: number;
  debtUsd: number;
  projectedDebtUsd: number;
  projectedLtvPercent: number;
  health: ZestSerializedPosition["health"];
  maxBorrowRaw: string;
  withinLimit: boolean;
  btcPriceUsd: number;
  usdcPriceUsd: number;
  risk: ZestSerializedPosition["risk"];
  liquidationBtcPrice: number | null;
};

export type ZestPhase =
  | "idle"
  | "signing"
  | "pending"
  | "success"
  | "failed";

function walletRejected(msg: string): boolean {
  return /cancel|denied|rejected|closed|User rejected/i.test(msg);
}

function txIdFromResult(result: { txid?: string; txId?: string } | null): string | null {
  const id = result?.txid ?? result?.txId ?? null;
  if (!id) return null;
  return id.startsWith("0x") ? id : `0x${id}`;
}

export function useStacksZest(address: string | null) {
  const network = stacksNetworkId();
  const enabled = zestEnabled(network);
  const { getAccessToken, ready, authenticated } = usePrivy();

  const [position, setPosition] = useState<ZestSerializedPosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ZestPhase>("idle");
  const [txId, setTxId] = useState<string | null>(null);
  const [txKind, setTxKind] = useState<ZestTxKind | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const tokenRef = useRef(getAccessToken);
  useLayoutEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);

  const gen = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const reload = useCallback(async () => {
    if (!address || !enabled) {
      gen.current += 1;
      setPosition(null);
      return;
    }
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ address }).toString();
      const res = await fetchWithPrivy(
        tokenRef.current,
        `/api/stacks/zest/position?${qs}`,
      );
      const json = (await res.json().catch(() => ({}))) as
        | ZestSerializedPosition
        | { error?: string };
      if (g !== gen.current) return;
      if (!res.ok || "error" in json) {
        setPosition(null);
        setError(
          ("error" in json && json.error) || "Failed to load Zest position",
        );
      } else {
        setPosition(json as ZestSerializedPosition);
      }
    } catch {
      if (g === gen.current) {
        setPosition(null);
        setError("Failed to load Zest position");
      }
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [address, enabled]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void reload();
  }, [ready, authenticated, reload]);

  const preview = useCallback(
    async (opts: {
      collateralSats: bigint;
      borrowUsdcx: number;
    }): Promise<ZestSerializedPreview | null> => {
      if (!address) return null;
      const qs = new URLSearchParams({
        address,
        collateralSats: opts.collateralSats.toString(),
        borrowUsdcx: String(opts.borrowUsdcx),
      });
      const res = await fetchWithPrivy(
        tokenRef.current,
        `/api/stacks/zest/preview?${qs.toString()}`,
      );
      const json = (await res.json().catch(() => ({}))) as
        | ZestSerializedPreview
        | { error?: string };
      if (!res.ok || "error" in json) {
        throw new Error(
          ("error" in json && json.error) || "Failed to preview borrow",
        );
      }
      return json as ZestSerializedPreview;
    },
    [address],
  );

  const fetchPriceFeeds = useCallback(async (): Promise<string[]> => {
    const res = await fetchWithPrivy(
      tokenRef.current,
      "/api/stacks/zest/price-feeds",
    );
    const json = (await res.json().catch(() => ({}))) as
      | { hexes?: string[] }
      | { error?: string };
    if (!res.ok || !("hexes" in json) || !json.hexes?.length) {
      throw new Error(
        ("error" in json && json.error) || "Failed to fetch Pyth price feeds",
      );
    }
    return json.hexes;
  }, []);

  const recordTx = useCallback(
    async (opts: {
      txId: string;
      kind: ZestTxKind;
      amountRaw: string;
      senderAddress: string;
    }) => {
      try {
        await fetchWithPrivy(tokenRef.current, "/api/stacks/zest/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txId: opts.txId,
            stacksAddress: opts.senderAddress,
            kind: opts.kind,
            amountRaw: opts.amountRaw,
          }),
        });
      } catch {
        // Best-effort; on-chain tx is the source of truth.
      }
    },
    [],
  );

  const patchTx = useCallback(async (id: string, status: StacksTxStatus) => {
    if (status === "pending") return;
    try {
      await fetchWithPrivy(tokenRef.current, "/api/stacks/zest/record", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txId: id, status }),
      });
    } catch {
      // Best-effort.
    }
  }, []);

  const trackTx = useCallback(
    (id: string, onSettled?: (status: StacksTxStatus) => void) => {
      const started = Date.now();
      const poll = async () => {
        let status: StacksTxStatus = "pending";
        try {
          status = await fetchStacksTxStatus(id, network);
        } catch {
          // Transient API error — keep polling.
        }
        if (status !== "pending") {
          setPhase(status);
          void patchTx(id, status);
          void reload();
          onSettled?.(status);
          return;
        }
        if (Date.now() - started > 30 * 60_000) return;
        pollTimer.current = setTimeout(poll, 10_000);
      };
      pollTimer.current = setTimeout(poll, 5_000);
    },
    [network, patchTx, reload],
  );

  const submitCall = useCallback(
    async (opts: {
      kind: ZestTxKind;
      built: {
        contract: `${string}.${string}`;
        functionName: string;
        functionArgs: unknown[];
        postConditions: unknown[];
        postConditionMode: "deny";
        amountRaw: string;
      };
      senderAddress: string;
    }): Promise<string> => {
      setTxError(null);
      setTxKind(opts.kind);
      setPhase("signing");
      const result = await stacksRequest("stx_callContract", {
        contract: opts.built.contract,
        functionName: opts.built.functionName,
        functionArgs: opts.built.functionArgs as never,
        postConditions: opts.built.postConditions as never,
        postConditionMode: "deny",
        network,
        address: opts.senderAddress as `S${string}`,
      });
      const id = txIdFromResult(result);
      if (!id) throw new Error("Wallet did not return a transaction id");
      setTxId(id);
      setPhase("pending");
      void recordTx({
        txId: id,
        kind: opts.kind,
        amountRaw: opts.built.amountRaw,
        senderAddress: opts.senderAddress,
      });
      trackTx(id);
      return id;
    },
    [network, recordTx, trackTx],
  );

  const lockCollateral = useCallback(
    async (amountSats: bigint) => {
      if (!address) throw new Error("Connect a Stacks wallet first");
      try {
        const feeds = await fetchPriceFeeds();
        const built = buildZestCollateralAddTx({
          senderAddress: address,
          amountSats,
          priceFeedHexes: feeds,
          network,
        });
        return await submitCall({
          kind: "collateral_add",
          built,
          senderAddress: address,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (walletRejected(msg)) {
          setPhase("idle");
        } else {
          setTxError(msg || "Failed to lock sBTC");
          setPhase("failed");
        }
        throw e;
      }
    },
    [address, fetchPriceFeeds, network, submitCall],
  );

  const borrow = useCallback(
    async (amountUsdcxRaw: bigint) => {
      if (!address) throw new Error("Connect a Stacks wallet first");
      try {
        const feeds = await fetchPriceFeeds();
        const built = buildZestBorrowTx({
          senderAddress: address,
          amountUsdcxRaw,
          priceFeedHexes: feeds,
          network,
        });
        return await submitCall({
          kind: "borrow",
          built,
          senderAddress: address,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (walletRejected(msg)) {
          setPhase("idle");
        } else {
          setTxError(msg || "Failed to borrow USDCx");
          setPhase("failed");
        }
        throw e;
      }
    },
    [address, fetchPriceFeeds, network, submitCall],
  );

  const repay = useCallback(
    async (amountUsdcxRaw: bigint) => {
      if (!address) throw new Error("Connect a Stacks wallet first");
      try {
        const built = buildZestRepayTx({
          senderAddress: address,
          amountUsdcxRaw,
          network,
        });
        return await submitCall({
          kind: "repay",
          built,
          senderAddress: address,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (walletRejected(msg)) {
          setPhase("idle");
        } else {
          setTxError(msg || "Failed to repay USDCx");
          setPhase("failed");
        }
        throw e;
      }
    },
    [address, network, submitCall],
  );

  const withdraw = useCallback(
    async (amountSats: bigint) => {
      if (!address) throw new Error("Connect a Stacks wallet first");
      try {
        const feeds = await fetchPriceFeeds();
        const built = buildZestCollateralRemoveTx({
          senderAddress: address,
          amountSats,
          priceFeedHexes: feeds,
          network,
        });
        return await submitCall({
          kind: "collateral_remove",
          built,
          senderAddress: address,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (walletRejected(msg)) {
          setPhase("idle");
        } else {
          setTxError(msg || "Failed to withdraw sBTC");
          setPhase("failed");
        }
        throw e;
      }
    },
    [address, fetchPriceFeeds, network, submitCall],
  );

  /**
   * Two wallet prompts back-to-back: lock isolated sBTC, then borrow USDCx.
   * Stacks executes them in nonce order, so the lock is applied before
   * borrow even if both are still in the mempool. No confirmation wait.
   * If the user rejects the second prompt, collateral stays locked.
   */
  const openLine = useCallback(
    async (opts: { collateralSats: bigint; borrowUsdcxRaw: bigint }) => {
      if (opts.collateralSats > BigInt(0)) {
        await lockCollateral(opts.collateralSats);
      }
      if (opts.borrowUsdcxRaw > BigInt(0)) {
        await borrow(opts.borrowUsdcxRaw);
      }
    },
    [borrow, lockCollateral],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setTxId(null);
    setTxKind(null);
    setTxError(null);
  }, []);

  return {
    enabled,
    position,
    loading,
    error,
    phase,
    txId,
    txKind,
    txError,
    reload,
    preview,
    lockCollateral,
    borrow,
    repay,
    withdraw,
    openLine,
    reset,
  };
}
