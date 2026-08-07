"use client";

import { Card } from "@/components/ui/card";
import { GradButton } from "@/components/ui/grad-button";
import { InlinePanel } from "@/components/ui/inline-panel";
import { PillSeg } from "@/components/ui/pill-seg";
import { useStacksBalances } from "@/hooks/use-stacks-balances";
import { useStacksSwap } from "@/hooks/use-stacks-swap";
import { useStacksWallet } from "@/hooks/use-stacks-wallet";
import { fetchWithPrivy } from "@/lib/api";
import {
  DEFAULT_SLIPPAGE,
  STACKS_TESTNET_FAUCET_URL,
  stacksExplorerAddressUrl,
  stacksExplorerTxUrl,
  swapEnabled,
} from "@/lib/stacks/config";
import { usePrivy } from "@privy-io/react-auth";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const USDCX_PRESETS = [5, 10, 25, 50];
const SLIPPAGE_OPTIONS = [
  { value: "0.005", label: "0.5%" },
  { value: "0.01", label: "1%" },
  { value: "0.02", label: "2%" },
] as const;
type SlippageValue = (typeof SLIPPAGE_OPTIONS)[number]["value"];

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatSats(sats: number): string {
  return sats.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatUsd(v: number): string {
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// ---------- Header ----------

function BackHeader({
  title,
  badge,
}: {
  title: string;
  badge: string;
}) {
  return (
    <div className="flex items-center gap-3 pt-12">
      <a
        href="/home"
        aria-label="Back"
        className="flex h-10 w-10 items-center justify-center rounded-[12px]"
        data-pressable
        style={{
          background: "var(--paysats-surface)",
          boxShadow: "var(--paysats-shadow-card)",
          color: "var(--paysats-text)",
        }}
      >
        ←
      </a>
      <div
        className="text-lg font-extrabold"
        style={{ color: "var(--paysats-text)", letterSpacing: -0.4 }}
      >
        {title}
      </div>
      <span
        className="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em]"
        style={{
          background:
            badge === "testnet"
              ? "var(--paysats-danger)"
              : "var(--paysats-accent-soft)",
          color: badge === "testnet" ? "#fff" : "var(--paysats-accent)",
        }}
      >
        {badge}
      </span>
    </div>
  );
}

// ---------- Wallet connect ----------

function WalletCard({
  wallet,
}: {
  wallet: ReturnType<typeof useStacksWallet>;
}) {
  if (!wallet.connected) {
    return (
      <Card className="space-y-3">
        <div
          className="text-[13px] font-extrabold"
          style={{ color: "var(--paysats-text)" }}
        >
          Connect a Stacks wallet
        </div>
        <p className="text-[12px]" style={{ color: "var(--paysats-text-muted)" }}>
          Use Leather or Xverse to hold USDCx and sBTC. Your wallet stays fully
          self-custodial — PaySats only reads balances and prepares
          transactions for you to approve.
        </p>
        {wallet.error ? (
          <p className="text-xs" style={{ color: "var(--paysats-danger)" }}>
            {wallet.error}
          </p>
        ) : null}
        <GradButton onClick={wallet.connect} disabled={wallet.connecting}>
          {wallet.connecting ? "Connecting…" : "Connect wallet"}
        </GradButton>
      </Card>
    );
  }

  return (
    <Card className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div
          className="text-[11px] font-bold uppercase tracking-[0.08em]"
          style={{ color: "var(--paysats-text-muted)" }}
        >
          Stacks wallet
        </div>
        <a
          href={stacksExplorerAddressUrl(wallet.address!, wallet.network)}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block text-[14px] font-extrabold tabular-nums underline-offset-2 hover:underline"
          style={{ color: "var(--paysats-text)" }}
        >
          {shortAddress(wallet.address!)}
        </a>
      </div>
      <button
        type="button"
        onClick={wallet.disconnect}
        className="rounded-[10px] px-3 py-1.5 text-[11px] font-extrabold"
        style={{
          background: "var(--paysats-surface-muted)",
          color: "var(--paysats-text)",
        }}
        data-pressable
      >
        Disconnect
      </button>
    </Card>
  );
}

// ---------- Balances ----------

function BalancesCard({
  balances,
  loading,
  error,
  isTestnet,
}: {
  balances: ReturnType<typeof useStacksBalances>["balances"];
  loading: boolean;
  error: string | null;
  isTestnet: boolean;
}) {
  const rows = [
    {
      label: "USDCx",
      value:
        balances != null ? formatUsd(balances.usdcx) : loading ? "…" : "—",
      sub: "Circle USDC-backed dollar on Stacks",
    },
    {
      label: "sBTC",
      value:
        balances != null
          ? `${formatSats(balances.sbtcSats)} sats`
          : loading
            ? "…"
            : "—",
      sub: "Bitcoin-settled, 1:1 backed",
    },
    {
      label: "STX",
      value:
        balances != null
          ? balances.stx.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })
          : loading
            ? "…"
            : "—",
      sub: "Needed for network fees",
    },
  ];

  return (
    <Card className="space-y-1">
      <div
        className="text-[11px] font-bold uppercase tracking-[0.08em]"
        style={{ color: "var(--paysats-text-muted)" }}
      >
        Balances
      </div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between py-2">
          <div>
            <div
              className="text-[13px] font-extrabold"
              style={{ color: "var(--paysats-text)" }}
            >
              {r.label}
            </div>
            <div
              className="text-[10px]"
              style={{ color: "var(--paysats-text-faint)" }}
            >
              {r.sub}
            </div>
          </div>
          <span className="text-[13px] font-extrabold tabular-nums">
            {r.value}
          </span>
        </div>
      ))}
      {error ? (
        <p className="text-xs" style={{ color: "var(--paysats-danger)" }}>
          {error}
        </p>
      ) : null}
      {isTestnet && balances != null && balances.stx <= 0 ? (
        <p className="text-[11px]" style={{ color: "var(--paysats-text-muted)" }}>
          You need testnet STX for fees —{" "}
          <a
            href={STACKS_TESTNET_FAUCET_URL}
            target="_blank"
            rel="noreferrer"
            className="font-bold underline"
            style={{ color: "var(--paysats-accent)" }}
          >
            get some from the Hiro faucet
          </a>
          .
        </p>
      ) : null}
    </Card>
  );
}

