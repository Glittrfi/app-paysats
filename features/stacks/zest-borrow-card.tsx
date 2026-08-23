"use client";

import { Card } from "@/components/ui/card";
import { GradButton } from "@/components/ui/grad-button";
import { InlinePanel } from "@/components/ui/inline-panel";
import { useStacksZest } from "@/hooks/use-stacks-zest";
import { stacksExplorerTxUrl } from "@/lib/stacks/config";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

function formatSats(sats: number): string {
  return sats.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatUsd(v: number, digits = 2): string {
  return `$${v.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function satsFromInput(raw: string): bigint {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return BigInt(0);
  return BigInt(Math.floor(n));
}

/** Parse a USDCx amount without float rounding (6 decimals). */
function usdcxRawFromInput(raw: string): bigint {
  const t = raw.trim();
  if (!t || t.startsWith("-")) return BigInt(0);
  const [wholePart, fracPart = ""] = t.split(".");
  if (!/^\d*$/.test(wholePart) || !/^\d*$/.test(fracPart)) return BigInt(0);
  const whole = wholePart === "" ? "0" : wholePart;
  const frac = (fracPart + "000000").slice(0, 6);
  return BigInt(whole) * BigInt(1_000_000) + BigInt(frac);
}

const USDCX_CENT = BigInt(10_000); // $0.01 in 6-decimal raw units

/** Floor a raw USDCx amount to whole cents so Max is typeable and ≤ the cap. */
function floorUsdcxToCents(raw: bigint): bigint {
  if (raw <= BigInt(0)) return BigInt(0);
  return (raw / USDCX_CENT) * USDCX_CENT;
}

function usdcxCentsLabel(raw: bigint): string {
  return (Number(floorUsdcxToCents(raw)) / 1e6).toFixed(2);
}

const ZONE: Record<
  "safe" | "warning" | "danger",
  { color: string; background: string; label: string }
> = {
  safe: {
    color: "var(--paysats-success)",
    background: "var(--paysats-success-soft)",
    label: "safe",
  },
  warning: {
    color: "var(--paysats-warning)",
    background: "var(--paysats-warning-soft)",
    label: "warning",
  },
  danger: {
    color: "var(--paysats-danger)",
    background: "rgba(196,48,48,0.08)",
    label: "danger",
  },
};

function HealthBar({
  score,
  zone,
}: {
  score: number;
  zone: "safe" | "warning" | "danger";
}) {
  const z = ZONE[zone];
  return (
    <div className="pt-1">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span style={{ color: "var(--paysats-text-muted)" }}>Health</span>
        <span
          className="rounded-[6px] px-1.5 py-0.5 text-[10px] font-extrabold uppercase"
          style={{ color: z.color, background: z.background }}
        >
          {z.label}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: "var(--paysats-border)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.max(6, Math.min(100, score))}%`,
            background: z.color,
          }}
        />
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[12px]" style={{ color: "var(--paysats-text-muted)" }}>
        {label}
      </span>
      <span
        className="text-[13px] font-extrabold tabular-nums"
        style={{ color: "var(--paysats-text)" }}
      >
        {value}
      </span>
    </div>
  );
}

function PendingBanner({
  txId,
  kind,
  phase,
  error,
  onDone,
}: {
  txId: string | null;
  kind: string | null;
  phase: string;
  error: string | null;
  onDone: () => void;
}) {
  const label =
    phase === "signing"
      ? "Approve in your wallet…"
      : phase === "pending"
        ? "Waiting for Stacks confirmation…"
        : phase === "success"
          ? "Confirmed"
          : phase === "failed"
            ? "Transaction failed"
            : null;
  if (!label && !error) return null;
  return (
    <div className="space-y-2">
      {label ? (
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background:
                phase === "failed"
                  ? "var(--paysats-danger)"
                  : phase === "success"
                    ? "var(--paysats-success)"
                    : "var(--paysats-accent)",
              animation:
                phase === "pending" || phase === "signing"
                  ? "pulse 1.5s infinite"
                  : undefined,
            }}
          />
          <span
            className="text-[13px] font-extrabold"
            style={{ color: "var(--paysats-text)" }}
          >
            {label}
            {kind ? ` · ${kind.replace("_", " ")}` : ""}
          </span>
        </div>
      ) : null}
      {txId ? (
        <a
          href={stacksExplorerTxUrl(txId)}
          target="_blank"
          rel="noreferrer"
          className="block break-all text-[12px] font-bold underline underline-offset-2"
          style={{ color: "var(--paysats-accent)" }}
        >
          View on Hiro Explorer: {txId.slice(0, 18)}…
        </a>
      ) : null}
      {error ? (
        <p className="text-xs" style={{ color: "var(--paysats-danger)" }}>
          {error}
        </p>
      ) : null}
      {phase === "success" || phase === "failed" ? (
        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-[12px] px-3 py-2.5 text-[13px] font-extrabold"
          style={{
            background: "var(--paysats-surface-muted)",
            color: "var(--paysats-text)",
          }}
          data-pressable
        >
          {phase === "failed" ? "Try again" : "Done"}
        </button>
      ) : null}
    </div>
  );
}

