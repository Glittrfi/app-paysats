/**
 * Production-safe Clarity value + post-condition builders.
 *
 * `@stacks/transactions` ships `Cl` and `Pc` as namespace re-exports
 * (`export * as Cl from './cl'`). Production bundlers can drop members of
 * those namespace objects, so `Cl.uint` / `Cl.serialize` end up undefined in
 * a production build while `next dev` works fine. Named exports
 * (`uintCV`, …) and plain post-condition objects have no such problem.
 *
 * `@stacks/connect` has the same issue internally; see
 * `patches/@stacks+connect+8.2.6.patch`.
 */
import {
  bufferCV,
  contractPrincipalCV,
  listCV,
  noneCV,
  principalCV,
  someCV,
  uintCV,
  type AssetString,
  type FungiblePostCondition,
  type StxPostCondition,
} from "@stacks/transactions";

type Comparator = "eq" | "gt" | "gte" | "lt" | "lte";
type Amount = bigint | number | string;

function bufferFromHex(hex: string) {
  const h = hex.replace(/^0x/i, "");
  if (h.length % 2 !== 0) {
    throw new Error("Clarity buffer hex must have even length");
  }
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bufferCV(bytes);
}

export const Cl = {
  uint: uintCV,
  none: noneCV,
  some: someCV,
  list: listCV,
  principal: principalCV,
  contractPrincipal: contractPrincipalCV,
  bufferFromHex,
};

function amountStep(address: string, condition: Comparator) {
  return (amount: Amount) => ({
    ustx: (): StxPostCondition => ({
      type: "stx-postcondition",
      address,
      condition,
      amount,
    }),
    ft: (contractId: string, tokenName: string): FungiblePostCondition => ({
      type: "ft-postcondition",
      address,
      condition,
      amount,
      asset: `${contractId}::${tokenName}` as AssetString,
    }),
  });
}

export const Pc = {
  principal(address: string) {
    return {
      willSendEq: amountStep(address, "eq"),
      willSendGt: amountStep(address, "gt"),
      willSendGte: amountStep(address, "gte"),
      willSendLt: amountStep(address, "lt"),
      willSendLte: amountStep(address, "lte"),
    };
  },
};
