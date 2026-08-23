import {
  BITFLOW_FEE_RECIPIENT,
  BITFLOW_HOSTS,
  BITFLOW_TOKEN_ID_SBTC,
  BITFLOW_TOKEN_ID_USDCX,
  assetIdentifier,
  usdcxToken,
} from "@/lib/stacks/config";
import { hiroFetch } from "@/lib/stacks/hiro";
import { ServiceError } from "@/services/errors";
import { getStacksBalances } from "@/services/stacks/balances";
import { getUsdcxToSbtcQuote } from "@/services/stacks/bitflow";
import {
  ActionType,
  BitflowSDK,
  KeeperContractStatus,
  KeeperType,
  type ActionFunctionArgs,
  type CreateGroupOrderParams,
  type KeeperContract,
  type KeeperGroupOrder,
  type KeeperMessageSigner,
  type KeeperOrder,
  type RouteQuote,
  type SignedRequestAuth,
} from "@bitflowlabs/core-sdk";

/** Runtime access to SDK helpers typed as private. */
type BitflowSdkInternals = {
  getQuoteForRoute: BitflowSDK["getQuoteForRoute"];
  transformRouteToActionArgs(route: RouteQuote): Promise<ActionFunctionArgs>;
};

let _sdk: BitflowSDK | undefined;

function getKeeperSdk(): BitflowSDK {
  if (!_sdk) {
    _sdk = new BitflowSDK({
      ...BITFLOW_HOSTS,
      BITFLOW_API_KEY: process.env.BITFLOW_API_KEY || undefined,
      READONLY_CALL_API_KEY: process.env.READONLY_CALL_API_KEY || undefined,
      KEEPER_API_KEY: process.env.KEEPER_API_KEY || undefined,
      BITFLOW_PROVIDER_ADDRESS: BITFLOW_FEE_RECIPIENT,
    });
  }
  return _sdk;
}

export type KeeperAuth = SignedRequestAuth;

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
  /** True when Bitflow's keeper-compatible filter has a direct route. */
  keeperRouteAvailable: boolean;
  note: string;
};

function tsToDate(
  ts?: { _seconds: number; _nanoseconds: number } | Date | string | null,
): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === "string") {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts._seconds === "number") {
    return new Date(ts._seconds * 1000);
  }
  return null;
}

/** Preview a prepaid DCA using the interactive Bitflow aggregator quote. */
export async function previewStacksDca(opts: {
  amountPerOrder: number;
  numberOfOrders: number;
  executionFrequency: number;
}): Promise<DcaPreview> {
  const { amountPerOrder, numberOfOrders, executionFrequency } = opts;
  if (!Number.isFinite(amountPerOrder) || amountPerOrder <= 0) {
    throw new ServiceError(400, "amountPerOrder must be a positive number");
  }
  if (
    !Number.isInteger(numberOfOrders) ||
    numberOfOrders < 2 ||
    numberOfOrders > 52
  ) {
    throw new ServiceError(400, "numberOfOrders must be an integer from 2 to 52");
  }
  if (!Number.isInteger(executionFrequency) || executionFrequency < 60) {
    throw new ServiceError(400, "executionFrequency must be at least 60 seconds");
  }

  const quote = await getUsdcxToSbtcQuote(amountPerOrder);
  const usdcx = usdcxToken("mainnet");
  const fundingAmountRaw = String(
    Math.round(amountPerOrder * numberOfOrders * 10 ** usdcx.decimals),
  );

  // Keeper's simple-path filter finds 0 routes for USDCx→sBTC (needs
  // STABLE_XY_4 + XYK). Group orders instead embed the full aggregator route
  // as actionFunctionArgs — preview marks that path as available when we can
  // transform the interactive quote.
  let keeperRouteAvailable = false;
  try {
    await buildKeeperSwapAction(amountPerOrder);
    keeperRouteAvailable = true;
  } catch {
    keeperRouteAvailable = false;
  }

  return {
    amountPerOrder,
    numberOfOrders,
    executionFrequency,
    fundingAmountRaw,
    fundingAmount: amountPerOrder * numberOfOrders,
    quotedOutSats: quote.amountOutSats,
    quotedOutSatsTotal: quote.amountOutSats * numberOfOrders,
    tokenXId: BITFLOW_TOKEN_ID_USDCX,
    tokenYId: BITFLOW_TOKEN_ID_SBTC,
    keeperRouteAvailable,
    note: keeperRouteAvailable
      ? "Each buy uses Bitflow’s multi-hop USDCx → sBTC route via your Keeper contract."
      : "Could not build a Keeper swap path for USDCx → sBTC right now. Try again shortly.",
  };
}

