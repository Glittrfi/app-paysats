"use client";

import { fetchWithPrivy } from "@/lib/api";
import { stacksNetworkId, type StacksNetworkId } from "@/lib/stacks/config";
import { usePrivy } from "@privy-io/react-auth";
import {
  connect as stacksConnect,
  disconnect as stacksDisconnect,
  getLocalStorage,
} from "@stacks/connect";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Mainnet principals start with SP/SM, testnet with ST/SN. */
function addressMatchesNetwork(
  address: string,
  network: StacksNetworkId,
): boolean {
  const prefix = address.slice(0, 2);
  return network === "mainnet"
    ? prefix === "SP" || prefix === "SM"
    : prefix === "ST" || prefix === "SN";
}

function readStoredAddress(network: StacksNetworkId): string | null {
  try {
    const data = getLocalStorage();
    const stx = data?.addresses?.stx ?? [];
    const match = stx.find((a) => addressMatchesNetwork(a.address, network));
    return match?.address ?? null;
  } catch {
    return null;
  }
}

export type StacksWalletState = {
  /** Connected STX address for the configured network, or null. */
  address: string | null;
  network: StacksNetworkId;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

/**
 * External Stacks wallet connection (Leather / Xverse / etc.) via
 * @stacks/connect. The wallet stays fully self-custodial; on connect we link
 * the address to the PaySats account (POST /api/stacks/link) so history and
 * future MCP reads can resolve it.
 */
export function useStacksWallet(): StacksWalletState {
  const network = stacksNetworkId();
  const { getAccessToken, authenticated } = usePrivy();

  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenRef = useRef(getAccessToken);
  useLayoutEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);

  // Restore a previous session from @stacks/connect local storage.
  useEffect(() => {
    setAddress(readStoredAddress(network));
  }, [network]);

  const linkAddress = useCallback(
    async (addr: string | null) => {
      if (!authenticated) return;
      try {
        await fetchWithPrivy(tokenRef.current, "/api/stacks/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: addr, network }),
        });
      } catch {
        // Linking is best-effort; the wallet connection itself still works.
      }
    },
    [authenticated, network],
  );

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const result = await stacksConnect({ forceWalletSelect: true });
      const stxEntry =
        result.addresses.find(
          (a) =>
            addressMatchesNetwork(a.address, network) &&
            (a.symbol === "STX" || a.address.startsWith("S")),
        ) ?? null;
      const addr = stxEntry?.address ?? readStoredAddress(network);
      if (!addr) {
        setError(
          network === "testnet"
            ? "No testnet Stacks address found. Switch your wallet to testnet and retry."
            : "No Stacks address returned by the wallet.",
        );
        return;
      }
      setAddress(addr);
      void linkAddress(addr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // User closing the wallet modal is not an error worth surfacing.
      if (!/cancel|denied|rejected|closed/i.test(msg)) {
        setError(msg || "Could not connect a Stacks wallet.");
      }
    } finally {
      setConnecting(false);
    }
  }, [network, linkAddress]);

  const disconnect = useCallback(async () => {
    try {
      stacksDisconnect();
    } catch {
      // Ignore; local storage is cleared regardless.
    }
    setAddress(null);
    void linkAddress(null);
  }, [linkAddress]);

  return {
    address,
    network,
    connected: Boolean(address),
    connecting,
    error,
    connect,
    disconnect,
  };
}
