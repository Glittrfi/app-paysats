import { prisma } from "@/lib/prisma";
import {
  stacksMcpAuthMessage,
  stacksUserSubject,
} from "@/lib/stacks/mcp-oauth";
import { isStacksAddress } from "@/services/stacks/agent-wallet";
import { ServiceError } from "@/services/errors";
import { verifyMessageSignatureRsv } from "@stacks/encryption";
import { publicKeyToAddress } from "@stacks/transactions";
import type { User as DbUser } from "@prisma/client";

export function verifyStacksMcpSignature(opts: {
  handle: string;
  address: string;
  signature: string;
  publicKey: string;
}): string {
  const address = opts.address.trim();
  if (!isStacksAddress(address)) {
    throw new ServiceError(400, "Invalid Stacks address");
  }
  const publicKey = opts.publicKey.trim();
  const signature = opts.signature.trim();
  if (!publicKey || !signature) {
    throw new ServiceError(400, "Missing Stacks signature");
  }

  const message = stacksMcpAuthMessage(opts.handle);
  const ok = verifyMessageSignatureRsv({
    message,
    signature,
    publicKey,
  });
  if (!ok) {
    throw new ServiceError(400, "Invalid Stacks signature");
  }

  const recovered = publicKeyToAddress(publicKey, "mainnet");
  if (recovered !== address) {
    throw new ServiceError(400, "Signature does not match this Stacks address");
  }
  return address;
}

/** Bind the MCP token to the PaySats user who linked this Leather wallet. */
export async function userFromLinkedStacksAddress(
  address: string,
): Promise<DbUser> {
  const existing = await prisma.user.findFirst({
    where: { stacksAddress: address },
    orderBy: { stacksLinkedAt: "desc" },
  });
  if (existing) return existing;

  return prisma.user.upsert({
    where: { privyUserId: stacksUserSubject(address) },
    create: {
      privyUserId: stacksUserSubject(address),
      stacksAddress: address,
      stacksNetwork: "mainnet",
      stacksLinkedAt: new Date(),
    },
    update: {
      stacksAddress: address,
      stacksNetwork: "mainnet",
      stacksLinkedAt: new Date(),
    },
  });
}
