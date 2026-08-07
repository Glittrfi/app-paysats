"use client";

import { Card } from "@/components/ui/card";
import { fetchWithPrivy } from "@/lib/api";
import { useDisplayUnit } from "@/lib/display-unit";
import { useLocale, useT } from "@/lib/i18n";
import { stacksExplorerTxUrl } from "@/lib/stacks/config";
import type { MintTransaction } from "@/types/transaction";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityRow,
  relativeTime,
  type ActivityItem,
} from "./activity-row";
import { summarizeMint, summarizePayment } from "./status-map";

type StacksSwapTx = {
  id: string;
  txId: string;
  network: string;
  amountInRaw: string;
  amountOutRaw: string | null;
  status: string;
  createdAt: string;
};

function BackHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-12">
      <Link
        href="/home"
        aria-label="Back"
        data-pressable
        className="flex h-10 w-10 items-center justify-center rounded-[12px]"
        style={{
          background: "var(--paysats-surface)",
          boxShadow: "var(--paysats-shadow-card)",
          color: "var(--paysats-text)",
        }}
      >
        ←
      </Link>
      <div
        className="text-lg font-extrabold"
        style={{ color: "var(--paysats-text)", letterSpacing: -0.4 }}
      >
        {title}
      </div>
    </div>
  );
}

function shortenAddr(a: string) {
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{
        transform: `rotate(${open ? 180 : 0}deg)`,
        transition: "transform 160ms ease",
        color: "var(--paysats-text-faint)",
      }}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span
        className="text-[11px]"
        style={{ color: "var(--paysats-text-faint)" }}
      >
        {label}
      </span>
      <span
        className={`max-w-[62%] truncate text-right text-[12px] font-semibold ${mono ? "font-mono" : ""}`}
        style={{ color: "var(--paysats-text)" }}
      >
        {value}
      </span>
    </div>
  );
}

