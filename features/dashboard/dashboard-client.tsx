"use client";

import { LogoMark, LogoTile } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";
import {
  ActivityRow,
  relativeTime,
  type ActivityItem,
} from "@/features/transactions/activity-row";
import { useBalances } from "@/hooks/use-balances";
import { useCreditPosition } from "@/hooks/use-credit-line";
import { useDcaOrder } from "@/hooks/use-dca-contract";
import { useStacksBalances } from "@/hooks/use-stacks-balances";
import { useStacksWallet } from "@/hooks/use-stacks-wallet";
import { fetchWithPrivy } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { useDisplayUnit } from "@/lib/display-unit";
import { useT } from "@/lib/i18n";
import {
  collateralValueInLoan,
  USDC_DECIMALS,
} from "@/lib/contracts/morpho-credit";
import { IDRX_DECIMALS, INTERVAL_PRESETS } from "@/lib/contracts/paysats-dca";
import { stacksExplorerTxUrl } from "@/lib/stacks/config";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const IDR_FALLBACK_PER_USD = 16_500;

type MintTx = {
  id: string;
  paymentStatus?: string;
  paymentAmount?: number;
  toBeMinted?: string | number;
  createdAt: string;
  txHash?: string | null;
};

type StacksSwapTx = {
  id: string;
  txId: string;
  network: string;
  amountInRaw: string;
  amountOutRaw: string | null;
  status: string;
  createdAt: string;
};

type StacksZestTx = {
  id: string;
  txId: string;
  kind: string;
  amountRaw: string;
  status: string;
  createdAt: string;
};

function greetKey() {
  const h = new Date().getHours();
  if (h < 11) return "home.greet.morning";
  if (h < 17) return "home.greet.afternoon";
  return "home.greet.evening";
}