// ---------- Swap ----------

function SwapCard({
  address,
  usdcxBalance,
  onSwapSettled,
}: {
  address: string;
  usdcxBalance: number | null;
  onSwapSettled: () => void;
}) {
  const swap = useStacksSwap();
  const [amount, setAmount] = useState<number>(1);
  const [slippageStr, setSlippageStr] = useState<SlippageValue>(
    String(DEFAULT_SLIPPAGE) as SlippageValue,
  );
  const slippage = Number(slippageStr);
  const [reviewing, setReviewing] = useState(false);

  // Once the wallet balance loads, clamp a too-large default down to Max.
  useEffect(() => {
    if (usdcxBalance == null || usdcxBalance <= 0) return;
    if (amount > usdcxBalance) {
      setAmount(Math.floor(usdcxBalance * 1_000_000) / 1_000_000);
    }
    // Only run when balance first becomes available / changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usdcxBalance]);

  // Debounced quote refresh while the user edits the amount.
  useEffect(() => {
    if (reviewing) return;
    const t = setTimeout(() => {
      void swap.fetchQuote(amount);
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, reviewing]);

  const insufficient =
    usdcxBalance != null && amount > usdcxBalance && usdcxBalance >= 0;

  const minReceivedSats = swap.quote
    ? Math.floor(swap.quote.amountOutSats * (1 - slippage))
    : null;

  const busy = swap.phase === "signing" || swap.phase === "pending";

  const startReview = useCallback(async () => {
    const q = await swap.fetchQuote(amount);
    if (q) setReviewing(true);
  }, [swap, amount]);

  const approve = useCallback(async () => {
    if (!swap.quote) return;
    await swap.executeSwap({
      quote: swap.quote,
      senderAddress: address,
      slippage,
      onSettled: () => onSwapSettled(),
    });
  }, [swap, address, slippage, onSwapSettled]);

  const resetFlow = useCallback(() => {
    setReviewing(false);
    swap.reset();
  }, [swap]);

  // ----- Submitted / settled states -----
  if (swap.phase === "pending" || swap.phase === "success" || swap.phase === "failed") {
    const label =
      swap.phase === "pending"
        ? "Swap submitted — waiting for confirmation"
        : swap.phase === "success"
          ? "Swap confirmed"
          : "Swap failed on-chain";
    const tone =
      swap.phase === "success"
        ? "var(--paysats-success)"
        : swap.phase === "failed"
          ? "var(--paysats-danger)"
          : "var(--paysats-accent)";
    return (
      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background: tone,
              animation:
                swap.phase === "pending" ? "pulse 1.5s infinite" : undefined,
            }}
          />
          <span
            className="text-[13px] font-extrabold"
            style={{ color: "var(--paysats-text)" }}
          >
            {label}
          </span>
        </div>
        {swap.txId ? (
          <a
            href={stacksExplorerTxUrl(swap.txId)}
            target="_blank"
            rel="noreferrer"
            className="block break-all text-[12px] font-bold underline underline-offset-2"
            style={{ color: "var(--paysats-accent)" }}
          >
            View on Hiro Explorer: {swap.txId.slice(0, 18)}…
          </a>
        ) : null}
        {swap.phase === "pending" ? (
          <p className="text-[11px]" style={{ color: "var(--paysats-text-faint)" }}>
            Stacks transactions confirm with Bitcoin finality — this can take a
            few minutes. You can leave this page; the swap keeps settling
            on-chain.
          </p>
        ) : null}
        <button
          type="button"
          onClick={resetFlow}
          className="w-full rounded-[12px] px-3 py-3 text-[13px] font-extrabold"
          style={{
            background: "var(--paysats-surface-muted)",
            color: "var(--paysats-text)",
          }}
          data-pressable
        >
          {swap.phase === "pending" ? "Start another swap" : "Done"}
        </button>
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <div
        className="text-[13px] font-extrabold"
        style={{ color: "var(--paysats-text)" }}
      >
        Swap USDCx → sBTC
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div
            className="text-[11px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--paysats-text-muted)" }}
          >
            Amount (USDCx)
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] tabular-nums"
              style={{ color: "var(--paysats-text-faint)" }}
            >
              Available{" "}
              {usdcxBalance != null ? formatUsd(usdcxBalance) : "—"}
            </span>
            <button
              type="button"
              disabled={usdcxBalance == null || usdcxBalance <= 0}
              onClick={() => {
                if (usdcxBalance == null || usdcxBalance <= 0) return;
                // Floor to 6 decimals so we never request more than on-chain.
                const max =
                  Math.floor(usdcxBalance * 1_000_000) / 1_000_000;
                setAmount(max);
                setReviewing(false);
              }}
              className="rounded-[8px] px-2 py-0.5 text-[11px] font-extrabold disabled:opacity-40"
              style={{
                background: "var(--paysats-accent-soft)",
                color: "var(--paysats-accent)",
              }}
              data-pressable
            >
              Max
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {USDCX_PRESETS.map((p) => {
            const active = amount === p;
            const over =
              usdcxBalance != null && p > usdcxBalance && usdcxBalance >= 0;
            return (
              <button
                key={p}
                type="button"
                disabled={over}
                onClick={() => {
                  setAmount(p);
                  setReviewing(false);
                }}
                className="rounded-[12px] px-2 py-2 text-[12px] font-extrabold disabled:opacity-40"
                style={{
                  color: active ? "#fff" : "var(--paysats-text)",
                  background: active
                    ? "var(--paysats-accent)"
                    : "var(--paysats-surface-muted)",
                }}
                data-pressable
              >
                ${p}
              </button>
            );
          })}
        </div>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={amount}
          onChange={(e) => {
            setAmount(Number(e.target.value) || 0);
            setReviewing(false);
          }}
          className="mt-3 w-full rounded-[12px] border px-3 py-2 text-[14px] font-semibold tabular-nums"
          style={{
            borderColor: "var(--paysats-border)",
            background: "var(--paysats-surface)",
            color: "var(--paysats-text)",
          }}
        />
        {insufficient ? (
          <p className="mt-1 text-xs" style={{ color: "var(--paysats-danger)" }}>
            Amount exceeds your USDCx balance.
          </p>
        ) : null}
      </div>

      <div>
        <div
          className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em]"
          style={{ color: "var(--paysats-text-muted)" }}
        >
          Max slippage
        </div>
        <PillSeg<SlippageValue>
          value={slippageStr}
          onChange={setSlippageStr}
          options={[...SLIPPAGE_OPTIONS]}
        />
      </div>

      <div
        className="rounded-[12px] px-3 py-2.5"
        style={{ background: "var(--paysats-surface-muted)" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[12px]" style={{ color: "var(--paysats-text-muted)" }}>
            You receive (est.)
          </span>
          <span className="text-[13px] font-extrabold tabular-nums">
            {swap.phase === "quoting"
              ? "…"
              : swap.quote
                ? `${formatSats(swap.quote.amountOutSats)} sats`
                : "—"}
          </span>
        </div>
        {swap.quote ? (
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[11px]" style={{ color: "var(--paysats-text-faint)" }}>
              Route
            </span>
            <span
              className="text-[11px] font-bold"
              style={{ color: "var(--paysats-text-muted)" }}
            >
              {swap.quote.tokenPath
                .map((t) =>
                  t
                    .replace(/^token-/, "")
                    .replace(/-auto$/, "")
                    .toUpperCase(),
                )
                .join(" → ")}
            </span>
          </div>
        ) : null}
      </div>

      {swap.quoteError ? (
        <p className="text-xs" style={{ color: "var(--paysats-danger)" }}>
          {swap.quoteError}
        </p>
      ) : null}
      {swap.error ? (
        <p className="text-xs" style={{ color: "var(--paysats-danger)" }}>
          {swap.error}
        </p>
      ) : null}

      {/* Explicit in-app review step before anything reaches the wallet. */}
      <InlinePanel open={reviewing}>
        <div
          className="space-y-2 rounded-[12px] border p-3"
          style={{ borderColor: "var(--paysats-border)" }}
        >
          <div
            className="text-[11px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--paysats-text-muted)" }}
          >
            Review swap
          </div>
          <Row label="You pay" value={`${amount} USDCx`} />
          <Row
            label="You receive (est.)"
            value={
              swap.quote ? `${formatSats(swap.quote.amountOutSats)} sats` : "—"
            }
          />
          <Row
            label={`Minimum received (${(slippage * 100).toFixed(1)}% slippage)`}
            value={
              minReceivedSats != null
                ? `${formatSats(minReceivedSats)} sats`
                : "—"
            }
          />
          <Row
            label="Venue"
            value={swap.quote ? "Bitflow aggregator" : "—"}
          />
          <p className="text-[11px]" style={{ color: "var(--paysats-text-faint)" }}>
            Nothing is sent until you approve the transaction in your wallet.
            The transaction carries post-conditions, so it aborts on-chain if
            the output falls below the minimum.
          </p>
          <div className="flex gap-2 pt-1">
            <GradButton
              onClick={approve}
              disabled={busy || !swap.quote}
              className="flex-1"
            >
              {swap.phase === "signing" ? "Confirm in wallet…" : "Approve in wallet"}
            </GradButton>
            <button
              type="button"
              onClick={() => setReviewing(false)}
              disabled={busy}
              className="rounded-[var(--radius-pill)] px-4 text-[13px] font-extrabold"
              style={{
                background: "var(--paysats-surface-muted)",
                color: "var(--paysats-text)",
              }}
              data-pressable
            >
              Back
            </button>
          </div>
        </div>
      </InlinePanel>

      {!reviewing ? (
        <GradButton
          onClick={startReview}
          disabled={
            amount <= 0 || insufficient || swap.phase === "quoting" || busy
          }
        >
          {swap.phase === "quoting" ? "Fetching quote…" : "Review swap"}
        </GradButton>
      ) : null}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px]" style={{ color: "var(--paysats-text-muted)" }}>
        {label}
      </span>
      <span className="text-[13px] font-extrabold tabular-nums">{value}</span>
    </div>
  );
}