function TxActivityItem({
  tx,
  item,
  localeStr,
}: {
  tx: MintTransaction;
  item: ActivityItem;
  localeStr: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <ActivityRow item={item} />
        </div>
        <Chevron open={open} />
      </button>

      {open ? (
        <div
          className="mb-3 mt-1 rounded-[12px] px-3 py-2"
          style={{ background: "var(--paysats-surface-muted)" }}
        >
          <DetailRow
            label={t("tx.destWallet")}
            value={shortenAddr(tx.destinationWalletAddress)}
            mono
          />
          {tx.reference ? (
            <DetailRow
              label={t("tx.reference")}
              value={tx.reference}
              mono
            />
          ) : null}
          {tx.merchantOrderId ? (
            <DetailRow
              label={t("tx.merchantOrder")}
              value={tx.merchantOrderId}
              mono
            />
          ) : null}
          <DetailRow
            label={t("tx.createdAt")}
            value={new Date(tx.createdAt).toLocaleString(localeStr)}
          />
          {tx.txHash ? (
            <DetailRow
              label={t("tx.txHash")}
              value={
                <a
                  href={`https://basescan.org/tx/${tx.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono"
                  style={{ color: "var(--paysats-accent)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {shortenAddr(tx.txHash)} ↗
                </a>
              }
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ActivityClient() {
  const { getAccessToken, ready, authenticated } = usePrivy();
  const searchParams = useSearchParams();
  const merchantOrderId = searchParams.get("merchantOrderId")?.trim() ?? "";
  const t = useT();
  const { locale } = useLocale();
  const { format: formatUnit, label: unitLabel } = useDisplayUnit();
  const localeStr = locale === "id" ? "id-ID" : "en-US";
  const [items, setItems] = useState<MintTransaction[] | null>(null);
  const [stacksSwaps, setStacksSwaps] = useState<StacksSwapTx[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setReloading(true);
    const q = new URLSearchParams({ page: "1", take: "20" });
    if (merchantOrderId) q.set("merchantOrderId", merchantOrderId);

    const [mintRes, stacksRes] = await Promise.allSettled([
      (async () => {
        const res = await fetchWithPrivy(
          getAccessToken,
          `/api/idrx/transactions?${q.toString()}`,
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(j.error || t("activity.failedLoad"));
        }
        return (j.transactions ?? []) as MintTransaction[];
      })(),
      (async () => {
        const res = await fetchWithPrivy(
          getAccessToken,
          "/api/stacks/swap/record",
        );
        const j = (await res.json().catch(() => ({}))) as {
          swaps?: StacksSwapTx[];
          error?: string;
        };
        if (!res.ok) return [] as StacksSwapTx[];
        return j.swaps ?? [];
      })(),
    ]);

    setReloading(false);
    if (mintRes.status === "fulfilled") {
      setItems(mintRes.value);
    } else {
      setError(
        mintRes.reason instanceof Error
          ? mintRes.reason.message
          : t("activity.failedLoad"),
      );
      setItems([]);
    }
    setStacksSwaps(
      stacksRes.status === "fulfilled" ? stacksRes.value : [],
    );
  }, [getAccessToken, merchantOrderId, t]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, load]);

  type FeedRow =
    | { kind: "mint"; tx: MintTransaction; item: ActivityItem; sortAt: number }
    | { kind: "stacks"; swap: StacksSwapTx; item: ActivityItem; sortAt: number };

  const rows = useMemo(() => {
    if (items === null && stacksSwaps === null) return null;
    const tFn = t as (k: string) => string;
    const out: FeedRow[] = [];

    for (const swap of stacksSwaps ?? []) {
      const usd = Number(swap.amountInRaw) / 1e6;
      const sats =
        swap.amountOutRaw != null ? Number(swap.amountOutRaw) : null;
      const statusLabel =
        swap.status === "success"
          ? t("tx.stacksSuccess")
          : swap.status === "failed"
            ? t("tx.stacksFailed")
            : t("tx.stacksPending");
      out.push({
        kind: "stacks",
        swap,
        sortAt: new Date(swap.createdAt).getTime(),
        item: {
          id: `stacks-${swap.id}`,
          type: "buy",
          title: t("tx.usdcxToSbtc"),
          subtitle: `${relativeTime(swap.createdAt)} · ${statusLabel}`,
          primary:
            sats != null ? `+${formatUnit(sats)} ${unitLabel}` : "+sBTC",
          secondary: `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
          tone:
            swap.status === "success"
              ? "accent"
              : swap.status === "failed"
                ? "danger"
                : "warning",
        },
      });
    }

    for (const tx of items ?? []) {
      const adminUpper = tx.adminMintStatus.toUpperCase();
      const userUpper = tx.userMintStatus.toUpperCase();
      const minted = adminUpper.includes("MINT") && !adminUpper.includes("NOT");
      const failed =
        adminUpper.includes("FAIL") || userUpper.includes("FAIL");
      const tone: ActivityItem["tone"] = failed
        ? "danger"
        : minted
          ? "success"
          : "warning";
      const status = tx.settlement?.summaryKey
        ? tFn(tx.settlement.summaryKey)
        : minted
          ? summarizeMint(tx.adminMintStatus, tx.userMintStatus, tFn)
          : summarizePayment(tx.paymentStatus, tFn);
      out.push({
        kind: "mint",
        tx,
        sortAt: new Date(tx.createdAt).getTime(),
        item: {
          id: tx.id,
          type: "in",
          title: t("tx.idrxDeposit"),
          subtitle: `${relativeTime(tx.createdAt)} · ${status}`,
          primary: `+Rp ${Number(tx.paymentAmount).toLocaleString(localeStr)}`,
          tone,
        },
      });
    }

    out.sort((a, b) => b.sortAt - a.sortAt);
    return out;
  }, [items, stacksSwaps, t, localeStr, formatUnit, unitLabel]);

  return (
    <div className="px-5 pb-14">
      <BackHeader title={t("activity.title")} />

      {error ? (
        <div
          className="mt-5 rounded-[14px] px-4 py-3 text-[12px]"
          role="alert"
          style={{
            background: "rgba(196,48,48,0.08)",
            color: "var(--paysats-danger)",
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="mt-5">
        {rows === null ? (
          <Card className="py-0">
            <div className="space-y-3 py-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-[12px] bg-paysats-border/60"
                />
              ))}
            </div>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <div
              className="py-6 text-center text-[12px]"
              style={{ color: "var(--paysats-text-faint)" }}
            >
              {t("tx.empty")}
            </div>
          </Card>
        ) : (
          <Card className="divide-y divide-paysats-border/70 py-0">
            {rows.map((row) =>
              row.kind === "mint" ? (
                <TxActivityItem
                  key={row.item.id}
                  tx={row.tx}
                  item={row.item}
                  localeStr={localeStr}
                />
              ) : (
                <a
                  key={row.item.id}
                  href={stacksExplorerTxUrl(
                    row.swap.txId,
                    row.swap.network === "testnet" ? "testnet" : "mainnet",
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                  data-pressable
                >
                  <ActivityRow item={row.item} />
                </a>
              ),
            )}
          </Card>
        )}
      </div>

      <button
        type="button"
        onClick={() => load()}
        disabled={reloading}
        data-pressable
        className="mt-6 w-full rounded-[14px] px-4 py-3 text-[13px] font-extrabold disabled:opacity-60"
        style={{
          background: "var(--paysats-accent-soft)",
          color: "var(--paysats-accent)",
        }}
      >
        {reloading ? "…" : t("activity.reload")}
      </button>
    </div>
  );
}
