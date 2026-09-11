import { VerificationClient } from "@/features/verification/verification-client";
import { isStacksVerification } from "@/services/mcp/host";
import { headers } from "next/headers";
import { Suspense } from "react";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{
    flavor?: string;
    complete?: string;
  }>;
}) {
  const { flavor, complete } = await searchParams;
  const host = await requestHost();
  const stacks = isStacksVerification(flavor ?? null, complete ?? null, host);
  return {
    title: stacks
      ? "Verify Stacks Agent — PaySats"
      : "Verify Agent Access — PaySats",
  };
}

async function requestHost(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-host") ||
    h.get("host") ||
    ""
  )
    .split(",")[0]
    .trim()
    .toLowerCase();
}

export default async function VerificationPage({
  searchParams,
}: {
  searchParams: Promise<{
    user_code?: string;
    handle?: string;
    complete?: string;
    flavor?: string;
  }>;
}) {
  const { user_code, handle, complete, flavor } = await searchParams;
  const host = await requestHost();
  const stacks = isStacksVerification(flavor ?? null, complete ?? null, host);
  return (
    <Suspense fallback={null}>
      <VerificationClient
        userCode={user_code ?? null}
        handle={handle ?? null}
        complete={complete ?? null}
        stacks={stacks}
      />
    </Suspense>
  );
}
