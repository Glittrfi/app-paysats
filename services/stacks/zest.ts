import { callReadOnlyFunction } from "@/lib/stacks/clarity-read";
import {
  ZEST_ASSET_ID_SBTC,
  ZEST_ASSET_ID_USDCX,
  ZEST_CONTRACTS,
  ZEST_MAX_BORROW_LTV_RATIO,
  sbtcToken,
  stacksNetworkId,
  usdcxToken,
  type StacksNetworkId,
} from "@/lib/stacks/config";
import {
  deriveZestCreditHealth,
  maxZestSafeBorrowRaw,
  zestBuff2ToBps,
  zestBpsToPercent,
  zestCollateralUsd,
  zestDebtUsd,
  zestLiquidationBtcPrice,
  type ZestCreditHealth,
} from "@/lib/stacks/zest-credit";
import { ServiceError } from "@/services/errors";
import { fetchPythSpotPrices } from "@/services/stacks/pyth";
import { Cl, cvToJSON, cvToValue, type ClarityValue } from "@stacks/transactions";

export type ZestRiskParams = {
  ltvBorrowBps: number;
  ltvPartialBps: number;
  ltvFullBps: number;
  ltvBorrowPercent: number;
  ltvPartialPercent: number;
  ltvFullPercent: number;
};

export type ZestPosition = {
  address: string;
  network: StacksNetworkId;
  hasPosition: boolean;
  collateralSats: bigint;
  debtUsdcxRaw: bigint;
  collateralUsd: number;
  debtUsd: number;
  btcPriceUsd: number;
  usdcPriceUsd: number;
  risk: ZestRiskParams;
  health: ZestCreditHealth;
  maxBorrowRaw: bigint;
  maxAdditionalBorrowRaw: bigint;
  liquidationBtcPrice: number | null;
};

function asBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  if (v && typeof v === "object" && "value" in v) {
    return asBigInt((v as { value: unknown }).value);
  }
  return BigInt(0);
}

function unwrapResponse(cv: ClarityValue): {
  ok: boolean;
  value: unknown;
} {
  const j = cvToJSON(cv) as {
    success?: boolean;
    value?: unknown;
  };
  if (typeof j.success === "boolean") {
    return { ok: j.success, value: peelJson(j.value) };
  }
  return { ok: true, value: peelJson(j) };
}

function peelJson(j: unknown): unknown {
  if (j == null || typeof j !== "object") return j;
  const o = j as { type?: string; value?: unknown };
  if (typeof o.type === "string" && o.type.startsWith("(tuple") && o.value && typeof o.value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o.value as Record<string, unknown>)) {
      out[k] = peelJson(v);
    }
    return out;
  }
  if (Array.isArray(o.value)) return o.value.map(peelJson);
  if ("value" in o) return peelJson(o.value);
  return j;
}

const ZEST_INDEX_PRECISION = BigInt(1_000_000_000_000);

/** `resolve-safe` returns `(ok { id, account, mask, ... })`, not a bare uint. */
function positionIdFromResolve(value: unknown): bigint | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if ("id" in rec) {
      const id = asBigInt(rec.id);
      return id > BigInt(0) ? id : null;
    }
  }
  const id = asBigInt(value);
  return id > BigInt(0) ? id : null;
}

async function resolvePositionId(
  account: string,
  network: StacksNetworkId,
): Promise<bigint | null> {
  try {
    const cv = await callReadOnlyFunction({
      contract: ZEST_CONTRACTS.marketVault,
      functionName: "resolve-safe",
      functionArgs: [Cl.principal(account)],
      sender: account,
      network,
    });
    const { ok, value } = unwrapResponse(cv);
    if (!ok) return null;
    return positionIdFromResolve(value);
  } catch {
    return null;
  }
}

async function readVaultUint(
  account: string,
  network: StacksNetworkId,
  positionId: bigint,
  functionName: "get-collateral" | "debt-scaled",
  assetId: number,
): Promise<bigint> {
  try {
    const cv = await callReadOnlyFunction({
      contract: ZEST_CONTRACTS.marketVault,
      functionName,
      functionArgs: [Cl.uint(positionId), Cl.uint(assetId)],
      sender: account,
      network,
    });
    const raw = cvToValue(cv);
    if (
      raw &&
      typeof raw === "object" &&
      "scaled" in (raw as Record<string, unknown>)
    ) {
      return asBigInt((raw as { scaled: unknown }).scaled);
    }
    return asBigInt(raw);
  } catch {
    return BigInt(0);
  }
}

async function readUsdcxBorrowIndex(
  account: string,
  network: StacksNetworkId,
): Promise<bigint> {
  try {
    const cv = await callReadOnlyFunction({
      contract: ZEST_CONTRACTS.vaultUsdc,
      functionName: "get-index",
      functionArgs: [],
      sender: account,
      network,
    });
    const n = asBigInt(cvToValue(cv));
    return n > BigInt(0) ? n : ZEST_INDEX_PRECISION;
  } catch {
    return ZEST_INDEX_PRECISION;
  }
}