function shortFiat(v: number, currency: "IDR" | "USD"): string {
  if (!Number.isFinite(v)) return "—";
  if (currency === "USD") {
    if (v >= 1000)
      return `$${(v / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
    return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (v >= 1_000_000)
    return `Rp ${(v / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}jt`;
  if (v >= 1_000)
    return `Rp ${(v / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })}rb`;
  return `Rp ${v.toLocaleString("id-ID")}`;
}

function AvatarTile({ initial }: { initial: string }) {
  return (
    <Link
      href="/profile"
      aria-label="Profile"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
      data-pressable
      style={{
        background: "var(--paysats-gradient)",
        boxShadow: "var(--paysats-shadow-tile)",
        color: "#fff",
        fontWeight: 800,
        fontSize: 15,
      }}
    >
      {initial}
    </Link>
  );
}

function ActionTile({
  label,
  onClick,
  href,
  icon,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  icon: string;
}) {
  const body = (
    <div
      className="flex flex-col items-center gap-1.5 rounded-[16px] px-3 py-3.5"
      style={{
        background: "var(--paysats-surface)",
        boxShadow: "var(--paysats-shadow-card)",
      }}
      data-pressable
    >
      <div
        className="flex h-11 w-11 items-center justify-center rounded-[14px]"
        style={{
          background: "var(--paysats-accent-soft)",
          color: "var(--paysats-accent)",
          fontSize: 18,
          fontWeight: 800,
        }}
      >
        {icon}
      </div>
      <span
        className="text-[11px] font-bold"
        style={{ color: "var(--paysats-text)" }}
      >
        {label}
      </span>
    </div>
  );
  if (href)
    return (
      <Link href={href} className="flex-1">
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className="flex-1">
      {body}
    </button>
  );
}

function HeroBalance({
  sats,
  fiat,
  currency,
  cashFiat,
  creditFiat,
  stacksConnected,
  usdcx,
  stx,
}: {
  sats: number | null;
  fiat: number;
  currency: "IDR" | "USD";
  cashFiat: number;
  creditFiat: number;
  stacksConnected: boolean;
  usdcx: number | null;
  stx: number | null;
}) {
  const t = useT();
  const { format: formatUnit, label: unitLabel } = useDisplayUnit();
  return (
    <div
      className="relative overflow-hidden rounded-[22px] px-5 py-6 text-white"
      style={{
        background: "var(--paysats-gradient-hero)",
        backgroundSize: "300% 300%",
        animation: "grad-move 14s ease infinite",
        boxShadow: "var(--paysats-shadow-hero)",
      }}
    >
      <div
        className="absolute -right-4 top-2"
        style={{ opacity: 0.07 }}
        aria-hidden
      >
        <LogoMark size={120} color="#ffffff" />
      </div>

      <div className="flex items-center justify-between">
        <div
          className="text-[11px] font-bold uppercase tracking-[0.1em]"
          style={{ color: "rgba(255,255,255,0.75)" }}
        >
          {stacksConnected ? t("home.balance.sbtc") : t("home.balance.label")}
        </div>
        <LogoMark size={18} color="rgba(255,255,255,0.6)" />
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span
          className="text-[40px] font-extrabold leading-none"
          style={{ letterSpacing: -1 }}
        >
          {formatUnit(sats)}
        </span>
        <span
          className="text-sm font-bold"
          style={{ color: "rgba(255,255,255,0.8)" }}
        >
          {unitLabel}
        </span>
      </div>
      <div
        className="mt-1.5 text-[13px]"
        style={{ color: "rgba(255,255,255,0.8)" }}
      >
        {t("home.balance.sub")} {shortFiat(fiat, currency)}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        {stacksConnected ? (
          <>
            <Link
              href="/stacks"
              data-pressable
              className="rounded-[14px] px-3.5 py-3"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              <div
                className="text-[10px] font-bold uppercase tracking-[0.08em]"
                style={{ color: "rgba(255,255,255,0.7)" }}
              >
                {t("home.tile.usdcx")}
              </div>
              <div className="mt-1 text-[15px] font-extrabold">
                {usdcx != null
                  ? `$${usdcx.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                  : "—"}
              </div>
            </Link>
            <Link
              href="/stacks"
              data-pressable
              className="rounded-[14px] px-3.5 py-3"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              <div
                className="text-[10px] font-bold uppercase tracking-[0.08em]"
                style={{ color: "rgba(255,255,255,0.7)" }}
              >
                {t("home.tile.stx")}
              </div>
              <div className="mt-1 text-[15px] font-extrabold tabular-nums">
                {stx != null
                  ? stx.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : "—"}
              </div>
            </Link>
          </>
        ) : (
          <>
            <Link
              href="/cash"
              data-pressable
              className="rounded-[14px] px-3.5 py-3"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              <div
                className="text-[10px] font-bold uppercase tracking-[0.08em]"
                style={{ color: "rgba(255,255,255,0.7)" }}
              >
                {t("home.tile.cash")}
              </div>
              <div className="mt-1 text-[15px] font-extrabold">
                {shortFiat(cashFiat, currency)}
              </div>
            </Link>
            <Link
              href="/credit"
              data-pressable
              className="rounded-[14px] px-3.5 py-3"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              <div
                className="text-[10px] font-bold uppercase tracking-[0.08em]"
                style={{ color: "rgba(255,255,255,0.7)" }}
              >
                {t("home.tile.credit")}
              </div>
              <div className="mt-1 text-[15px] font-extrabold">
                {shortFiat(creditFiat, currency)}
              </div>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function NativeBtcRailNudge({ connected }: { connected: boolean }) {
  const t = useT();
  return (
    <Link href="/stacks" data-pressable className="block">
      <Card className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[16px] font-extrabold"
          style={{
            background: "var(--paysats-accent-soft)",
            color: "var(--paysats-accent)",
          }}
        >
          ₿
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="flex items-center gap-2 text-[13px] font-bold"
            style={{ color: "var(--paysats-text)" }}
          >
            {connected ? (
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: "var(--paysats-success)" }}
              />
            ) : null}
            {t("home.stacks.title")}
          </div>
          <div
            className="mt-0.5 text-[11px]"
            style={{ color: "var(--paysats-text-faint)" }}
          >
            {t("home.stacks.desc")}
          </div>
        </div>
        <span
          className="rounded-[10px] px-3 py-1.5 text-[11px] font-extrabold"
          style={{
            color: "var(--paysats-accent)",
            background: "var(--paysats-accent-soft)",
          }}
        >
          {connected ? t("home.stacks.btn") : t("home.stacks.connect")}
        </span>
      </Card>
    </Link>
  );
}

