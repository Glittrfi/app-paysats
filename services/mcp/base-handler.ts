import { CBBTC_DECIMALS } from "@/lib/contracts/paysats-dca";
import { errorMessage } from "@/services/errors";
import { getDcaExecutions } from "@/services/dca/executions-service";
import { getAccountBalances, getDcaOrder } from "@/services/dca/order-service";
import { cancelDca, setupDca } from "@/services/dca/signing-service";
import { createIdrMintRequest, MINT_MIN_IDR } from "@/services/idrx/mint-service";
import { getMintStatus } from "@/services/idrx/transactions-service";
import { getIdrxOnboardingStatus } from "@/services/idrx/onboarding-service";
import {
  mcpText as text,
  resolveMcpUser as resolveUser,
  withPaysatsMcpAuth,
} from "@/services/mcp/auth";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

function registerBaseTools(server: McpServer) {
  server.registerTool(
    "get_account",
    {
      title: "Get account",
      description:
        "Get the user's Base wallet address, IDRX and cbBTC balances, IDRX onboarding status, and active DCA order.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const user = await resolveUser(extra.authInfo);
        const [balances, order, onboarding] = await Promise.all([
          getAccountBalances(user),
          getDcaOrder(user),
          getIdrxOnboardingStatus(user),
        ]);
        return text(
          JSON.stringify(
            {
              walletAddress: balances.walletAddress,
              balances: {
                idrx: balances.idrxAmount,
                cbBtcSats: balances.cbBtcSats,
              },
              idrxOnboarded: onboarding.completed,
              dcaOrder: order,
            },
            null,
            2,
          ),
        );
      } catch (e) {
        return text(errorMessage(e, "Gagal memuat akun"));
      }
    },
  );

  server.registerTool(
    "create_idr_deposit",
    {
      title: "Create IDR deposit",
      description:
        "Create an IDR deposit (IDRX mint) request for the given rupiah amount. Returns a payment URL the human must open and pay (bank/QRIS). IDRX is minted to the user's smart wallet once paid. The agent cannot pay on the user's behalf.",
      inputSchema: {
        amountIdr: z
          .number()
          .int()
          .min(20_000)
          .max(1_000_000_000)
          .describe("Amount in Indonesian Rupiah (IDR), 20000 – 1000000000."),
      },
    },
    async ({ amountIdr }, extra) => {
      try {
        const user = await resolveUser(extra.authInfo);
        const res = await createIdrMintRequest(user, {
          toBeMinted: amountIdr,
        });
        return text(
          JSON.stringify(
            {
              paymentUrl: res.paymentUrl,
              amount: res.amount,
              reference: res.reference,
              merchantOrderId: res.merchantOrderId,
              destinationWalletAddress: res.destinationWalletAddress,
              instructions:
                "Open paymentUrl in a browser and complete the rupiah payment. Then call get_deposit_status with the reference to track settlement.",
            },
            null,
            2,
          ),
        );
      } catch (e) {
        return text(errorMessage(e, "Gagal membuat deposit"));
      }
    },
  );

  server.registerTool(
    "get_deposit_status",
    {
      title: "Get deposit status",
      description:
        "Check the payment and mint settlement status of an IDR deposit by its reference or merchantOrderId.",
      inputSchema: {
        reference: z.string().optional().describe("Mint request reference."),
        merchantOrderId: z
          .string()
          .optional()
          .describe("Mint request merchantOrderId."),
      },
    },
    async ({ reference, merchantOrderId }, extra) => {
      try {
        const user = await resolveUser(extra.authInfo);
        const tx = await getMintStatus(user, { reference, merchantOrderId });
        if (!tx) return text("Deposit tidak ditemukan.");
        return text(
          JSON.stringify(
            {
              reference: tx.reference,
              merchantOrderId: tx.merchantOrderId,
              paymentAmount: tx.paymentAmount,
              toBeMinted: tx.toBeMinted,
              paymentStatus: tx.paymentStatus,
              userMintStatus: tx.userMintStatus,
              settlement: tx.settlement,
              txHash: tx.txHash,
            },
            null,
            2,
          ),
        );
      } catch (e) {
        return text(errorMessage(e, "Gagal memuat status deposit"));
      }
    },
  );

  server.registerTool(
    "setup_dca",
    {
      title: "Set up recurring DCA",
      description:
        "Create a recurring DCA order that swaps IDRX into cbBTC on the chosen schedule. Signed server-side via the device-authorization grant, no browser needed. If the IDRX balance is too low, this returns needsDeposit=true with a deposit payment link for the shortfall instead of an error — share the link, then poll get_deposit_status and call setup_dca again once the deposit settles.",
      inputSchema: {
        amountIdr: z
          .number()
          .int()
          .positive()
          .describe("IDR amount to swap each interval."),
        frequency: z
          .enum(["daily", "weekly", "monthly"])
          .describe("How often to swap."),
        totalSwaps: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Number of swaps; 0 or omitted = unlimited."),
      },
    },
    async ({ amountIdr, frequency, totalSwaps }, extra) => {
      try {
        const user = await resolveUser(extra.authInfo);
        const res = await setupDca(user, {
          amountPerSwapIdr: amountIdr,
          frequency,
          totalSwaps,
        });

        if (res.status === "needs_deposit") {
          const depositIdr = Math.max(res.shortfallIdr, MINT_MIN_IDR);
          const deposit = await createIdrMintRequest(user, {
            toBeMinted: depositIdr,
          });
          return text(
            JSON.stringify(
              {
                ok: false,
                needsDeposit: true,
                balanceIdr: res.balanceIdr,
                requiredIdr: res.requiredIdr,
                shortfallIdr: res.shortfallIdr,
                deposit: {
                  amountIdr: depositIdr,
                  paymentUrl: deposit.paymentUrl,
                  reference: deposit.reference,
                  merchantOrderId: deposit.merchantOrderId,
                  destinationWalletAddress: deposit.destinationWalletAddress,
                },
                requestedDca: {
                  amountIdr,
                  frequency,
                  totalSwaps: totalSwaps ?? 0,
                },
                instructions:
                  "Share deposit.paymentUrl with the user to pay (bank/QRIS). After they pay, call get_deposit_status with deposit.reference until it settles/mints, then call setup_dca again with the same amountIdr, frequency, and totalSwaps to create the order.",
              },
              null,
              2,
            ),
          );
        }

        return text(
          JSON.stringify(
            {
              ok: true,
              transactionId: res.transactionId,
              amountPerSwapIdr: amountIdr,
              frequency,
              totalSwaps: totalSwaps ?? 0,
            },
            null,
            2,
          ),
        );
      } catch (e) {
        return text(errorMessage(e, "Failed to set up DCA"));
      }
    },
  );

  server.registerTool(
    "get_dca_status",
    {
      title: "Get DCA status",
      description: "Get the user's active recurring DCA order, if any.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const user = await resolveUser(extra.authInfo);
        const order = await getDcaOrder(user);
        if (!order) return text("Tidak ada order DCA aktif.");
        return text(JSON.stringify(order, null, 2));
      } catch (e) {
        return text(errorMessage(e, "Gagal memuat status DCA"));
      }
    },
  );

  server.registerTool(
    "cancel_dca",
    {
      title: "Cancel DCA",
      description: "Cancel the user's active recurring DCA order.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const user = await resolveUser(extra.authInfo);
        const res = await cancelDca(user);
        return text(
          JSON.stringify(
            { ok: true, transactionId: res.transactionId },
            null,
            2,
          ),
        );
      } catch (e) {
        return text(errorMessage(e, "Gagal membatalkan DCA"));
      }
    },
  );

  server.registerTool(
    "get_dca_history",
    {
      title: "Get DCA history",
      description:
        "List executed DCA swaps (IDRX spent and cbBTC/sats received) for the user.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const user = await resolveUser(extra.authInfo);
        const { executions } = await getDcaExecutions(user);
        const items = executions.map((e) => ({
          txHash: e.transactionHash,
          idrxSpent: Number(BigInt(e.idrxSpent)) / 100,
          satsReceived:
            Number(BigInt(e.cbBTCReceived)) / 10 ** (CBBTC_DECIMALS - 8),
          timestamp: e.timestamp,
        }));
        return text(
          JSON.stringify({ count: items.length, executions: items }, null, 2),
        );
      } catch (e) {
        return text(errorMessage(e, "Gagal memuat riwayat DCA"));
      }
    },
  );
}

export function createBaseMcpAuthHandler(basePath: string) {
  return withPaysatsMcpAuth(
    createMcpHandler(
      registerBaseTools,
      { serverInfo: { name: "paysats-dca", version: "0.1.0" } },
      { basePath, disableSse: true, verboseLogs: false },
    ),
  );
}

export const baseMcpApiHandler = createBaseMcpAuthHandler("/api/mcp");
export const baseMcpRootHandler = createBaseMcpAuthHandler("");
