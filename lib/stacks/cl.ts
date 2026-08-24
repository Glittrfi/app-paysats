/**
 * Production-safe Cl / Pc helpers.
 *
 * `@stacks/transactions` re-exports them as `export * as Cl from './cl'`.
 * Next.js production webpack + `sideEffects: false` tree-shakes that
 * namespace, so `Cl.uint` is undefined (`c.Cl.uint is not a function`).
 * Turbopack in `next dev` keeps the namespace, which is why DCA works
 * locally and fails in production.
 *
 * Named clarity builders (`uintCV`, …) are real exports and survive minify.
 */
import {
  bufferCV,
  contractPrincipalCV,
  listCV,
  noneCV,
  principalCV,
  someCV,
  uintCV,
} from "@stacks/transactions";
import { principal as pcPrincipal } from "@stacks/transactions/dist/pc";

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

export const Pc = {
  principal: pcPrincipal,
};