// ---------- Recent swaps ----------

type SwapRecord = {
  id: string;
  txId: string;
  network: string;
  amountInRaw: string;
  amountOutRaw: string | null;
  status: string;
  createdAt: string;
};

function RecentSwaps({ refreshKey }: { refreshKey: number }) {
  const { getAccessToken, ready, authenticated } = usePrivy();
  const [swaps, setSwaps] = useState<SwapRecord[] | null>(null);

  const tokenRef = useRef(getAccessToken);
  useLayoutEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithPrivy(
          tokenRef.current,
          "/api/stacks/swap/record",
        );
        const json = (await res.json().catch(() => ({}))) as {
          swaps?: SwapRecord[];
        };
        if (!cancelled) setSwaps(json.swaps ?? []);
      } catch {
        if (!cancelled) setSwaps([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, refreshKey]);

  if (!swaps || swaps.length === 0) return null;

  return (
    <Card className="space-y-2">
      <div
        className="text-[11px] font-bold uppercase tracking-[0.08em]"
        style={{ color: "var(--paysats-text-muted)" }}
      >
        Recent swaps
      </div>
      <div className="space-y-1.5">
        {swaps.slice(0, 5).map((s) => {
          const usd = Number(s.amountInRaw) / 1e6;
          const sats = s.amountOutRaw != null ? Number(s.amountOutRaw) : null;
          return (
            <a
              key={s.id}
              href={stacksExplorerTxUrl(s.txId)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-[10px] px-2 py-1.5"
              style={{ background: "var(--paysats-surface-muted)" }}
              data-pressable
            >
              <div>
                <div className="text-[12px] font-semibold tabular-nums">
                  {formatUsd(usd)} → {sats != null ? `${formatSats(sats)} sats` : "sBTC"}
                </div>
                <div
                  className="text-[10px]"
                  style={{ color: "var(--paysats-text-muted)" }}
                >
                  {new Date(s.createdAt).toLocaleString(undefined, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <span
                className="text-[11px] font-extrabold uppercase"
                style={{
                  color:
                    s.status === "success"
                      ? "var(--paysats-success)"
                      : s.status === "failed"
                        ? "var(--paysats-danger)"
                        : "var(--paysats-text-muted)",
                }}
              >
                {s.status}
              </span>
            </a>
          );
        })}
      </div>
    </Card>
  );
}

// ---------- Root ----------

export function StacksClient() {
  const wallet = useStacksWallet();
  const { balances, loading, error, reload } = useStacksBalances(
    wallet.address,
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const isTestnet = wallet.network === "testnet";
  const canSwap = swapEnabled(wallet.network);

  const onSwapSettled = useCallback(() => {
    void reload();
    setRefreshKey((k) => k + 1);
  }, [reload]);

  return (
    <div className="px-5 pb-14">
      <BackHeader title="Native BTC rail" badge={wallet.network} />
      <div className="mt-5 space-y-4">
        <WalletCard wallet={wallet} />

        {wallet.connected ? (
          <>
            <BalancesCard
              balances={balances}
              loading={loading}
              error={error}
              isTestnet={isTestnet}
            />

            {canSwap ? (
              <SwapCard
                address={wallet.address!}
                usdcxBalance={balances?.usdcx ?? null}
                onSwapSettled={onSwapSettled}
              />
            ) : (
              <Card className="space-y-2">
                <div
                  className="text-[13px] font-extrabold"
                  style={{ color: "var(--paysats-text)" }}
                >
                  Swaps run on mainnet
                </div>
                <p
                  className="text-[12px]"
                  style={{ color: "var(--paysats-text-muted)" }}
                >
                  The Bitflow aggregator routes USDCx → sBTC on Stacks mainnet
                  only. Wallet connection and balance reads work on testnet;
                  set NEXT_PUBLIC_STACKS_NETWORK=mainnet to enable the swap
                  flow.
                </p>
              </Card>
            )}

            <RecentSwaps refreshKey={refreshKey} />
          </>
        ) : null}

        <p className="text-[10px]" style={{ color: "var(--paysats-text-faint)" }}>
          Native BTC rail funded by the Stacks Endowment. sBTC is Bitcoin-settled
          and 1:1 backed; USDCx is a Circle USDC-backed dollar via xReserve.
          Swaps route through the Bitflow aggregator.
        </p>
      </div>
    </div>
  );
}