function actionTypeForDexPath(dexPath: string[]): ActionType {
  const lower = dexPath.map((d) => d.toLowerCase());
  const isXyk = lower.some((d) => d.includes("xyk"));
  const isStable = lower.some((d) => d.includes("stable"));
  if (isXyk && isStable) return ActionType.SWAP_XYK_STABLESWAP_SWAP_HELPER;
  if (isStable) return ActionType.SWAP_STABLESWAP_SWAP_HELPER;
  return ActionType.SWAP_XYK_SWAP_HELPER;
}

/**
 * Build Keeper actionFunctionArgs from the interactive aggregator quote.
 * actionAggregatorTokens cannot resolve USDCx→sBTC (multi-hop / STABLE_XY_4).
 */
export async function buildKeeperSwapAction(amountPerOrderHuman: number): Promise<{
  actionType: ActionType;
  actionFunctionArgs: ActionFunctionArgs;
  quotedOutSats: number;
}> {
  const sdk = getKeeperSdk() as unknown as BitflowSdkInternals;
  let result;
  try {
    result = await sdk.getQuoteForRoute(
      BITFLOW_TOKEN_ID_USDCX,
      BITFLOW_TOKEN_ID_SBTC,
      amountPerOrderHuman,
    );
  } catch (e) {
    throw new ServiceError(
      502,
      `Bitflow quote failed: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }
  const best = result.bestRoute;
  if (!best?.route || best.quote == null || best.quote <= 0) {
    throw new ServiceError(502, "No USDCx → sBTC route available on Bitflow");
  }
  try {
    const actionFunctionArgs = await sdk.transformRouteToActionArgs(best);
    return {
      actionType: actionTypeForDexPath(best.dexPath ?? []),
      actionFunctionArgs,
      quotedOutSats: Math.round(best.quote * 1e8),
    };
  } catch (e) {
    throw new ServiceError(
      502,
      `Could not build Keeper swap args: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }
}

export async function listKeeperContracts(
  stacksAddress: string,
): Promise<KeeperContract[]> {
  const sdk = getKeeperSdk();
  try {
    const res = await sdk.getKeeperContracts({ stacksAddress });
    return resolveKeeperContracts(res.keeperContracts ?? []);
  } catch (e) {
    throw new ServiceError(
      502,
      `Bitflow Keeper list failed: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }
}

export type KeeperContractPrepaid = {
  contractIdentifier: string;
  contractStatus: string;
  usdcxRaw: string;
  usdcx: number;
};

export type KeeperFundingCandidate = {
  txId: string;
  amountRaw: string;
  contractIdentifier: string;
};

export type KeeperPrepaidInfo = {
  contracts: KeeperContractPrepaid[];
  prepaidUsdcxRaw: string;
  prepaidUsdcx: number;
  fundingCandidates: KeeperFundingCandidate[];
};

type HiroFtTransfer = {
  asset_identifier?: string;
  amount?: string;
  sender?: string;
  recipient?: string;
};

type HiroTxWithTransfers = {
  tx?: { tx_id?: string; tx_status?: string };
  ft_transfers?: HiroFtTransfer[];
};

/**
 * USDCx sitting in the user's Bitflow keepers (failed/aborted prefunds) plus
 * optional recent inbound funding txs that can be reused for createGroupOrder.
 *
 * Funding-tx history is only fetched when `includeFundingTxs` is true to avoid
 * burning Hiro's unauthenticated 50 RPM quota on every page load.
 */
export async function getKeeperPrepaidInfo(
  stacksAddress: string,
  contracts: KeeperContract[],
  opts?: { includeFundingTxs?: boolean },
): Promise<KeeperPrepaidInfo> {
  const usdcx = usdcxToken("mainnet");
  const enriched: KeeperContractPrepaid[] = [];
  const fundingCandidates: KeeperFundingCandidate[] = [];
  const includeFundingTxs = opts?.includeFundingTxs === true;

  for (const c of contracts) {
    let usdcxRaw = "0";
    try {
      const bal = await getStacksBalances(c.contractIdentifier, "mainnet");
      usdcxRaw = bal.usdcxRaw;
    } catch {
      usdcxRaw = "0";
    }
    enriched.push({
      contractIdentifier: c.contractIdentifier,
      contractStatus: String(c.contractStatus),
      usdcxRaw,
      usdcx: Number(usdcxRaw) / 10 ** usdcx.decimals,
    });

    if (!includeFundingTxs) continue;

    try {
      const path = `/extended/v1/address/${encodeURIComponent(
        c.contractIdentifier,
      )}/transactions_with_transfers?limit=25`;
      const res = await hiroFetch(path, {
        network: "mainnet",
        cacheTtlMs: 30_000,
        retries: 2,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { results?: HiroTxWithTransfers[] };
      for (const row of json.results ?? []) {
        if (row.tx?.tx_status !== "success" || !row.tx.tx_id) continue;
        for (const ft of row.ft_transfers ?? []) {
          const asset = (ft.asset_identifier ?? "").toLowerCase();
          if (!asset.includes("usdcx")) continue;
          if (ft.sender !== stacksAddress) continue;
          if (ft.recipient !== c.contractIdentifier) continue;
          const amountRaw = ft.amount ?? "0";
          if (!/^\d+$/.test(amountRaw) || amountRaw === "0") continue;
          fundingCandidates.push({
            txId: row.tx.tx_id.startsWith("0x")
              ? row.tx.tx_id
              : `0x${row.tx.tx_id}`,
            amountRaw,
            contractIdentifier: c.contractIdentifier,
          });
        }
      }
    } catch {
      // Best-effort; balances alone are still useful.
    }
  }

  const prepaidUsdcxRaw = String(
    enriched.reduce(
      (sum, c) => sum + BigInt(c.usdcxRaw || "0"),
      BigInt(0),
    ),
  );
  return {
    contracts: enriched,
    prepaidUsdcxRaw,
    prepaidUsdcx: Number(prepaidUsdcxRaw) / 10 ** usdcx.decimals,
    fundingCandidates,
  };
}

/** Pick a prior funding tx that covers `amountRaw` for a given keeper. */
export function pickReusableFundingTx(
  candidates: KeeperFundingCandidate[],
  opts: { contractIdentifier: string; amountRaw: string },
): KeeperFundingCandidate | null {
  const need = BigInt(opts.amountRaw);
  const forKeeper = candidates.filter(
    (c) => c.contractIdentifier === opts.contractIdentifier,
  );
  const exact = forKeeper.find((c) => c.amountRaw === opts.amountRaw);
  if (exact) return exact;
  const cover = forKeeper
    .filter((c) => BigInt(c.amountRaw) >= need)
    .sort((a, b) => Number(BigInt(a.amountRaw) - BigInt(b.amountRaw)));
  return cover[0] ?? null;
}

const MAX_KEEPER_CONTRACTS = 2;

function keeperStatusRank(status: string): number {
  const s = status.toLowerCase();
  if (s.includes("success")) return 4;
  if (s.includes("pending") || s.includes("notstarted") || s.includes("retry"))
    return 3;
  if (s.includes("fail")) return 0;
  return 1;
}

export function isKeeperDeployed(contract: KeeperContract): boolean {
  return (
    contract.contractStatus ===
      KeeperContractStatus.ContractDeploymentSuccess ||
    String(contract.contractStatus).toLowerCase().includes("success")
  );
}

export function isKeeperUsable(contract: KeeperContract): boolean {
  return keeperStatusRank(String(contract.contractStatus)) >= 3;
}

/**
 * Bitflow sometimes leaves contractStatus stuck on
 * `contractDeploymentPending` even after the Clarity contract is live.
 * Confirm via Hiro before blocking the DCA flow.
 */
export async function isKeeperContractOnChain(
  contractIdentifier: string,
): Promise<boolean> {
  const [address, name] = contractIdentifier.split(".");
  if (!address || !name) return false;
  try {
    const res = await hiroFetch(
      `/v2/contracts/interface/${address}/${name}`,
      { network: "mainnet", cacheTtlMs: 60_000, retries: 2 },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Upgrade Bitflow "pending" keepers to success when they exist on-chain. */
export async function resolveKeeperContracts(
  contracts: KeeperContract[],
): Promise<KeeperContract[]> {
  return Promise.all(
    contracts.map(async (c) => {
      if (isKeeperDeployed(c)) return c;
      if (!String(c.contractStatus).toLowerCase().includes("pending")) {
        return c;
      }
      const onChain = await isKeeperContractOnChain(c.contractIdentifier);
      if (!onChain) return c;
      return {
        ...c,
        contractStatus: KeeperContractStatus.ContractDeploymentSuccess,
      };
    }),
  );
}

/** Prefer a successful MULTI_ACTION keeper; fall back to pending/deploying. */
export function pickMultiActionContract(
  contracts: KeeperContract[],
): KeeperContract | null {
  const multi = contracts.filter(
    (c) =>
      c.keeperType === KeeperType.MULTI_ACTION_V1 ||
      c.keeperType === KeeperType.MULTI_ACTION_V2 ||
      String(c.keeperType ?? "").includes("MULTI_ACTION"),
  );
  const pool = multi.length ? multi : contracts;
  const usable = pool
    .filter((c) => isKeeperUsable(c))
    .sort(
      (a, b) =>
        keeperStatusRank(String(b.contractStatus)) -
        keeperStatusRank(String(a.contractStatus)),
    );
  return usable[0] ?? pool[0] ?? null;
}

export async function createKeeperContract(opts: {
  stacksAddress: string;
  auth: KeeperAuth;
}): Promise<KeeperContract> {
  const sdk = getKeeperSdk();
  try {
    const res = await sdk.createKeeperContract(
      {
        stacksAddress: opts.stacksAddress,
        keeperType: KeeperType.MULTI_ACTION_V1,
        deployContract: true,
        allActionsApproved: true,
        auth: opts.auth,
      },
      undefined,
    );
    if (!res.keeperContract?.contractIdentifier) {
      throw new Error(res.error || "No keeper contract returned");
    }
    return res.keeperContract;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    // Bitflow caps users at 2 keepers — reuse whatever is already listed.
    if (/maximum of 2 keeper/i.test(msg)) {
      const existing = await listKeeperContracts(opts.stacksAddress);
      const preferred = pickMultiActionContract(existing);
      if (preferred) return preferred;
    }
    throw new ServiceError(502, `Bitflow createKeeperContract failed: ${msg}`);
  }
}

/** Ensure a usable keeper exists; never create when already at Bitflow's max. */
export async function ensureKeeperContract(opts: {
  stacksAddress: string;
  auth: KeeperAuth;
}): Promise<{ contract: KeeperContract; created: boolean }> {
  const existing = await listKeeperContracts(opts.stacksAddress);
  const preferred = pickMultiActionContract(existing);
  if (preferred && isKeeperUsable(preferred)) {
    return { contract: preferred, created: false };
  }
  if (existing.length >= MAX_KEEPER_CONTRACTS) {
    if (preferred) return { contract: preferred, created: false };
    throw new ServiceError(
      409,
      "Bitflow allows a maximum of 2 keeper contracts for this wallet, and none are usable. Cancel unused Keeper orders on Bitflow or wait for a pending deploy to finish.",
    );
  }
  const contract = await createKeeperContract(opts);
  return { contract, created: true };
}

export async function createDcaGroupOrder(opts: {
  stacksAddress: string;
  contractIdentifier: string;
  /** USDCx minor units (6 decimals). Bitflow requires a whole number. */
  amountPerOrderRaw: string;
  numberOfOrders: number;
  executionFrequency: number;
  fundingAmountRaw: string;
  fundingTxId: string;
  auth: KeeperAuth;
  minReceivedSats?: string;
}): Promise<KeeperGroupOrder> {
  const sdk = getKeeperSdk();
  // Bitflow Keeper API rejects fractional amountPerOrder (e.g. 0.05). Pass
  // USDCx minor units as an integer instead (0.05 USDCx → 50000).
  const amountPerOrderUnits = Number(opts.amountPerOrderRaw);
  if (
    !Number.isFinite(amountPerOrderUnits) ||
    !Number.isInteger(amountPerOrderUnits) ||
    amountPerOrderUnits <= 0
  ) {
    throw new ServiceError(400, "amountPerOrderRaw must be a positive integer");
  }

  const usdcx = usdcxToken("mainnet");
  const amountPerOrderHuman =
    amountPerOrderUnits / 10 ** usdcx.decimals;
  const { actionType, actionFunctionArgs } =
    await buildKeeperSwapAction(amountPerOrderHuman);
  // actionType selects the keeper-action trait; Bitflow examples omit
  // actionTrait inside actionFunctionArgs for createGroupOrder.
  const { actionTrait: _actionTrait, ...functionArgs } = actionFunctionArgs;
  void _actionTrait;
  // Keep minReceived at 0 + autoAdjust so Bitflow's executor can re-quote;
  // a tight sats floor often fails simulation on the multi-hop keeper path.
  const minReceived = opts.minReceivedSats ?? "0";

  const params: CreateGroupOrderParams = {
    stacksAddress: opts.stacksAddress,
    contractIdentifier: opts.contractIdentifier,
    amountPerOrder: amountPerOrderUnits,
    numberOfOrders: opts.numberOfOrders,
    executionFrequency: opts.executionFrequency,
    feeRecipient: BITFLOW_FEE_RECIPIENT,
    // Keeper API expects SIP-010 asset ids (`addr.contract::asset`), not
    // Bitflow SDK token ids like `token-USDCx-auto`.
    fundingTokens: {
      [assetIdentifier(usdcx)]: opts.fundingAmountRaw,
    },
    stacksTxId: opts.fundingTxId.replace(/^0x/, ""),
    // Do not use actionAggregatorTokens — Keeper API has no direct
    // USDCx→sBTC aggregator route. Pass the explicit multi-hop path instead.
    actionType,
    actionFunctionArgs: functionArgs,
    minReceived: {
      amount: minReceived,
      autoAdjust: true,
    },
    auth: opts.auth,
  };

  try {
    const res = await sdk.createGroupOrder(params);
    if (!res.keeperGroupOrder?.groupId) {
      throw new Error(res.error || "No group order returned");
    }
    return res.keeperGroupOrder;
  } catch (e) {
    throw new ServiceError(
      502,
      `Bitflow createGroupOrder failed: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }
}

export async function fetchGroupOrder(groupId: string): Promise<{
  group: KeeperGroupOrder;
  orders: KeeperOrder[];
}> {
  const sdk = getKeeperSdk();
  try {
    const res = await sdk.getGroupOrder(groupId, true);
    if (!res.groupOrder) {
      throw new Error(res.error || "Group order not found");
    }
    const group = res.groupOrder;
    const nested = (
      group as KeeperGroupOrder & { orders?: KeeperOrder[] }
    ).orders;
    if (Array.isArray(nested) && nested.length > 0) {
      return { group, orders: nested };
    }
    const orders: KeeperOrder[] = [];
    for (const orderId of group.orderIds ?? []) {
      try {
        const o = await sdk.getOrder(orderId);
        if (o.order) orders.push(o.order);
      } catch {
        // Skip individual fetch failures; group metadata is still useful.
      }
    }
    return { group, orders };
  } catch (e) {
    throw new ServiceError(
      502,
      `Bitflow getGroupOrder failed: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }
}

export async function cancelDcaGroupOrder(opts: {
  groupId: string;
  stacksAddress: string;
  auth: KeeperAuth;
}): Promise<void> {
  const sdk = getKeeperSdk();
  try {
    const res = await sdk.cancelGroupOrder(
      {
        groupId: opts.groupId,
        stacksAddress: opts.stacksAddress,
        auth: opts.auth,
      },
      undefined,
    );
    if (res.error || res.success === false) {
      throw new Error(res.error || "Cancel failed");
    }
  } catch (e) {
    throw new ServiceError(
      502,
      `Bitflow cancelGroupOrder failed: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }
}

export async function fetchKeeperUser(stacksAddress: string) {
  const sdk = getKeeperSdk();
  try {
    return await sdk.getUser(stacksAddress);
  } catch (e) {
    throw new ServiceError(
      502,
      `Bitflow getUser failed: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }
}

export function mapGroupStatus(opts: {
  remainingOrders?: number | string | null;
  numberOfOrders: number;
  cancelled?: boolean;
}): "active" | "completed" | "cancelled" {
  if (opts.cancelled) return "cancelled";
  const rem =
    opts.remainingOrders == null ? null : Number(opts.remainingOrders);
  if (rem === 0) return "completed";
  return "active";
}

export function groupNextExecution(
  group: KeeperGroupOrder,
): Date | null {
  return tsToDate(group.nextExecutionAfter);
}

export function executionTxId(order: KeeperOrder): string | null {
  const ids = order.txIds?.actionTxIds;
  if (Array.isArray(ids) && ids.length > 0) {
    const id = ids[ids.length - 1];
    return id.startsWith("0x") ? id : `0x${id}`;
  }
  return null;
}

export function mapOrderStatus(
  status: string,
): "pending" | "retrying" | "success" | "failed" {
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("success")) return "success";
  if (s.includes("fail") || s.includes("cancel")) return "failed";
  if (s.includes("retry")) return "retrying";
  return "pending";
}

export type BitflowBroadcastErrors = {
  actionCount?: number;
  actionFirstErrorAt?: { _seconds: number; _nanoseconds: number };
  actionLastErrorAt?: { _seconds: number; _nanoseconds: number };
};

export function orderBroadcastErrors(
  order: KeeperOrder,
): BitflowBroadcastErrors | null {
  const raw = (
    order as KeeperOrder & { broadcastErrors?: BitflowBroadcastErrors }
  ).broadcastErrors;
  if (!raw || typeof raw !== "object") return null;
  return raw;
}

/** Browser-only helper re-export for clients that want the SDK signer. */
export function createBrowserKeeperSigner(): KeeperMessageSigner {
  const sdk = getKeeperSdk();
  return sdk.createKeeperMessageSigner();
}

export { buildSignedRequestMessage } from "@bitflowlabs/core-sdk";