function fieldClass(): CSSProperties {
  return {
    borderColor: "var(--paysats-border)",
    background: "var(--paysats-surface)",
    color: "var(--paysats-text)",
  };
}

export function ZestBorrowCard({
  address,
  sbtcSats,
  usdcxBalance,
  onChanged,
  embedded = false,
}: {
  address: string;
  sbtcSats: number | null;
  usdcxBalance: number | null;
  onChanged: () => void;
  embedded?: boolean;
}) {
  const zest = useStacksZest(address);
  const busy = zest.phase === "signing" || zest.phase === "pending";

  useEffect(() => {
    if (zest.phase === "success") onChanged();
  }, [zest.phase, onChanged]);

  const Shell = embedded ? "div" : Card;

  if (!zest.enabled) {
    return (
      <Shell className="space-y-2">
        {embedded ? null : (
          <div
            className="text-[13px] font-extrabold"
            style={{ color: "var(--paysats-text)" }}
          >
            Borrow USDCx against sBTC
          </div>
        )}
        <p className="text-[12px]" style={{ color: "var(--paysats-text-muted)" }}>
          Zest V2 borrowing is mainnet-only. Set NEXT_PUBLIC_STACKS_NETWORK=mainnet.
        </p>
      </Shell>
    );
  }

  const pos = zest.position;
  const showActive = Boolean(pos?.hasPosition);

  return (
    <Shell className="space-y-4">
      {embedded ? (
        <p
          className="text-[12px]"
          style={{ color: "var(--paysats-text-muted)" }}
        >
          Lock isolated sBTC on Zest, then borrow Circle USDCx. Your Bitcoin
          is not sold.
        </p>
      ) : (
        <div>
          <div
            className="text-[13px] font-extrabold"
            style={{ color: "var(--paysats-text)" }}
          >
            Borrow USDCx against sBTC
          </div>
          <p
            className="mt-1 text-[12px]"
            style={{ color: "var(--paysats-text-muted)" }}
          >
            Lock isolated sBTC on Zest, then borrow Circle USDCx. Your
            Bitcoin is not sold. Two wallet approvals back to back.
          </p>
        </div>
      )}

      {zest.error ? (
        <p className="text-xs" style={{ color: "var(--paysats-danger)" }}>
          {zest.error}
        </p>
      ) : null}

      <PendingBanner
        txId={zest.txId}
        kind={zest.txKind}
        phase={zest.phase}
        error={zest.txError}
        onDone={zest.reset}
      />

      {zest.loading && !pos ? (
        <p className="text-[12px]" style={{ color: "var(--paysats-text-faint)" }}>
          Loading position…
        </p>
      ) : showActive && pos ? (
        <ActivePosition
          zest={zest}
          pos={pos}
          sbtcSats={sbtcSats}
          usdcxBalance={usdcxBalance}
          busy={busy}
        />
      ) : (
        <OpenPosition
          zest={zest}
          sbtcSats={sbtcSats}
          busy={busy}
        />
      )}
    </Shell>
  );
}