function AutobuyNudge() {
  const { order, loading } = useDcaOrder();
  const t = useT();

  if (loading) {
    return (
      <Card className="flex items-center gap-3">
        <div className="h-10 w-10 animate-pulse rounded-[12px] bg-paysats-border/60" />
        <div className="flex-1">
          <div className="h-4 w-32 animate-pulse rounded bg-paysats-border/60" />
          <div className="mt-2 h-3 w-40 animate-pulse rounded bg-paysats-border/40" />
        </div>
      </Card>
    );
  }

  if (!order) {
    return (
      <Link href="/save" data-pressable className="block">
        <Card className="flex items-center gap-3">
          <LogoTile size={40} />
          <div className="min-w-0 flex-1">
            <div
              className="text-[13px] font-bold"
              style={{ color: "var(--paysats-text)" }}
            >
              {t("home.autobuy.startTitle")}
            </div>
            <div
              className="mt-0.5 text-[11px]"
              style={{ color: "var(--paysats-text-faint)" }}
            >
              {t("home.autobuy.startDesc")}
            </div>
          </div>
          <span
            className="rounded-[10px] px-3 py-1.5 text-[11px] font-extrabold"
            style={{
              color: "var(--paysats-accent)",
              background: "var(--paysats-accent-soft)",
            }}
          >
            {t("home.autobuy.startBtn")}
          </span>
        </Card>
      </Link>
    );
  }

  const perSwapIdr = Number(order.amountPerSwap) / 10 ** IDRX_DECIMALS;
  const intervalSec = Number(order.interval);
  const intervalMatch = INTERVAL_PRESETS.find((p) => p.seconds === intervalSec);
  const intervalLabelKey =
    intervalMatch?.seconds === 86_400
      ? "dca.interval.daily"
      : intervalMatch?.seconds === 604_800
        ? "dca.interval.weekly"
        : intervalMatch?.seconds === 2_592_000
          ? "dca.interval.monthly"
          : null;
  const freqLabel = intervalLabelKey ? t(intervalLabelKey) : `${intervalSec}s`;
  const nextAt =
    Number(order.lastExecutedAt) > 0
      ? new Date((Number(order.lastExecutedAt) + intervalSec) * 1000)
      : null;

  return (
    <Link href="/save" data-pressable className="block">
      <Card className="flex items-center gap-3">
        <LogoTile size={40} />
        <div className="min-w-0 flex-1">
          <div
            className="flex items-center gap-2 text-[13px] font-bold"
            style={{ color: "var(--paysats-text)" }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: "var(--paysats-success)" }}
            />
            {t("home.autobuy.nextTitle")}
          </div>
          <div
            className="mt-0.5 text-[11px]"
            style={{ color: "var(--paysats-text-faint)" }}
          >
            Rp {perSwapIdr.toLocaleString("id-ID")} · {freqLabel}
            {nextAt ? ` · ${nextAt.toLocaleDateString()}` : ""}
          </div>
        </div>
        <span
          className="rounded-[10px] px-3 py-1.5 text-[11px] font-extrabold"
          style={{
            color: "var(--paysats-accent)",
            background: "var(--paysats-accent-soft)",
          }}
        >
          {t("home.autobuy.nextBtn")}
        </span>
      </Card>
    </Link>
  );
}

