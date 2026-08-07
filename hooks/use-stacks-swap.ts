"use client";

import { fetchWithPrivy } from "@/lib/api";
import {
  BITFLOW_HOSTS,
  DEFAULT_SLIPPAGE,
  stacksNetworkId,
  usdcxToken,
} from "@/lib/stacks/config";
import { reviveBigInts } from "@/lib/stacks/json";
import { fetchStacksTxStatus, type StacksTxStatus } from "@/lib/stacks/tx";
import type { SwapQuote } from "@/services/stacks/bitflow";
import { usePrivy } from "@privy-io/react-auth";
import { BitflowSDK } from "@bitflowlabs/core-sdk";
import { request as stacksRequest } from "@stacks/connect";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

let _clientSdk: BitflowSDK | undefined;
function getClientBitflowSdk(): BitflowSDK {
  if (!_clientSdk) {
    _clientSdk = new BitflowSDK({ ...BITFLOW_HOSTS });
  }
  return _clientSdk;
}

export type SwapPhase =
  | "idle"
  | "quoting"
  | "signing"
  | "pending"
  | "success"
  | "failed";

export type StacksSwapState = {
  quote: SwapQuote | null;
  quoteError: string | null;
  phase: SwapPhase;
  txId: string | null;
  error: string | null;
  fetchQuote: (amount: number) => Promise<SwapQuote | null>;
  clearQuote: () => void;
  /** Submits the quoted swap to the wallet for approval, then tracks it. */
  executeSwap: (opts: {
    quote: SwapQuote;
    senderAddress: string;
    slippage?: number;
    onSettled?: (status: StacksTxStatus) => void;
  }) => Promise<void>;
  reset: () => void;
};

export function useStacksSwap(): StacksSwapState {
  const network = stacksNetworkId();
  const { getAccessToken } = usePrivy();

  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SwapPhase>("idle");
  const [txId, setTxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tokenRef = useRef(getAccessToken);
  useLayoutEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);

  const quoteGen = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const fetchQuote = useCallback(
    async (amount: number): Promise<SwapQuote | null> => {
      const g = ++quoteGen.current;
      setQuoteError(null);
      if (!Number.isFinite(amount) || amount <= 0) {
        setQuote(null);
        return null;
      }
      setPhase((p) => (p === "idle" || p === "quoting" ? "quoting" : p));
      try {
        const qs = new URLSearchParams({ amount: String(amount) }).toString();
        const res = await fetchWithPrivy(
          tokenRef.current,
          `/api/stacks/swap/quote?${qs}`,
        );
        const json = (await res.json().catch(() => ({}))) as
          | SwapQuote
          | { error?: string };
        if (g !== quoteGen.current) return null;
        if (!res.ok || "error" in json) {
          setQuote(null);
          setQuoteError(
            ("error" in json && json.error) || "Failed to fetch quote",
          );
          setPhase((p) => (p === "quoting" ? "idle" : p));
          return null;
        }
        const q = reviveBigInts(json as SwapQuote);
        setQuote(q);
        setPhase((p) => (p === "quoting" ? "idle" : p));
        return q;
      } catch {
        if (g === quoteGen.current) {
          setQuote(null);
          setQuoteError("Failed to fetch quote");
          setPhase((p) => (p === "quoting" ? "idle" : p));
        }
        return null;
      }
    },
    [],
  );

  const clearQuote = useCallback(() => {
    quoteGen.current += 1;
    setQuote(null);
    setQuoteError(null);
  }, []);

  const recordSwap = useCallback(
    async (opts: {
      txId: string;
      senderAddress: string;
      quote: SwapQuote;
    }) => {
      const usdcx = usdcxToken(network);
      const amountInRaw = String(
        Math.round(opts.quote.amountIn * 10 ** usdcx.decimals),
      );
      const amountOutRaw = String(opts.quote.amountOutSats);
      try {
        await fetchWithPrivy(tokenRef.current, "/api/stacks/swap/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txId: opts.txId,
            stacksAddress: opts.senderAddress,
            amountInRaw,
            amountOutRaw,
          }),
        });
      } catch {
        // Best-effort; the on-chain tx is the source of truth.
      }
    },
    [network],
  );

  const patchSwap = useCallback(async (id: string, status: StacksTxStatus) => {
    if (status === "pending") return;
    try {
      await fetchWithPrivy(tokenRef.current, "/api/stacks/swap/record", {
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
          void patchSwap(id, status);
          onSettled?.(status);
          return;
        }
        // Stacks blocks are slow; give up UI polling after 30 minutes.
        if (Date.now() - started > 30 * 60_000) return;
        pollTimer.current = setTimeout(poll, 10_000);
      };
      pollTimer.current = setTimeout(poll, 5_000);
    },
    [network, patchSwap],
  );

  const executeSwap = useCallback(
    async (opts: {
      quote: SwapQuote;
      senderAddress: string;
      slippage?: number;
      onSettled?: (status: StacksTxStatus) => void;
    }) => {
      setError(null);
      setTxId(null);
      setPhase("signing");
      const sdk = getClientBitflowSdk();
      const slippage = opts.slippage ?? DEFAULT_SLIPPAGE;

      try {
        // BitflowSDK.executeSwap uses the legacy openContractCall path, which
        // blows up on @stacks/connect v8 with
        // "JSON data version undefined not supported by SessionData".
        // Build the contract-call params ourselves and submit via the modern
        // SIP-030 request('stx_callContract') API instead.
        const swapParams = await sdk.getSwapParams(
          {
            route: opts.quote.route,
            amount: opts.quote.amountIn,
            tokenXDecimals: opts.quote.tokenXDecimals,
            tokenYDecimals: opts.quote.tokenYDecimals,
          },
          opts.senderAddress,
          slippage,
        );

        const result = await stacksRequest("stx_callContract", {
          contract:
            `${swapParams.contractAddress}.${swapParams.contractName}` as `${string}.${string}`,
          functionName: swapParams.functionName,
          functionArgs: swapParams.functionArgs,
          postConditions: swapParams.postConditions,
          postConditionMode: "deny",
          network,
          address: opts.senderAddress as `S${string}`,
        });

        const id = result?.txid ?? null;
        if (!id) {
          setError("Wallet did not return a transaction id.");
          setPhase("idle");
          return;
        }
        const normalized = id.startsWith("0x") ? id : `0x${id}`;
        setTxId(normalized);
        setPhase("pending");
        void recordSwap({
          txId: normalized,
          senderAddress: opts.senderAddress,
          quote: opts.quote,
        });
        trackTx(normalized, opts.onSettled);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (/cancel|denied|rejected|closed|User rejected/i.test(msg)) {
          setPhase("idle");
        } else {
          setError(msg || "Swap failed to submit.");
          setPhase("idle");
        }
      }
    },
    [network, recordSwap, trackTx],
  );

  const reset = useCallback(() => {
    quoteGen.current += 1;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setQuote(null);
    setQuoteError(null);
    setPhase("idle");
    setTxId(null);
    setError(null);
  }, []);

  return {
    quote,
    quoteError,
    phase,
    txId,
    error,
    fetchQuote,
    clearQuote,
    executeSwap,
    reset,
  };
}
