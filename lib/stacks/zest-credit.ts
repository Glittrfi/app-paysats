/**
 * Pure helpers for Zest sBTC → USDCx borrow health (mirrors morpho-credit.ts).
 */

export const ZEST_SAFE_LTV_RATIO = 0.6;
export const ZEST_WARNING_LTV_RATIO = 0.8;
export const ZEST_CRITICAL_LTV_RATIO = 0.9;

export type ZestSafetyZone = "safe" | "warning" | "danger";

export type ZestCreditHealth = {
  healthFactor: number;
  ltvPercent: number;
  zone: ZestSafetyZone;
  safetyScore: number;
};

/** Decode Zest egroup LTV fields stored as (buff 2) basis points. */
export function zestBuff2ToBps(hex: string): number {
  const n = Number.parseInt(hex.replace(/^0x/i, ""), 16);
  return Number.isFinite(n) ? n : 0;
}

export function zestBpsToPercent(bps: number): number {
  return bps / 100;
}

/** Collateral USD value from sats and BTC/USD oracle price. */
export function zestCollateralUsd(
  collateralSats: bigint,
  btcPriceUsd: number,
): number {
  const btc = Number(collateralSats) / 1e8;
  return btc * btcPriceUsd;
}

/** Debt USD value from USDCx minor units and USDC/USD oracle price. */
export function zestDebtUsd(debtRaw: bigint, usdcPriceUsd: number): number {
  const usdc = Number(debtRaw) / 1e6;
  return usdc * usdcPriceUsd;
}

export function computeZestLtvPercent(
  collateralUsd: number,
  debtUsd: number,
): number {
  if (collateralUsd <= 0 || debtUsd <= 0) return 0;
  return (debtUsd / collateralUsd) * 100;
}

/**
 * Health factor vs partial-liquidation LTV (> 1 = above partial liq threshold).
 */
export function computeZestHealthFactor(
  collateralUsd: number,
  debtUsd: number,
  ltvPartialBps: number,
): number {
  if (debtUsd <= 0) return Infinity;
  const threshold = ltvPartialBps / 10000;
  return (collateralUsd * threshold) / debtUsd;
}

export function deriveZestCreditHealth(
  collateralUsd: number,
  debtUsd: number,
  ltvBorrowBps: number,
  ltvPartialBps: number,
): ZestCreditHealth {
  const ltvPercent = computeZestLtvPercent(collateralUsd, debtUsd);
  const healthFactor = computeZestHealthFactor(
    collateralUsd,
    debtUsd,
    ltvPartialBps,
  );

  const maxLtvPercent = zestBpsToPercent(ltvBorrowBps);
  const ltvRatio = maxLtvPercent > 0 ? ltvPercent / maxLtvPercent : 0;

  let zone: ZestSafetyZone;
  if (ltvRatio <= ZEST_SAFE_LTV_RATIO) zone = "safe";
  else if (ltvRatio <= ZEST_WARNING_LTV_RATIO) zone = "warning";
  else zone = "danger";

  const safetyScore = Math.max(
    0,
    Math.min(100, Math.round((1 - ltvRatio) * 100)),
  );

  return { healthFactor, ltvPercent, zone, safetyScore };
}

/** Max USDCx borrow (minor units) at the conservative UI cap. */
export function maxZestSafeBorrowRaw(
  collateralSats: bigint,
  btcPriceUsd: number,
  usdcPriceUsd: number,
  ltvBorrowBps: number,
  maxBorrowRatio: number,
): bigint {
  const collateralUsd = zestCollateralUsd(collateralSats, btcPriceUsd);
  if (collateralUsd <= 0) return BigInt(0);
  const maxUsd =
    collateralUsd * (ltvBorrowBps / 10000) * maxBorrowRatio;
  const usdcHuman = maxUsd / usdcPriceUsd;
  if (!Number.isFinite(usdcHuman) || usdcHuman <= 0) return BigInt(0);
  return BigInt(Math.floor(usdcHuman * 1e6));
}

/** BTC price (USD) at which partial liquidation begins. */
export function zestLiquidationBtcPrice(
  collateralSats: bigint,
  debtUsd: number,
  ltvPartialBps: number,
): number | null {
  const btc = Number(collateralSats) / 1e8;
  if (btc <= 0 || debtUsd <= 0) return null;
  const threshold = ltvPartialBps / 10000;
  return debtUsd / (btc * threshold);
}
