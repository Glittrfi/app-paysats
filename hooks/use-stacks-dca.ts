"use client";

import { fetchWithPrivy } from "@/lib/api";
import {
  BITFLOW_TOKEN_ID_USDCX,
  STACKS_DCA_INTERVALS,
  assetIdentifier,
  publicStacksKeeperAddress,
  stacksNetworkId,
  usdcxToken,
  type StacksDcaIntervalId,
} from "@/lib/stacks/config";
import { fetchStacksTxStatus } from "@/lib/stacks/tx";
import { buildSignedRequestMessage } from "@bitflowlabs/core-sdk";
import { usePrivy } from "@privy-io/react-auth";
import { openSignatureRequestPopup, request as stacksRequest } from "@stacks/connect";
import { Cl, Pc } from "@stacks/transactions";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type DcaPreview = {
  amountPerOrder: number;
  numberOfOrders: number;
  executionFrequency: number;
  fundingAmountRaw: string;
  fundingAmount: number;
  quotedOutSats: number;
  quotedOutSatsTotal: number;
  tokenXId: string;
  tokenYId: string;
  keeperAddress: string;
  note: string;
};

export type StacksDcaOrder = {
  id: string;
  stacksAddress: string;
  network: string;
  groupId: string | null;
  keeperContractId: string;
  amountPerOrderRaw: string;
  numberOfOrders: number;
  executionFrequency: number;
  fundingAmountRaw: string;
  fundingTxId: string | null;
  quotedOutRaw: string | null;
  status: string;
  nextExecutionAt: string | null;
  remainingOrders: number | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StacksDcaExecution = {
  id: string;
  bitflowOrderId: string | null;
  txId: string | null;
  payoutTxId?: string | null;
  amountInRaw: string | null;
  amountOutRaw: string | null;
  status: string;
  executedAt: string | null;
  createdAt: string;
};

export type KeeperAuth = {
  timestamp: number;
  signature: string;
  publicKey: string;
};

type KeeperInfo = {
  contractIdentifier: string;
  contractStatus: string;
  usdcxRaw?: string;
};

export type KeeperContractBalance = {
  contractIdentifier: string;
  contractStatus: string;
  usdcxRaw: string;
  usdcx: number;
};

/**
 * Sign a Bitflow Keeper authorization message. Only used to cancel leftover
 * Bitflow group orders from the earlier keeper spike.
 */
async function signKeeperAuth(opts: {
  action: "cancelGroupOrder";
  stacksAddress: string;
  resourceKey: string;
  resourceId: string;
}): Promise<KeeperAuth> {
  const timestamp = Date.now();
  const message = buildSignedRequestMessage(
    opts.action,
    opts.stacksAddress,
    opts.resourceKey,
    opts.resourceId,
    timestamp,
  );
  return new Promise((resolve, reject) => {
    void openSignatureRequestPopup({
      message,
      onFinish: (data) => {
        resolve({
          timestamp,
          signature: data.signature,
          publicKey: data.publicKey,
        });
      },
      onCancel: () => reject(new Error("Signature cancelled")),
    });
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function useStacksDca(stacksAddress: string | null) {
  const network = stacksNetworkId();
  const { getAccessToken } = usePrivy();
  const tokenRef = useRef(getAccessToken);
  useLayoutEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);

  const [preview, setPreview] = useState<DcaPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);

  const [keeper, setKeeper] = useState<KeeperInfo | null>(null);
  const [keeperContracts, setKeeperContracts] = useState<
    KeeperContractBalance[]
  >([]);
  const [prepaidUsdcx, setPrepaidUsdcx] = useState(0);
  const [prepaidUsdcxRaw, setPrepaidUsdcxRaw] = useState("0");
  const [orders, setOrders] = useState<StacksDcaOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    | "idle"
    | "funding"
    | "confirming"
    | "withdrawing"
    | "signing"
    | "done"
  >("idle");
  const [fundingTxId, setFundingTxId] = useState<string | null>(null);
  const [fundedAmountRaw, setFundedAmountRaw] = useState<string | null>(null);

  const keeperAddress =
    preview?.keeperAddress ?? publicStacksKeeperAddress();

  const refreshOrders = useCallback(async () => {
    if (!stacksAddress) {
      setOrders([]);
      return;
    }
    try {
      const res = await fetchWithPrivy(tokenRef.current, "/api/stacks/dca/order");
      const json = (await res.json().catch(() => ({}))) as {
        orders?: StacksDcaOrder[];
      };
      setOrders(json.orders ?? []);
    } catch {
      // ignore
    }
  }, [stacksAddress]);

  const refreshKeeper = useCallback(async () => {
    if (!stacksAddress) {
      setKeeper(null);
      setKeeperContracts([]);
      setPrepaidUsdcx(0);
      setPrepaidUsdcxRaw("0");
      return;
    }
    try {
      const qs = new URLSearchParams({ stacksAddress });
      const res = await fetchWithPrivy(
        tokenRef.current,
        `/api/stacks/dca/keeper?${qs}`,
      );
      const json = (await res.json().catch(() => ({}))) as {
        preferred?: KeeperInfo | null;
        contracts?: KeeperContractBalance[];
        prepaidUsdcx?: number;
        prepaidUsdcxRaw?: string;
      };
      setKeeper(json.preferred ?? null);
      setKeeperContracts(json.contracts ?? []);
      setPrepaidUsdcx(json.prepaidUsdcx ?? 0);
      setPrepaidUsdcxRaw(json.prepaidUsdcxRaw ?? "0");
    } catch {
      // ignore
    }
  }, [stacksAddress]);

  useEffect(() => {
    void refreshOrders();
    void refreshKeeper();
  }, [refreshOrders, refreshKeeper]);

  const inflight = orders.some((o) =>
    ["active", "executing", "cancelling", "pending_funding"].includes(o.status),
  );

  useEffect(() => {
    if (!stacksAddress || !inflight) return;
    const id = setInterval(() => {
      void refreshOrders();
    }, 8_000);
    return () => clearInterval(id);
  }, [stacksAddress, inflight, refreshOrders]);

  const fetchPreview = useCallback(
    async (opts: {
      amountPerOrder: number;
      numberOfOrders: number;
      intervalId: StacksDcaIntervalId;
    }) => {
      const freq =
        STACKS_DCA_INTERVALS.find((i) => i.id === opts.intervalId)?.seconds ??
        86_400;
      setQuoting(true);
      setPreviewError(null);
      try {
        const qs = new URLSearchParams({
          amountPerOrder: String(opts.amountPerOrder),
          numberOfOrders: String(opts.numberOfOrders),
          executionFrequency: String(freq),
        }).toString();
        const res = await fetchWithPrivy(
          tokenRef.current,
          `/api/stacks/dca/quote?${qs}`,
        );
        const json = (await res.json().catch(() => ({}))) as
          | DcaPreview
          | { error?: string };
        if (!res.ok || "error" in json) {
          setPreview(null);
          setPreviewError(
            ("error" in json && json.error) || "Failed to preview DCA",
          );
          return null;
        }
        setPreview(json as DcaPreview);
        return json as DcaPreview;
      } catch {
        setPreview(null);
        setPreviewError("Failed to preview DCA");
        return null;
      } finally {
        setQuoting(false);
      }
    },
    [],
  );

  /** Transfer prepaid USDCx from the user wallet to the PaySats keeper address. */
  const fundKeeper = useCallback(
    async (opts: {
      keeperAddress: string;
      fundingAmountRaw: string;
    }): Promise<string> => {
      if (!stacksAddress) throw new Error("Connect a Stacks wallet first");
      setPhase("funding");
      const usdcx = usdcxToken(network);
      const [contractAddress, contractName] = usdcx.contract.split(".");
      const amount = BigInt(opts.fundingAmountRaw);

      const result = await stacksRequest("stx_callContract", {
        contract: `${contractAddress}.${contractName}` as `${string}.${string}`,
        functionName: "transfer",
        functionArgs: [
          Cl.uint(amount),
          Cl.principal(stacksAddress),
          Cl.principal(opts.keeperAddress),
          Cl.none(),
        ],
        postConditions: [
          Pc.principal(stacksAddress)
            .willSendEq(amount)
            .ft(usdcx.contract as `${string}.${string}`, usdcx.assetName),
        ],
        postConditionMode: "deny",
        network,
        address: stacksAddress as `S${string}`,
      });

      const id =
        (typeof result?.txid === "string" && result.txid) ||
        (typeof (result as { txId?: string })?.txId === "string" &&
          (result as { txId: string }).txId) ||
        null;
      if (!id) throw new Error("Wallet did not return a funding transaction id");
      const normalized = id.startsWith("0x") ? id : `0x${id}`;
      setFundingTxId(normalized);
      setFundedAmountRaw(opts.fundingAmountRaw);
      return normalized;
    },
    [stacksAddress, network],
  );

  const createOrder = useCallback(
    async (opts: {
      amountPerOrder: number;
      numberOfOrders: number;
      intervalId: StacksDcaIntervalId;
      quotedOutRaw?: string;
    }): Promise<StacksDcaOrder> => {
      if (!stacksAddress) throw new Error("Connect a Stacks wallet first");
      setBusy(true);
      setError(null);
      try {
        const freq =
          STACKS_DCA_INTERVALS.find((i) => i.id === opts.intervalId)?.seconds ??
          86_400;
        const quoted =
          preview ??
          (await fetchPreview({
            amountPerOrder: opts.amountPerOrder,
            numberOfOrders: opts.numberOfOrders,
            intervalId: opts.intervalId,
          }));
        if (!quoted) throw new Error("Could not quote DCA");
        if (!quoted.keeperAddress) {
          throw new Error("PaySats keeper address is not configured");
        }

        const txId =
          fundingTxId && fundedAmountRaw === quoted.fundingAmountRaw
            ? fundingTxId
            : await fundKeeper({
                keeperAddress: quoted.keeperAddress,
                fundingAmountRaw: quoted.fundingAmountRaw,
              });

        setPhase("confirming");
        const confirmDeadline = Date.now() + 180_000;
        let fundingStatus = await fetchStacksTxStatus(txId, network);
        while (fundingStatus === "pending" && Date.now() < confirmDeadline) {
          await sleep(4_000);
          fundingStatus = await fetchStacksTxStatus(txId, network);
        }
        if (fundingStatus === "failed") {
          throw new Error("Funding transaction failed on Stacks");
        }
        if (fundingStatus !== "success") {
          throw new Error(
            "Funding is still confirming on Stacks. Wait a minute and tap Confirm again — you will not be charged twice.",
          );
        }

        let lastError = "Failed to create DCA order";
        for (let i = 0; i < 8; i++) {
          const res = await fetchWithPrivy(
            tokenRef.current,
            "/api/stacks/dca/order",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                stacksAddress,
                amountPerOrder: opts.amountPerOrder,
                numberOfOrders: opts.numberOfOrders,
                executionFrequency: freq,
                fundingTxId: txId,
                quotedOutRaw:
                  opts.quotedOutRaw ?? String(quoted.quotedOutSats),
              }),
            },
          );
          const json = (await res.json().catch(() => ({}))) as {
            order?: StacksDcaOrder;
            error?: string;
          };
          if (res.ok && json.order) {
            setFundingTxId(null);
            setFundedAmountRaw(null);
            setPhase("done");
            await refreshOrders();
            return json.order;
          }
          lastError = json.error || lastError;
          if (res.status !== 409) {
            throw new Error(lastError);
          }
          await sleep(5_000);
        }
        throw new Error(
          lastError ||
            "Funding is still confirming. Wait a minute and try Confirm again.",
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "DCA setup failed";
        if (!/cancel|denied|rejected/i.test(msg)) setError(msg);
        setPhase("idle");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [
      stacksAddress,
      preview,
      fundKeeper,
      fetchPreview,
      refreshOrders,
      fundingTxId,
      fundedAmountRaw,
      network,
    ],
  );

  /** Withdraw leftover USDCx from old Bitflow keeper contracts. */
  const withdrawPrepaid = useCallback(async () => {
    if (!stacksAddress) throw new Error("Connect a Stacks wallet first");
    setBusy(true);
    setError(null);
    setPhase("withdrawing");
    try {
      const qs = new URLSearchParams({ stacksAddress }).toString();
      const res = await fetchWithPrivy(
        tokenRef.current,
        `/api/stacks/dca/keeper?${qs}`,
      );
      const json = (await res.json().catch(() => ({}))) as {
        contracts?: KeeperContractBalance[];
      };
      const withFunds = (json.contracts ?? []).filter(
        (c) => BigInt(c.usdcxRaw || "0") > BigInt(0),
      );
      if (withFunds.length === 0) {
        throw new Error("No prepaid USDCx in your old Bitflow keeper contracts");
      }

      const usdcx = usdcxToken(network);
      const [tokenAddress, tokenName] = usdcx.contract.split(".");
      if (!tokenAddress || !tokenName) {
        throw new Error("Invalid USDCx contract");
      }

      for (const c of withFunds) {
        const [keeperAddr, keeperName] = c.contractIdentifier.split(".");
        if (!keeperAddr || !keeperName) continue;
        const amount = BigInt(c.usdcxRaw);
        await stacksRequest("stx_callContract", {
          contract: `${keeperAddr}.${keeperName}` as `${string}.${string}`,
          functionName: "withdraw-tokens",
          functionArgs: [
            Cl.contractPrincipal(tokenAddress, tokenName),
            Cl.uint(amount),
            Cl.principal(stacksAddress),
          ],
          postConditions: [
            Pc.principal(`${keeperAddr}.${keeperName}`)
              .willSendEq(amount)
              .ft(usdcx.contract as `${string}.${string}`, usdcx.assetName),
          ],
          postConditionMode: "deny",
          network,
          address: stacksAddress as `S${string}`,
        });
      }

      setFundingTxId(null);
      setPhase("idle");
      await refreshKeeper();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Withdraw failed";
      if (!/cancel|denied|rejected/i.test(msg)) setError(msg);
      setPhase("idle");
      throw e;
    } finally {
      setBusy(false);
    }
  }, [stacksAddress, network, refreshKeeper]);

  const cancelOrder = useCallback(
    async (orderId: string, groupId: string | null) => {
      if (!stacksAddress) throw new Error("Connect a Stacks wallet first");
      setBusy(true);
      setError(null);
      try {
        let auth: KeeperAuth | undefined;
        if (groupId) {
          setPhase("signing");
          auth = await signKeeperAuth({
            action: "cancelGroupOrder",
            stacksAddress,
            resourceKey: "groupId",
            resourceId: groupId,
          });
        }
        const res = await fetchWithPrivy(
          tokenRef.current,
          `/api/stacks/dca/order/${orderId}/cancel`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ auth }),
          },
        );
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || "Cancel failed");
        setPhase("idle");
        await refreshOrders();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Cancel failed";
        if (!/cancel|denied|rejected/i.test(msg)) setError(msg);
        setPhase("idle");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [stacksAddress, refreshOrders],
  );

  const fetchOrderDetail = useCallback(
    async (
      orderId: string,
    ): Promise<{
      order: StacksDcaOrder;
      executions: StacksDcaExecution[];
      bitflow?: { broadcastFailCount?: number; anyRetrying?: boolean };
    } | null> => {
      try {
        const res = await fetchWithPrivy(
          tokenRef.current,
          `/api/stacks/dca/order/${orderId}`,
        );
        const json = (await res.json().catch(() => ({}))) as {
          order?: StacksDcaOrder;
          executions?: StacksDcaExecution[];
          bitflow?: { broadcastFailCount?: number; anyRetrying?: boolean };
          error?: string;
        };
        if (!res.ok || !json.order) return null;
        return {
          order: json.order,
          executions: json.executions ?? [],
          bitflow: json.bitflow,
        };
      } catch {
        return null;
      }
    },
    [],
  );

  return {
    preview,
    previewError,
    quoting,
    fetchPreview,
    keeper,
    keeperAddress,
    keeperContracts,
    prepaidUsdcx,
    prepaidUsdcxRaw,
    orders,
    busy,
    error,
    phase,
    fundingTxId,
    createOrder,
    cancelOrder,
    withdrawPrepaid,
    refreshOrders,
    refreshKeeper,
    fetchOrderDetail,
    tokenIdUsdcx: BITFLOW_TOKEN_ID_USDCX,
    assetId: assetIdentifier(usdcxToken(network)),
  };
}
