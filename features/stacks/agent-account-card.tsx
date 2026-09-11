"use client";

import { Card } from "@/components/ui/card";
import { GradButton } from "@/components/ui/grad-button";
import { Input } from "@/components/ui/input";
import { useStacksAgent } from "@/hooks/use-stacks-agent";
import { stacksExplorerAddressUrl, stacksExplorerTxUrl } from "@/lib/stacks/config";
import { QRCodeSVG } from "qrcode.react";
import { useMemo, useState } from "react";

function shortAddress(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

function isReady(
  w: ReturnType<typeof useStacksAgent>["wallet"],
): w is Extract<NonNullable<ReturnType<typeof useStacksAgent>["wallet"]>, { agentReady: true }> {
  return Boolean(w && w.agentReady);
}

export function AgentAccountCard() {
  const agent = useStacksAgent();
  const [showImport, setShowImport] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);
  const [withdrawToken, setWithdrawToken] = useState<"usdcx" | "sbtc" | "stx">(
    "usdcx",
  );
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawTx, setWithdrawTx] = useState<string | null>(null);

  const view = isReady(agent.wallet) ? agent.wallet : null;

  const mcpSnippet = useMemo(() => {
    if (!view) return "";
    return JSON.stringify(
      {
        mcpServers: {
          "paysats-stacks": {
            url: view.mcp.url,
          },
        },
      },
      null,
      2,
    );
  }, [view]);

  const copyAddr = async () => {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.agentAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  const copyMcp = async () => {
    try {
      await navigator.clipboard.writeText(mcpSnippet);
      setCopiedMcp(true);
      window.setTimeout(() => setCopiedMcp(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <Card className="space-y-3">
      <div>
        <div
          className="text-[11px] font-bold uppercase tracking-[0.08em]"
          style={{ color: "var(--paysats-text-muted)" }}
        >
          Agent account
        </div>
        <div
          className="mt-1 text-[13px] font-extrabold"
          style={{ color: "var(--paysats-text)" }}
        >
          Claude signs from this Stacks address
        </div>
        <p className="mt-1 text-[12px]" style={{ color: "var(--paysats-text-muted)" }}>
          Fund it with USDCx, sBTC, and a little STX. DCA, borrow, and withdraw
          run without Leather prompts. Withdraw sends back to your linked
          Leather wallet.
        </p>
      </div>

      {agent.error ? (
        <p className="text-xs" style={{ color: "var(--paysats-danger)" }}>
          {agent.error}
        </p>
      ) : null}

      {agent.loading && !view ? (
        <p className="text-[12px]" style={{ color: "var(--paysats-text-muted)" }}>
          Loading…
        </p>
      ) : null}

      {!view ? (
        <>
          <GradButton onClick={() => void agent.generate()} disabled={agent.busy}>
            {agent.busy ? "Creating…" : "Create agent account"}
          </GradButton>
          <button
            type="button"
            className="text-[12px] font-bold underline-offset-2 hover:underline"
            style={{ color: "var(--paysats-accent)" }}
            onClick={() => setShowImport((v) => !v)}
          >
            {showImport ? "Hide import" : "Use my own Stacks key"}
          </button>
          {showImport ? (
            <div className="space-y-2">
              <p className="text-[11px]" style={{ color: "var(--paysats-danger)" }}>
                PaySats will be able to sign as this wallet until you remove the
                key. Prefer a dedicated account, not your main savings wallet.
              </p>
              <Input
                type="password"
                autoComplete="off"
                placeholder="Hex private key"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
              />
              <GradButton
                disabled={agent.busy || privateKey.trim().length < 64}
                onClick={() => {
                  void agent.importKey(privateKey).then(() => setPrivateKey(""));
                }}
              >
                Import key
              </GradButton>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {view.bnsName ? (
            <div
              className="text-[13px] font-extrabold"
              style={{ color: "var(--paysats-accent)" }}
            >
              {view.bnsName}
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a
                href={stacksExplorerAddressUrl(view.agentAddress)}
                target="_blank"
                rel="noreferrer"
                className="block text-[14px] font-extrabold tabular-nums underline-offset-2 hover:underline"
                style={{ color: "var(--paysats-text)" }}
              >
                {shortAddress(view.agentAddress)}
              </a>
              <div
                className="mt-1 text-[11px]"
                style={{ color: "var(--paysats-text-muted)" }}
              >
                {view.keySource === "imported" ? "Imported key" : "PaySats-managed"}
                {view.linkedAddress
                  ? ` · withdraw to ${shortAddress(view.linkedAddress)}`
                  : " · connect Leather below to set a withdraw destination"}
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-full px-3 py-1 text-[11px] font-extrabold"
              style={{
                background: "var(--paysats-accent-soft)",
                color: "var(--paysats-accent)",
              }}
              onClick={() => void copyAddr()}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div
            className="mx-auto flex h-36 w-36 items-center justify-center rounded-[14px] bg-white p-2"
            aria-label="QR code for agent address"
          >
            <QRCodeSVG
              value={view.agentAddress}
              size={128}
              bgColor="#ffffff"
              fgColor="#1a120b"
              level="M"
              marginSize={0}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[11px]" style={{ color: "var(--paysats-text-muted)" }}>
                USDCx
              </div>
              <div className="text-[13px] font-extrabold tabular-nums">
                {view.balances.usdcx.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <div>
              <div className="text-[11px]" style={{ color: "var(--paysats-text-muted)" }}>
                sBTC
              </div>
              <div className="text-[13px] font-extrabold tabular-nums">
                {view.balances.sbtcSats.toLocaleString()} sats
              </div>
            </div>
            <div>
              <div className="text-[11px]" style={{ color: "var(--paysats-text-muted)" }}>
                STX
              </div>
              <div className="text-[13px] font-extrabold tabular-nums">
                {view.balances.stx.toLocaleString(undefined, {
                  maximumFractionDigits: 4,
                })}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div
              className="text-[11px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--paysats-text-muted)" }}
            >
              Withdraw
            </div>
            <div className="flex gap-2">
              {(["usdcx", "sbtc", "stx"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="rounded-full px-3 py-1 text-[11px] font-extrabold uppercase"
                  style={{
                    background:
                      withdrawToken === t
                        ? "var(--paysats-accent-soft)"
                        : "var(--paysats-surface-muted)",
                    color:
                      withdrawToken === t
                        ? "var(--paysats-accent)"
                        : "var(--paysats-text-muted)",
                  }}
                  onClick={() => setWithdrawToken(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <Input
              inputMode="decimal"
              placeholder={withdrawToken === "sbtc" ? "sats" : "amount"}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
            />
            <GradButton
              disabled={agent.busy || !withdrawAmount}
              onClick={() => {
                const amount = Number(withdrawAmount);
                if (!Number.isFinite(amount) || amount <= 0) return;
                void agent
                  .withdraw({ token: withdrawToken, amount })
                  .then((r) => {
                    if (r.txId) setWithdrawTx(r.txId);
                    setWithdrawAmount("");
                  });
              }}
            >
              {agent.busy ? "Sending…" : "Withdraw to Leather"}
            </GradButton>
            {withdrawTx ? (
              <a
                href={stacksExplorerTxUrl(withdrawTx)}
                target="_blank"
                rel="noreferrer"
                className="block text-[12px] underline-offset-2 hover:underline"
                style={{ color: "var(--paysats-accent)" }}
              >
                View withdraw tx
              </a>
            ) : null}
          </div>

          <div className="space-y-2">
            <div
              className="text-[11px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--paysats-text-muted)" }}
            >
              Claude MCP
            </div>
            <p
              className="text-[11px]"
              style={{ color: "var(--paysats-text-muted)" }}
            >
              Connect Claude to this URL, then approve with Leather / Xverse
              (not Google). Keep{" "}
              <code>privymcp.paysats.exchange</code> for Base / Privy.
            </p>
            <pre
              className="overflow-x-auto rounded-[12px] p-3 text-[10px] leading-4"
              style={{
                background: "var(--paysats-surface-muted)",
                color: "var(--paysats-text)",
              }}
            >
              {mcpSnippet}
            </pre>
            <button
              type="button"
              className="text-[12px] font-bold underline-offset-2 hover:underline"
              style={{ color: "var(--paysats-accent)" }}
              onClick={() => void copyMcp()}
            >
              {copiedMcp ? "Copied config" : "Copy Claude MCP config"}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