export function DashboardClient() {
  const router = useRouter();
  const t = useT();
  const { getAccessToken, ready, authenticated, user } = usePrivy();
  const { currency } = useCurrency();
  const { format: formatUnit, label: unitLabel } = useDisplayUnit();
  const balances = useBalances();
  const credit = useCreditPosition();
  const stacksWallet = useStacksWallet();
  const stacksBalances = useStacksBalances(stacksWallet.address);

  // Fiat conversions
  const btcUsd = useMemo(() => {
    if (!credit.data) return null;
    const oneBtcInSats = BigInt(1e8);
    // collateralValueInLoan returns USDC amount (6 decimals) for given sats.
    const usdc = collateralValueInLoan(
      oneBtcInSats,
      credit.data.oraclePrice,
    );
    return Number(usdc) / 10 ** USDC_DECIMALS;
  }, [credit.data]);

  const fxUsdToIdr = IDR_FALLBACK_PER_USD;

  // Prefer Stacks sBTC when the native BTC rail wallet is connected.
  const stacksConnected = stacksWallet.connected;
  const btcSats = stacksConnected
    ? (stacksBalances.balances?.sbtcSats ?? 0)
    : balances.btcSats;
  const btcUnit = btcSats != null ? btcSats / 1e8 : 0;
  const btcFiat = useMemo(() => {
    if (btcUsd == null) return 0;
    const usd = btcUnit * btcUsd;
    return currency === "IDR" ? usd * fxUsdToIdr : usd;
  }, [btcUnit, btcUsd, currency, fxUsdToIdr]);

  const cashFiat = useMemo(() => {
    const usdcAmt = balances.usdc ?? 0;
    const idrxAmt = balances.idrx ?? 0;
    if (currency === "USD") {
      const idrxAsUsd = idrxAmt / fxUsdToIdr;
      return usdcAmt + idrxAsUsd;
    }
    return usdcAmt * fxUsdToIdr + idrxAmt;
  }, [balances.idrx, balances.usdc, currency, fxUsdToIdr]);

  const creditFiat = useMemo(() => {
    if (!credit.data) return 0;
    const borrowedUsd =
      Number(credit.data.borrowedAssets) / 10 ** USDC_DECIMALS;
    return currency === "USD" ? borrowedUsd : borrowedUsd * fxUsdToIdr;
  }, [credit.data, currency, fxUsdToIdr]);

  // Activity feed: Stacks swaps + mint transactions, newest first.
  const [mintTx, setMintTx] = useState<MintTx[] | null>(null);
  const [stacksSwaps, setStacksSwaps] = useState<StacksSwapTx[] | null>(null);
  const [stacksZest, setStacksZest] = useState<StacksZestTx[] | null>(null);
  const tokenRef = useRef(getAccessToken);
  useLayoutEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);

  const loadTx = useCallback(async () => {
    const tokenFn = tokenRef.current;
    const [mintRes, stacksRes, zestRes] = await Promise.allSettled([
      (async () => {
        const q = new URLSearchParams({ page: "1", take: "10" }).toString();
        const res = await fetchWithPrivy(tokenFn, `/api/idrx/transactions?${q}`);
        const j = (await res.json().catch(() => ({}))) as {
          transactions?: MintTx[];
        };
        return j.transactions ?? [];
      })(),
      (async () => {
        const res = await fetchWithPrivy(tokenFn, "/api/stacks/swap/record");
        const j = (await res.json().catch(() => ({}))) as {
          swaps?: StacksSwapTx[];
        };
        return j.swaps ?? [];
      })(),
      (async () => {
        const res = await fetchWithPrivy(tokenFn, "/api/stacks/zest/record");
        const j = (await res.json().catch(() => ({}))) as {
          txs?: StacksZestTx[];
        };
        return j.txs ?? [];
      })(),
    ]);
    setMintTx(mintRes.status === "fulfilled" ? mintRes.value : []);
    setStacksSwaps(stacksRes.status === "fulfilled" ? stacksRes.value : []);
    setStacksZest(zestRes.status === "fulfilled" ? zestRes.value : []);
  }, []);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void loadTx();
  }, [ready, authenticated, loadTx]);

  const firstName = useMemo(() => {
    const name =
      (user?.google?.name as string | undefined) ??
      (user?.email?.address as string | undefined) ??
      "";
    return name ? name.split(/\s|@/)[0] : "";
  }, [user]);

  const initial = (firstName || "A").slice(0, 1).toUpperCase();

  const activityItems: ActivityItem[] = useMemo(() => {
    type Dated = ActivityItem & { sortAt: number };
    const items: Dated[] = [];

    for (const s of stacksSwaps ?? []) {
      const usd = Number(s.amountInRaw) / 1e6;
      const sats = s.amountOutRaw != null ? Number(s.amountOutRaw) : null;
      const statusLabel =
        s.status === "success"
          ? t("tx.stacksSuccess")
          : s.status === "failed"
            ? t("tx.stacksFailed")
            : t("tx.stacksPending");
      items.push({
        id: `stacks-${s.id}`,
        type: "buy",
        title: t("tx.usdcxToSbtc"),
        subtitle: `${relativeTime(s.createdAt)} · ${statusLabel}`,
        primary:
          sats != null
            ? `+${formatUnit(sats)} ${unitLabel}`
            : "+sBTC",
        secondary: `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
        tone:
          s.status === "success"
            ? "accent"
            : s.status === "failed"
              ? "danger"
              : "warning",
        at: s.createdAt,
        sortAt: new Date(s.createdAt).getTime(),
      });
    }

    for (const z of stacksZest ?? []) {
      const statusLabel =
        z.status === "success"
          ? t("tx.stacksSuccess")
          : z.status === "failed"
            ? t("tx.stacksFailed")
            : t("tx.stacksPending");
      const isSats =
        z.kind === "collateral_add" || z.kind === "collateral_remove";
      const title =
        z.kind === "borrow"
          ? t("tx.zestBorrow")
          : z.kind === "repay"
            ? t("tx.zestRepay")
            : z.kind === "collateral_remove"
              ? t("tx.zestWithdraw")
              : t("tx.zestLock");
      const amt = Number(z.amountRaw);
      items.push({
        id: `zest-${z.id}`,
        type: "loan",
        title,
        subtitle: `${relativeTime(z.createdAt)} · ${statusLabel}`,
        primary: isSats
          ? `${z.kind === "collateral_remove" ? "+" : "−"}${formatUnit(amt)} ${unitLabel}`
          : `${z.kind === "borrow" ? "+" : "−"}$${(amt / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
        tone:
          z.status === "success"
            ? "accent"
            : z.status === "failed"
              ? "danger"
              : "warning",
        at: z.createdAt,
        sortAt: new Date(z.createdAt).getTime(),
      });
    }

    for (const tx of mintTx ?? []) {
      const idr = tx.paymentAmount ?? 0;
      items.push({
        id: tx.id,
        type: "in",
        title: t("tx.idrxDeposit"),
        subtitle: relativeTime(tx.createdAt),
        primary: `+Rp ${Number(idr).toLocaleString("id-ID")}`,
        secondary: tx.paymentStatus ?? undefined,
        tone: "success",
        at: tx.createdAt,
        sortAt: new Date(tx.createdAt).getTime(),
      });
    }

    items.sort((a, b) => b.sortAt - a.sortAt);
    return items.slice(0, 8);
  }, [mintTx, stacksSwaps, stacksZest, t, formatUnit, unitLabel]);

  const activityLoading = mintTx === null && stacksSwaps === null && stacksZest === null;

  if (!ready || !authenticated) return null;

  return (
    <div className="px-5 pt-12">
      <div className="flex items-center justify-between">
        <div>
          <div
            className="text-[11px] font-bold uppercase tracking-[0.1em]"
            style={{ color: "var(--paysats-text-faint)" }}
          >
            {t(greetKey())}
          </div>
          <div
            className="mt-1 text-xl font-extrabold"
            style={{ color: "var(--paysats-text)", letterSpacing: -0.5 }}
          >
            {firstName || "PaySats"}
          </div>
        </div>
        <AvatarTile initial={initial} />
      </div>

      <div className="mt-5">
        <HeroBalance
          sats={btcSats}
          fiat={btcFiat}
          currency={currency}
          cashFiat={cashFiat}
          creditFiat={creditFiat}
          stacksConnected={stacksConnected}
          usdcx={stacksBalances.balances?.usdcx ?? null}
          stx={stacksBalances.balances?.stx ?? null}
        />
      </div>

      <div className="mt-5 flex items-stretch gap-2.5">
        <ActionTile
          label={t("home.action.deposit")}
          href="/mint"
          icon="↓"
        />
        <ActionTile
          label={t("home.action.credit")}
          href="/credit"
          icon="$"
        />
        <ActionTile
          label={t("home.action.withdraw")}
          href="/withdraw"
          icon="↑"
        />
      </div>

      <div className="mt-5">
        <AutobuyNudge />
      </div>

      <div className="mt-3">
        <NativeBtcRailNudge connected={stacksConnected} />
      </div>

      <section className="mt-7">
        <div className="mb-2 flex items-center justify-between">
          <div
            className="text-[11px] font-bold uppercase tracking-[0.1em]"
            style={{ color: "var(--paysats-text-faint)" }}
          >
            {t("home.activity.title")}
          </div>
          <button
            type="button"
            onClick={() => router.push("/activity")}
            className="text-[11px] font-bold"
            style={{ color: "var(--paysats-accent)" }}
          >
            {t("dashboard.viewAll")}
          </button>
        </div>

        <Card className="divide-y divide-paysats-border/70 py-0">
          {activityLoading ? (
            <div className="space-y-3 py-3">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-[12px] bg-paysats-border/60"
                />
              ))}
            </div>
          ) : activityItems.length === 0 ? (
            <div
              className="py-6 text-center text-[12px]"
              style={{ color: "var(--paysats-text-faint)" }}
            >
              {t("home.activity.empty")}
            </div>
          ) : (
            activityItems.map((it) => {
              const swap = stacksSwaps?.find(
                (s) => `stacks-${s.id}` === it.id,
              );
              if (swap) {
                return (
                  <a
                    key={it.id}
                    href={stacksExplorerTxUrl(
                      swap.txId,
                      swap.network === "testnet" ? "testnet" : "mainnet",
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                    data-pressable
                  >
                    <ActivityRow item={it} />
                  </a>
                );
              }
              return <ActivityRow key={it.id} item={it} />;
            })
          )}
        </Card>
      </section>

      <div className="pb-4" />
    </div>
  );
}
