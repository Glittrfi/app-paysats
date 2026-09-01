import {
  ZEST_CONTRACTS,
  ZEST_PYTH_FEE_USTX_MAX,
  sbtcToken,
  usdcxToken,
  type StacksNetworkId,
} from "@/lib/stacks/config";
import { Cl, Pc } from "@/lib/stacks/cl";
import type { ClarityValue } from "@stacks/transactions";

export type ZestTxKind =
  | "collateral_add"
  | "borrow"
  | "repay"
  | "collateral_remove";

function splitContract(contract: string): {
  contractAddress: string;
  contractName: string;
} {
  const [contractAddress, contractName] = contract.split(".");
  if (!contractAddress || !contractName) {
    throw new Error(`Invalid contract id: ${contract}`);
  }
  return { contractAddress, contractName };
}

function tokenPrincipalCv(
  token: ReturnType<typeof sbtcToken>,
): ClarityValue {
  const [contractAddress, contractName] = token.contract.split(".");
  return Cl.contractPrincipal(contractAddress, contractName);
}

/** Build optional Pyth price-feeds arg for Zest hot-path calls. */
export function zestPriceFeedsCv(hexBuffers: string[]): ClarityValue {
  if (!hexBuffers.length) return Cl.none();
  // The market's load-price-feeds asserts the list length is exactly 1.
  const bufs = hexBuffers.slice(0, 1).map((h) => {
    const hex = h.replace(/^0x/i, "");
    if (hex.length / 2 > 8192) {
      throw new Error("Pyth price update exceeds Zest's 8192-byte feed cap");
    }
    return Cl.bufferFromHex(hex);
  });
  return Cl.some(Cl.list(bufs));
}

function pythStxPostCondition(senderAddress: string, hasFeeds: boolean) {
  if (!hasFeeds) return [];
  return [
    Pc.principal(senderAddress).willSendLte(BigInt(ZEST_PYTH_FEE_USTX_MAX)).ustx(),
  ];
}

export function buildZestCollateralAddTx(opts: {
  senderAddress: string;
  amountSats: bigint;
  priceFeedHexes: string[];
  network?: StacksNetworkId;
}) {
  const sbtc = sbtcToken(opts.network ?? "mainnet");
  const market = splitContract(ZEST_CONTRACTS.market);
  const amount = opts.amountSats;
  if (amount <= BigInt(0)) throw new Error("Collateral amount must be positive");

  return {
    kind: "collateral_add" as const,
    contract: ZEST_CONTRACTS.market as `${string}.${string}`,
    contractAddress: market.contractAddress,
    contractName: market.contractName,
    functionName: "collateral-add",
    functionArgs: [
      tokenPrincipalCv(sbtc),
      Cl.uint(amount),
      zestPriceFeedsCv(opts.priceFeedHexes),
    ],
    postConditions: [
      ...pythStxPostCondition(opts.senderAddress, opts.priceFeedHexes.length > 0),
      Pc.principal(opts.senderAddress)
        .willSendEq(amount)
        .ft(sbtc.contract as `${string}.${string}`, sbtc.assetName),
    ],
    postConditionMode: "deny" as const,
    amountRaw: amount.toString(),
    token: sbtc.contract,
  };
}

export function buildZestBorrowTx(opts: {
  senderAddress: string;
  amountUsdcxRaw: bigint;
  priceFeedHexes: string[];
  network?: StacksNetworkId;
}) {
  const usdcx = usdcxToken(opts.network ?? "mainnet");
  const market = splitContract(ZEST_CONTRACTS.market);
  const amount = opts.amountUsdcxRaw;
  if (amount <= BigInt(0)) throw new Error("Borrow amount must be positive");

  return {
    kind: "borrow" as const,
    contract: ZEST_CONTRACTS.market as `${string}.${string}`,
    contractAddress: market.contractAddress,
    contractName: market.contractName,
    functionName: "borrow",
    functionArgs: [
      tokenPrincipalCv(usdcx),
      Cl.uint(amount),
      Cl.none(),
      zestPriceFeedsCv(opts.priceFeedHexes),
    ],
    postConditions: [
      ...pythStxPostCondition(opts.senderAddress, opts.priceFeedHexes.length > 0),
      // vault-usdc.system-borrow transfers USDCx from the vault, not the market.
      Pc.principal(ZEST_CONTRACTS.vaultUsdc)
        .willSendGte(amount)
        .ft(usdcx.contract as `${string}.${string}`, usdcx.assetName),
    ],
    postConditionMode: "deny" as const,
    amountRaw: amount.toString(),
    token: usdcx.contract,
  };
}

export function buildZestRepayTx(opts: {
  senderAddress: string;
  amountUsdcxRaw: bigint;
  network?: StacksNetworkId;
}) {
  const usdcx = usdcxToken(opts.network ?? "mainnet");
  const market = splitContract(ZEST_CONTRACTS.market);
  const amount = opts.amountUsdcxRaw;
  if (amount <= BigInt(0)) throw new Error("Repay amount must be positive");

  return {
    kind: "repay" as const,
    contract: ZEST_CONTRACTS.market as `${string}.${string}`,
    contractAddress: market.contractAddress,
    contractName: market.contractName,
    functionName: "repay",
    functionArgs: [
      tokenPrincipalCv(usdcx),
      Cl.uint(amount),
      Cl.none(),
    ],
    postConditions: [
      Pc.principal(opts.senderAddress)
        .willSendLte(amount)
        .ft(usdcx.contract as `${string}.${string}`, usdcx.assetName),
    ],
    postConditionMode: "deny" as const,
    amountRaw: amount.toString(),
    token: usdcx.contract,
  };
}

export function buildZestCollateralRemoveTx(opts: {
  senderAddress: string;
  amountSats: bigint;
  priceFeedHexes: string[];
  network?: StacksNetworkId;
}) {
  const sbtc = sbtcToken(opts.network ?? "mainnet");
  const market = splitContract(ZEST_CONTRACTS.market);
  const amount = opts.amountSats;
  if (amount <= BigInt(0)) throw new Error("Withdraw amount must be positive");

  return {
    kind: "collateral_remove" as const,
    contract: ZEST_CONTRACTS.market as `${string}.${string}`,
    contractAddress: market.contractAddress,
    contractName: market.contractName,
    functionName: "collateral-remove",
    functionArgs: [
      tokenPrincipalCv(sbtc),
      Cl.uint(amount),
      Cl.none(),
      zestPriceFeedsCv(opts.priceFeedHexes),
    ],
    postConditions: [
      ...pythStxPostCondition(opts.senderAddress, opts.priceFeedHexes.length > 0),
      // Isolated sBTC is held in market-vault and sent back on remove.
      Pc.principal(ZEST_CONTRACTS.marketVault)
        .willSendGte(amount)
        .ft(sbtc.contract as `${string}.${string}`, sbtc.assetName),
    ],
    postConditionMode: "deny" as const,
    amountRaw: amount.toString(),
    token: sbtc.contract,
  };
}