async function readRiskParams(
  sender: string,
  network: StacksNetworkId,
): Promise<ZestRiskParams> {
  const collMask = BigInt(1) << BigInt(ZEST_ASSET_ID_SBTC);
  const debtMask = BigInt(1) << BigInt(64 + ZEST_ASSET_ID_USDCX);
  const mask = collMask | debtMask;

  const cv = await callReadOnlyFunction({
    contract: ZEST_CONTRACTS.egroup,
    functionName: "resolve",
    functionArgs: [Cl.uint(mask)],
    sender,
    network,
  });

  const { ok, value } = unwrapResponse(cv);
  if (!ok || !value || typeof value !== "object") {
    throw new ServiceError(502, "Zest egroup resolve failed for sBTC/USDCx");
  }
  const t = value as Record<string, unknown>;
  const ltvBorrowBps = zestBuff2ToBps(String(t["LTV-BORROW"] ?? "0x0"));
  const ltvPartialBps = zestBuff2ToBps(String(t["LTV-LIQ-PARTIAL"] ?? "0x0"));
  const ltvFullBps = zestBuff2ToBps(String(t["LTV-LIQ-FULL"] ?? "0x0"));
  if (ltvBorrowBps < 1000 || ltvPartialBps < ltvBorrowBps) {
    throw new ServiceError(502, "Zest returned invalid sBTC/USDCx LTV params");
  }

  return {
    ltvBorrowBps,
    ltvPartialBps,
    ltvFullBps,
    ltvBorrowPercent: zestBpsToPercent(ltvBorrowBps),
    ltvPartialPercent: zestBpsToPercent(ltvPartialBps),
    ltvFullPercent: zestBpsToPercent(ltvFullBps),
  };
}

async function readCollateralAndDebt(
  account: string,
  network: StacksNetworkId,
): Promise<{ collateralSats: bigint; debtUsdcxRaw: bigint }> {
  const positionId = await resolvePositionId(account, network);
  if (positionId == null) {
    return { collateralSats: BigInt(0), debtUsdcxRaw: BigInt(0) };
  }
  const [collateralSats, scaledDebt, borrowIndex] = await Promise.all([
    readVaultUint(
      account,
      network,
      positionId,
      "get-collateral",
      ZEST_ASSET_ID_SBTC,
    ),
    readVaultUint(
      account,
      network,
      positionId,
      "debt-scaled",
      ZEST_ASSET_ID_USDCX,
    ),
    readUsdcxBorrowIndex(account, network),
  ]);
  // scaled * index / 1e12 → underlying USDCx (6 dp)
  const debtUsdcxRaw = (scaledDebt * borrowIndex) / ZEST_INDEX_PRECISION;
  return { collateralSats, debtUsdcxRaw };
}

export async function getZestPosition(
  address: string,
  network: StacksNetworkId = stacksNetworkId(),
): Promise<ZestPosition> {
  if (network !== "mainnet") {
    throw new ServiceError(400, "Zest borrow is mainnet-only");
  }

  const [prices, risk, balances] = await Promise.all([
    fetchPythSpotPrices(),
    readRiskParams(address, network),
    readCollateralAndDebt(address, network),
  ]);

  const { collateralSats, debtUsdcxRaw } = balances;
  const collateralUsd = zestCollateralUsd(collateralSats, prices.btcUsd);
  const debtUsd = zestDebtUsd(debtUsdcxRaw, prices.usdcUsd);
  const health = deriveZestCreditHealth(
    collateralUsd,
    debtUsd,
    risk.ltvBorrowBps,
    risk.ltvPartialBps,
  );

  const maxBorrowRaw = maxZestSafeBorrowRaw(
    collateralSats,
    prices.btcUsd,
    prices.usdcUsd,
    risk.ltvBorrowBps,
    ZEST_MAX_BORROW_LTV_RATIO,
  );
  const maxAdditionalBorrowRaw =
    maxBorrowRaw > debtUsdcxRaw ? maxBorrowRaw - debtUsdcxRaw : BigInt(0);

  return {
    address,
    network,
    hasPosition: collateralSats > BigInt(0) || debtUsdcxRaw > BigInt(0),
    collateralSats,
    debtUsdcxRaw,
    collateralUsd,
    debtUsd,
    btcPriceUsd: prices.btcUsd,
    usdcPriceUsd: prices.usdcUsd,
    risk,
    health,
    maxBorrowRaw,
    maxAdditionalBorrowRaw,
    liquidationBtcPrice: zestLiquidationBtcPrice(
      collateralSats,
      debtUsd,
      risk.ltvPartialBps,
    ),
  };
}