function OpenPosition({
  zest,
  sbtcSats,
  busy,
}: {
  zest: ReturnType<typeof useStacksZest>;
  sbtcSats: number | null;
  busy: boolean;
}) {
  const [sats, setSats] = useState("");
  const [borrowUsd, setBorrowUsd] = useState("");
  const [preview, setPreview] = useState<
    Awaited<ReturnType<typeof zest.preview>> | "loading" | null
  >(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const collateralSats = satsFromInput(sats);
  const borrowRaw = usdcxRawFromInput(borrowUsd);
  const overSbtc =
    sbtcSats != null && collateralSats > BigInt(Math.floor(sbtcSats));

  const runPreview = useCallback(async () => {
    if (collateralSats <= BigInt(0) && borrowRaw <= BigInt(0)) {
      setPreview(null);
      return;
    }
    setPreview("loading");
    setPreviewError(null);
    try {
      const p = await zest.preview({
        collateralSats,
        borrowUsdcx: Number(borrowUsd) || 0,
      });
      setPreview(p);
    } catch (e) {
      setPreview(null);
      setPreviewError(e instanceof Error ? e.message : "Preview failed");
    }
  }, [borrowRaw, borrowUsd, collateralSats, zest.preview]);

  useEffect(() => {
    const t = setTimeout(() => void runPreview(), 400);
    return () => clearTimeout(t);
  }, [runPreview]);

  const maxEnterRaw =
    preview && preview !== "loading"
      ? floorUsdcxToCents(BigInt(preview.maxBorrowRaw))
      : null;
  const maxEnterLabel = maxEnterRaw != null ? usdcxCentsLabel(maxEnterRaw) : null;
  const within =
    preview && preview !== "loading"
      ? borrowRaw <= BigInt(0) ||
        preview.withinLimit ||
        (maxEnterRaw != null && borrowRaw <= maxEnterRaw)
      : true;

  const onOpen = async () => {
    if (collateralSats <= BigInt(0) || borrowRaw <= BigInt(0) || overSbtc) {
      return;
    }
    if (preview && preview !== "loading" && !within) return;
    try {
      await zest.openLine({
        collateralSats,
        borrowUsdcxRaw: borrowRaw,
      });
    } catch {
      /* surfaced via txError */
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div
            className="text-[11px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--paysats-text-muted)" }}
          >
            Lock sBTC (sats)
          </div>
          <span
            className="text-[11px] tabular-nums"
            style={{ color: "var(--paysats-text-faint)" }}
          >
            Available {sbtcSats != null ? formatSats(sbtcSats) : "—"} sats
          </span>
        </div>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={sats}
          onChange={(e) => setSats(e.target.value)}
          className="w-full rounded-[12px] border px-3 py-2 text-[14px] font-semibold tabular-nums"
          style={fieldClass()}
          placeholder="50000"
        />
        {overSbtc ? (
          <p className="mt-1 text-xs" style={{ color: "var(--paysats-danger)" }}>
            Amount exceeds your sBTC balance.
          </p>
        ) : null}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <div
            className="text-[11px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--paysats-text-muted)" }}
          >
            Borrow USDCx
          </div>
          {maxEnterLabel != null ? (
            <button
              type="button"
              onClick={() => setBorrowUsd(maxEnterLabel)}
              className="text-[11px] font-extrabold"
              style={{ color: "var(--paysats-accent)" }}
              data-pressable
            >
              Max {formatUsd(Number(maxEnterLabel))}
            </button>
          ) : null}
        </div>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={borrowUsd}
          onChange={(e) => setBorrowUsd(e.target.value)}
          className="w-full rounded-[12px] border px-3 py-2 text-[14px] font-semibold tabular-nums"
          style={fieldClass()}
          placeholder="0.00"
        />
      </div>

      {preview === "loading" ? (
        <p className="text-[11px]" style={{ color: "var(--paysats-text-faint)" }}>
          Quoting health…
        </p>
      ) : preview ? (
        <div
          className="rounded-[12px] px-3 py-2"
          style={{ background: "var(--paysats-surface-muted)" }}
        >
          <StatRow
            label="Projected LTV"
            value={`${preview.projectedLtvPercent.toFixed(1)}% / ${preview.risk.ltvBorrowPercent.toFixed(0)}% max`}
          />
          <StatRow
            label="Liq. price (partial)"
            value={
              preview.liquidationBtcPrice
                ? formatUsd(preview.liquidationBtcPrice, 0)
                : "—"
            }
          />
          <StatRow
            label="Max you can enter"
            value={`${formatUsd(Number(maxEnterLabel ?? 0))} (80% of Zest LTV)`}
          />
          {!within ? (
            <p className="pt-1 text-xs" style={{ color: "var(--paysats-danger)" }}>
              Borrow is above the conservative cap. Use Max or lock more sBTC.
            </p>
          ) : null}
        </div>
      ) : null}

      {previewError ? (
        <p className="text-xs" style={{ color: "var(--paysats-danger)" }}>
          {previewError}
        </p>
      ) : null}

      <p className="text-[11px]" style={{ color: "var(--paysats-text-faint)" }}>
        Two wallet approvals back to back: lock sBTC, then borrow USDCx.
        If BTC falls, Zest can liquidate. Isolated mode — your sats are
        not lent out.
      </p>

      <GradButton
        onClick={() => void onOpen()}
        disabled={
          busy ||
          overSbtc ||
          collateralSats <= BigInt(0) ||
          borrowRaw <= BigInt(0) ||
          preview === "loading" ||
          !within
        }
      >
        {busy ? "Confirm in wallet…" : "Lock sBTC & borrow"}
      </GradButton>
    </div>
  );
}

