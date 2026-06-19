"use client";

import { Card } from "@/components/ui/card";
import { formatIdr, type RedeemRecord } from "@/hooks/use-offramp";
import { useT } from "@/lib/i18n";
import type { OfframpStage } from "@/services/idrx/offramp-settlement";
import type { TranslationKey } from "@/lib/translations";

const stageOrder: OfframpStage[] = [
  "pending_transfer",
  "swapping",
  "burning",
  "disbursed",
];

function stageLabelKey(stage: OfframpStage): TranslationKey {
  switch (stage) {
    case "pending_transfer":
      return "offramp.stageTransfer";
    case "swapping":
      return "offramp.stageSwap";
    case "burning":
      return "offramp.stageBurn";
    case "disbursed":
      return "offramp.stageDisbursed";
    case "failed":
      return "offramp.stageFailed";
  }
}

function BasescanLink({
  hash,
  label,
}: {
  hash: string | null | undefined;
  label: string;
}) {
  if (!hash) {
    return (
      <span className="rounded bg-paysats-surface-muted px-2 py-1 text-[11px] text-paysats-text-muted">
        {label}
      </span>
    );
  }
  return (
    <a
      href={`https://basescan.org/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="rounded bg-paysats-accent/10 px-2 py-1 text-[11px] font-medium text-paysats-accent hover:bg-paysats-accent/20"
    >
      {label} ↗
    </a>
  );
}

export function RedeemStatusCard({ record }: { record: RedeemRecord }) {
  const t = useT();
  const stage = record.settlement.stage;

  const activeIdx =
    stage === "failed" ? -1 : stageOrder.indexOf(stage);

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-paysats-text-muted">
            {record.bankName ?? "IDRX"} •{" "}
            {record.bankAccountNumber ? "••" + record.bankAccountNumber.slice(-4) : "—"}
          </p>
          <p className="text-base font-semibold text-paysats-text">
            {record.amountRedeem
              ? formatIdr(record.amountRedeem)
              : record.amountTo
                ? formatIdr(record.amountTo)
                : "—"}
          </p>
          <p className="text-xs text-paysats-text-muted">
            {new Date(record.createdAt).toLocaleString("id-ID")}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ${
            stage === "disbursed"
              ? "bg-green-500/10 text-green-600"
              : stage === "failed"
                ? "bg-red-500/10 text-paysats-danger"
                : "bg-amber-500/10 text-amber-600"
          }`}
        >
          {t(stageLabelKey(stage))}
        </span>
      </div>

      {stage !== "failed" && (
        <div className="grid grid-cols-4 gap-1" aria-hidden>
          {stageOrder.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 rounded-full ${
                i <= activeIdx
                  ? "bg-paysats-accent"
                  : "bg-paysats-surface-muted"
              }`}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-paysats-text-muted">
        {t(record.settlement.summaryKey)}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <BasescanLink
          hash={record.transferTxHash}
          label={t("offramp.viewTransferTx")}
        />
        <BasescanLink
          hash={record.swapTxHash}
          label={t("offramp.viewSwapTx")}
        />
        <BasescanLink
          hash={record.burnTxHash}
          label={t("offramp.viewBurnTx")}
        />
      </div>
    </Card>
  );
}