export type ZestPreview = {
  collateralSats: bigint;
  borrowUsdcxRaw: bigint;
  collateralUsd: number;
  debtUsd: number;
  projectedDebtUsd: number;
  projectedLtvPercent: number;
  health: ZestCreditHealth;
  maxBorrowRaw: bigint;
  withinLimit: boolean;
  btcPriceUsd: number;
  usdcPriceUsd: number;
  risk: ZestRiskParams;
  liquidationBtcPrice: number | null;
};

export async function previewZestBorrow(opts: {
  address: string;
  collateralSats: bigint;
  borrowUsdcxRaw: bigint;
  existingCollateralSats?: bigint;
  existingDebtRaw?: bigint;
  network?: StacksNetworkId;
}): Promise<ZestPreview> {
  const network = opts.network ?? stacksNetworkId();
  const live = await getZestPosition(opts.address, network);
  const prices = { btcUsd: live.btcPriceUsd, usdcUsd: live.usdcPriceUsd };
  const risk = live.risk;

  const baseCollateral =
    opts.existingCollateralSats ?? live.collateralSats;
  const baseDebt = opts.existingDebtRaw ?? live.debtUsdcxRaw;

  const totalCollateral = baseCollateral + opts.collateralSats;
  const totalDebt = baseDebt + opts.borrowUsdcxRaw;

  const collateralUsd = zestCollateralUsd(totalCollateral, prices.btcUsd);
  const debtUsd = zestDebtUsd(baseDebt, prices.usdcUsd);
  const projectedDebtUsd = zestDebtUsd(totalDebt, prices.usdcUsd);
  const projectedLtvPercent =
    collateralUsd > 0 ? (projectedDebtUsd / collateralUsd) * 100 : 0;

  const health = deriveZestCreditHealth(
    collateralUsd,
    projectedDebtUsd,
    risk.ltvBorrowBps,
    risk.ltvPartialBps,
  );

  const maxBorrowRaw = maxZestSafeBorrowRaw(
    totalCollateral,
    prices.btcUsd,
    prices.usdcUsd,
    risk.ltvBorrowBps,
    ZEST_MAX_BORROW_LTV_RATIO,
  );

  return {
    collateralSats: totalCollateral,
    borrowUsdcxRaw: opts.borrowUsdcxRaw,
    collateralUsd,
    debtUsd,
    projectedDebtUsd,
    projectedLtvPercent,
    health,
    maxBorrowRaw,
    withinLimit: totalDebt <= maxBorrowRaw,
    btcPriceUsd: prices.btcUsd,
    usdcPriceUsd: prices.usdcUsd,
    risk,
    liquidationBtcPrice: zestLiquidationBtcPrice(
      totalCollateral,
      projectedDebtUsd,
      risk.ltvPartialBps,
    ),
  };
}

/** Serialize bigint fields for JSON API responses. */
export function serializeZestPosition(pos: ZestPosition) {
  const sbtc = sbtcToken(pos.network);
  const usdcx = usdcxToken(pos.network);
  return {
    address: pos.address,
    network: pos.network,
    hasPosition: pos.hasPosition,
    collateralSats: pos.collateralSats.toString(),
    collateralBtc: Number(pos.collateralSats) / 10 ** sbtc.decimals,
    debtUsdcxRaw: pos.debtUsdcxRaw.toString(),
    debtUsdcx: Number(pos.debtUsdcxRaw) / 10 ** usdcx.decimals,
    collateralUsd: pos.collateralUsd,
    debtUsd: pos.debtUsd,
    btcPriceUsd: pos.btcPriceUsd,
    usdcPriceUsd: pos.usdcPriceUsd,
    risk: pos.risk,
    health: pos.health,
    maxBorrowRaw: pos.maxBorrowRaw.toString(),
    maxBorrowUsdcx: Number(pos.maxBorrowRaw) / 10 ** usdcx.decimals,
    maxAdditionalBorrowRaw: pos.maxAdditionalBorrowRaw.toString(),
    maxAdditionalBorrowUsdcx:
      Number(pos.maxAdditionalBorrowRaw) / 10 ** usdcx.decimals,
    liquidationBtcPrice: pos.liquidationBtcPrice,
    collateralToken: sbtc.contract,
    debtToken: usdcx.contract,
  };
}

export function serializeZestPreview(p: ZestPreview) {
  return {
    collateralSats: p.collateralSats.toString(),
    borrowUsdcxRaw: p.borrowUsdcxRaw.toString(),
    collateralUsd: p.collateralUsd,
    debtUsd: p.debtUsd,
    projectedDebtUsd: p.projectedDebtUsd,
    projectedLtvPercent: p.projectedLtvPercent,
    health: p.health,
    maxBorrowRaw: p.maxBorrowRaw.toString(),
    withinLimit: p.withinLimit,
    btcPriceUsd: p.btcPriceUsd,
    usdcPriceUsd: p.usdcPriceUsd,
    risk: p.risk,
    liquidationBtcPrice: p.liquidationBtcPrice,
  };
}