function ActivePosition({
  zest,
  pos,
  sbtcSats,
  usdcxBalance,
  busy,
}: {
  zest: ReturnType<typeof useStacksZest>;
  pos: NonNullable<ReturnType<typeof useStacksZest>["position"]>;
  sbtcSats: number | null;
  usdcxBalance: number | null;
  busy: boolean;
}) {
  const [panel, setPanel] = useState<"borrow" | "repay" | "add" | null>(
    "borrow",
  );
  const [borrowAmt, setBorrowAmt] = useState("");
  const [repayAmt, setRepayAmt] = useState("");
  const [addSats, setAddSats] = useState("");

  const fullyRepaid =
    BigInt(pos.debtUsdcxRaw) === BigInt(0) &&
    BigInt(pos.collateralSats) > BigInt(0);

  const maxAdd = useMemo(
    () => usdcxRawFromInput(borrowAmt),
    [borrowAmt],
  );
  const repayRaw = usdcxRawFromInput(repayAmt);
  const addRaw = satsFromInput(addSats);

  const canRepayAll =
    usdcxBalance != null && usdcxBalance + 0.000001 >= pos.debtUsdcx;

  const doBorrowMore = async () => {
    const amt = usdcxRawFromInput(borrowAmt);
    if (amt <= BigInt(0)) return;
    const maxEnter = floorUsdcxToCents(BigInt(pos.maxAdditionalBorrowRaw));
    if (amt > maxEnter) return;
    try {
      await zest.borrow(amt);
      setBorrowAmt("");
    } catch {
      /* txError */
    }
  };

  const doRepay = async () => {
    if (repayRaw <= BigInt(0)) return;
    try {
      await zest.repay(repayRaw);
      setRepayAmt("");
    } catch {
      /* txError */
    }
  };

  const doRepayAll = async () => {
    const debt = BigInt(pos.debtUsdcxRaw);
    if (debt <= BigInt(0)) return;
    const buffer = debt / BigInt(200) + BigInt(10_000); // 0.5% + 1¢
    try {
      await zest.repay(debt + buffer);
      setRepayAmt("");
    } catch {
      /* txError */
    }
  };

  const doAdd = async () => {
    if (addRaw <= BigInt(0)) return;
    try {
      await zest.lockCollateral(addRaw);
      setAddSats("");
    } catch {
      /* txError */
    }
  };

  const doWithdrawAll = async () => {
    const collat = BigInt(pos.collateralSats);
    if (collat <= BigInt(0) || BigInt(pos.debtUsdcxRaw) > BigInt(0)) return;
    try {
      await zest.withdraw(collat);
    } catch {
      /* txError */
    }
  };

  return (
    <div className="space-y-3">
      {fullyRepaid ? (
        <p className="text-[12px]" style={{ color: "var(--paysats-text-muted)" }}>
          sBTC is locked and you have no debt. Borrow USDCx now, or withdraw
          the collateral.
        </p>
      ) : null}
      <StatRow
        label="Outstanding"
        value={`${formatUsd(pos.debtUsdcx)} USDCx`}
      />
      <StatRow
        label="Locked sBTC"
        value={`${formatSats(Number(pos.collateralSats))} sats · ${formatUsd(pos.collateralUsd)}`}
      />
      <StatRow
        label="LTV"
        value={`${pos.health.ltvPercent.toFixed(1)}% / ${pos.risk.ltvBorrowPercent.toFixed(0)}% max`}
      />
      <StatRow
        label="Liq. price"
        value={
          pos.liquidationBtcPrice
            ? formatUsd(pos.liquidationBtcPrice, 0)
            : "—"
        }
      />
      <HealthBar score={pos.health.safetyScore} zone={pos.health.zone} />

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { key: "borrow" as const, label: "Borrow" },
            { key: "repay" as const, label: "Repay" },
            { key: "add" as const, label: "Add sBTC" },
          ] as const
        ).map((b) => {
          const active = panel === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => setPanel((cur) => (cur === b.key ? null : b.key))}
              className="rounded-[14px] px-2 py-2.5 text-[12px] font-extrabold transition"
              style={{
                background: active
                  ? "var(--paysats-accent)"
                  : "var(--paysats-surface-muted)",
                color: active ? "#fff" : "var(--paysats-text)",
              }}
              data-pressable
            >
              {b.label}
            </button>
          );
        })}
      </div>

      <InlinePanel open={panel === "borrow"}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span
              className="text-[11px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--paysats-text-muted)" }}
            >
              {fullyRepaid ? "Borrow USDCx" : "Borrow more"}
            </span>
            <button
              type="button"
              onClick={() =>
                setBorrowAmt(
                  usdcxCentsLabel(BigInt(pos.maxAdditionalBorrowRaw)),
                )
              }
              className="text-[11px] font-extrabold"
              style={{ color: "var(--paysats-accent)" }}
              data-pressable
            >
              Max{" "}
              {formatUsd(
                Number(usdcxCentsLabel(BigInt(pos.maxAdditionalBorrowRaw))),
              )}
            </button>
          </div>
          <input
            type="number"
            inputMode="decimal"
            value={borrowAmt}
            onChange={(e) => setBorrowAmt(e.target.value)}
            className="w-full rounded-[12px] border px-3 py-2 text-[14px] font-semibold tabular-nums"
            style={fieldClass()}
            placeholder="0.00"
          />
          <GradButton
            onClick={() => void doBorrowMore()}
            disabled={
              busy ||
              maxAdd <= BigInt(0) ||
              BigInt(pos.maxAdditionalBorrowRaw) === BigInt(0)
            }
          >
            {busy ? "Confirm in wallet…" : "Borrow USDCx"}
          </GradButton>
        </div>
      </InlinePanel>

      <InlinePanel open={panel === "repay"}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span
              className="text-[11px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--paysats-text-muted)" }}
            >
              Repay USDCx
            </span>
            <span
              className="text-[11px] tabular-nums"
              style={{ color: "var(--paysats-text-faint)" }}
            >
              Wallet {usdcxBalance != null ? formatUsd(usdcxBalance) : "—"}
            </span>
          </div>
          <input
            type="number"
            inputMode="decimal"
            value={repayAmt}
            onChange={(e) => setRepayAmt(e.target.value)}
            className="w-full rounded-[12px] border px-3 py-2 text-[14px] font-semibold tabular-nums"
            style={fieldClass()}
            placeholder="0.00"
          />
          <div className="grid grid-cols-2 gap-2">
            <GradButton
              onClick={() => void doRepay()}
              disabled={busy || repayRaw <= BigInt(0)}
            >
              {busy ? "…" : "Repay"}
            </GradButton>
            <button
              type="button"
              onClick={() => void doRepayAll()}
              disabled={busy || !canRepayAll}
              className="rounded-[14px] px-3 py-3 text-[13px] font-extrabold disabled:opacity-50"
              style={{
                background: "var(--paysats-surface-muted)",
                color: "var(--paysats-accent)",
              }}
              data-pressable
            >
              Repay all
            </button>
          </div>
          {!canRepayAll ? (
            <p className="text-[11px]" style={{ color: "var(--paysats-text-muted)" }}>
              Need {formatUsd(pos.debtUsdcx)} USDCx in your wallet to repay in full.
            </p>
          ) : null}
        </div>
      </InlinePanel>

      <InlinePanel open={panel === "add"}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span
              className="text-[11px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--paysats-text-muted)" }}
            >
              Add sBTC (sats)
            </span>
            <span
              className="text-[11px] tabular-nums"
              style={{ color: "var(--paysats-text-faint)" }}
            >
              Available {sbtcSats != null ? formatSats(sbtcSats) : "—"}
            </span>
          </div>
          <input
            type="number"
            inputMode="numeric"
            value={addSats}
            onChange={(e) => setAddSats(e.target.value)}
            className="w-full rounded-[12px] border px-3 py-2 text-[14px] font-semibold tabular-nums"
            style={fieldClass()}
            placeholder="10000"
          />
          <GradButton
            onClick={() => void doAdd()}
            disabled={busy || addRaw <= BigInt(0)}
          >
            {busy ? "Confirm in wallet…" : "Lock more sBTC"}
          </GradButton>
        </div>
      </InlinePanel>

      {fullyRepaid ? (
        <GradButton onClick={() => void doWithdrawAll()} disabled={busy}>
          {busy ? "Confirm in wallet…" : "Withdraw all sBTC"}
        </GradButton>
      ) : null}
    </div>
  );
}
