"use client";

import { fetchWithPrivy } from "@/lib/api";
import { ethereumAddressFromPrivyUser } from "@/lib/privy-destination-wallet";
import {
  usePrivy,
  useCreateWallet,
} from "@privy-io/react-auth";
import { useCallback, useLayoutEffect, useRef } from "react";

export function usePostLoginSync() {
  const { getAccessToken, authenticated, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const getAccessTokenRef = useRef(getAccessToken);
  useLayoutEffect(() => {
    getAccessTokenRef.current = getAccessToken;
  }, [getAccessToken]);

  const authenticatedRef = useRef(authenticated);
  useLayoutEffect(() => {
    authenticatedRef.current = authenticated;
  }, [authenticated]);

  const userRef = useRef(user);
  useLayoutEffect(() => {
    userRef.current = user;
  }, [user]);

  const createWalletRef = useRef(createWallet);
  useLayoutEffect(() => {
    createWalletRef.current = createWallet;
  }, [createWallet]);

  const lastSyncKey = useRef<string | null>(null);

  return useCallback(async (opts?: { skipIdrx?: boolean }) => {
    if (!authenticatedRef.current) return;

    const currentUser = userRef.current;
    const hasEmbeddedWallet = currentUser?.linkedAccounts?.some(
      (a) =>
        a.type === "wallet" &&
        "walletClientType" in a &&
        (a as { walletClientType?: string }).walletClientType === "privy",
    );

    if (!hasEmbeddedWallet) {
      try {
        await createWalletRef.current();
      } catch (e) {
        console.warn("Embedded wallet creation:", e);
      }
    }

    const tokenFn = getAccessTokenRef.current;

    const walletAddress = ethereumAddressFromPrivyUser(userRef.current);
    const key = walletAddress ?? "no-wallet";

    if (lastSyncKey.current !== key) {
      const res = await fetchWithPrivy(tokenFn, "/api/user/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(walletAddress ? { walletAddress } : {}),
      });
      if (!res.ok) return;
      lastSyncKey.current = key;
    }

    if (opts?.skipIdrx) return;

    const statusRes = await fetchWithPrivy(tokenFn, "/api/idrx/onboarding");
    const statusJson = (await statusRes.json().catch(() => ({}))) as {
      completed?: boolean;
    };
    if (!statusRes.ok || statusJson.completed) return;

    await fetchWithPrivy(tokenFn, "/api/idrx/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  }, []);
}
