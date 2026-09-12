import { errorMessage } from "@/services/errors";
import {
  mcpText as text,
  resolveMcpPaysatsUser,
  withPaysatsMcpAuth,
} from "@/services/mcp/auth";
import {
  sbtcDcaHistory,
  stacksAccountPayload,
} from "@/services/mcp/stacks-account";
import {
  borrowUsdcxAgainstSbtc,
  cancelSbtcDca,
  repayZestBorrow,
  setupSbtcDca,
  withdrawFromAgent,
  withdrawZestCollateral,
} from "@/services/stacks/agent-actions";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

function registerStacksTools(server: McpServer) {
  server.registerTool(
    "get_account",
    {
      title: "Get Stacks agent account",
      description:
        "Get the user's Stacks agent account: address, USDCx/sBTC/STX balances, sBTC DCA orders, and Zest position. Claude signs from this address after the user funds it.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const { row } = await resolveMcpPaysatsUser(extra.authInfo);
        const stacks = await stacksAccountPayload(row);
        return text(JSON.stringify({ stacks }, null, 2));
      } catch (e) {
        return text(errorMessage(e, "Failed to load Stacks account"));
      }
    },
  );

  server.registerTool(
    "setup_sbtc_dca",
    {
      title: "Set up sBTC DCA",
      description:
        "Create a recurring USDCx → sBTC DCA from the user's Stacks agent account. Signs a prepaid USDCx transfer to the PaySats keeper; sBTC payouts return to the agent address. If the agent USDCx balance is too low, returns needsDeposit with the agent address.",
      inputSchema: {
        amountUsdcx: z
          .number()
          .positive()
          .describe("USDCx to swap each interval."),
        numberOfOrders: z
          .number()
          .int()
          .min(2)
          .max(52)
          .describe("Number of buys (2–52)."),
        frequency: z
          .enum(["1min", "daily", "weekly", "monthly"])
          .describe("How often to buy. 1min is for testing only."),
      },
    },
    async ({ amountUsdcx, numberOfOrders, frequency }, extra) => {
      try {
        const { userId } = await resolveMcpPaysatsUser(extra.authInfo);
        const res = await setupSbtcDca({
          privyUserId: userId,
          amountUsdcx,
          numberOfOrders,
          frequency,
        });
        return text(JSON.stringify(res, null, 2));
      } catch (e) {
        return text(errorMessage(e, "Failed to set up sBTC DCA"));
      }
    },
  );

  server.registerTool(
    "cancel_sbtc_dca",
    {
      title: "Cancel sBTC DCA",
      description:
        "Cancel the user's active sBTC DCA and refund leftover prepaid USDCx to the agent account.",
      inputSchema: {
        orderId: z
          .string()
          .optional()
          .describe("Order id; omit to cancel the latest active order."),
      },
    },
    async ({ orderId }, extra) => {
      try {
        const { userId } = await resolveMcpPaysatsUser(extra.authInfo);
        const res = await cancelSbtcDca({
          privyUserId: userId,
          orderId,
        });
        return text(JSON.stringify(res, null, 2));
      } catch (e) {
        return text(errorMessage(e, "Failed to cancel sBTC DCA"));
      }
    },
  );

  server.registerTool(
    "get_sbtc_dca_status",
    {
      title: "Get sBTC DCA status",
      description: "List the user's Stacks sBTC DCA orders.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const { row } = await resolveMcpPaysatsUser(extra.authInfo);
        const payload = await stacksAccountPayload(row);
        if (!("dcaOrders" in payload)) {
          return text(JSON.stringify(payload, null, 2));
        }
        return text(JSON.stringify({ orders: payload.dcaOrders }, null, 2));
      } catch (e) {
        return text(errorMessage(e, "Failed to load sBTC DCA status"));
      }
    },
  );

  server.registerTool(
    "get_sbtc_dca_history",
    {
      title: "Get sBTC DCA history",
      description:
        "List executed USDCx → sBTC buys (swap + payout) for the user.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const { row } = await resolveMcpPaysatsUser(extra.authInfo);
        const hist = await sbtcDcaHistory(row.id);
        return text(JSON.stringify(hist, null, 2));
      } catch (e) {
        return text(errorMessage(e, "Failed to load sBTC DCA history"));
      }
    },
  );

  server.registerTool(
    "borrow",
    {
      title: "Borrow USDCx against sBTC",
      description:
        "Open or increase a Zest V2 isolated sBTC → USDCx borrow from the Stacks agent. Pass collateralSats=0 (or omit) to borrow more against already-locked sBTC. Pass borrowUsdcx=0 to only lock more collateral. Check get_borrow_status.maxAdditionalBorrowUsdcx first. If the agent sBTC/STX balance is too low, returns needsDeposit.",
      inputSchema: {
        collateralSats: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "sats to lock as isolated collateral. 0 or omit to borrow more against existing collateral.",
          ),
        borrowUsdcx: z
          .number()
          .min(0)
          .optional()
          .describe(
            "USDCx to borrow (must stay under maxAdditionalBorrowUsdcx). 0 to only add collateral.",
          ),
      },
    },
    async ({ collateralSats, borrowUsdcx }, extra) => {
      try {
        const { userId } = await resolveMcpPaysatsUser(extra.authInfo);
        const res = await borrowUsdcxAgainstSbtc({
          privyUserId: userId,
          collateralSats: collateralSats ?? 0,
          borrowUsdcx: borrowUsdcx ?? 0,
        });
        return text(JSON.stringify(res, null, 2));
      } catch (e) {
        return text(errorMessage(e, "Failed to borrow"));
      }
    },
  );

  server.registerTool(
    "repay",
    {
      title: "Repay Zest USDCx debt",
      description:
        "Repay USDCx debt on the Stacks agent's Zest position. The repaid USDCx is taken from the agent wallet (not Leather). Omit amountUsdcx or set full=true to repay all debt plus a small interest buffer. After debt is 0, call withdraw_collateral to unlock sBTC back to the agent. Returns needsDeposit if the agent USDCx balance is too low.",
      inputSchema: {
        amountUsdcx: z
          .number()
          .positive()
          .optional()
          .describe("USDCx to repay. Omit with full=true to close the debt."),
        full: z
          .boolean()
          .optional()
          .describe(
            "Repay all outstanding debt plus a 0.5%+1¢ buffer. Default true when amountUsdcx is omitted.",
          ),
      },
    },
    async ({ amountUsdcx, full }, extra) => {
      try {
        const { userId } = await resolveMcpPaysatsUser(extra.authInfo);
        const res = await repayZestBorrow({
          privyUserId: userId,
          amountUsdcx,
          full,
        });
        return text(JSON.stringify(res, null, 2));
      } catch (e) {
        return text(errorMessage(e, "Failed to repay"));
      }
    },
  );

  server.registerTool(
    "withdraw_collateral",
    {
      title: "Unlock sBTC from Zest",
      description:
        "Withdraw isolated sBTC from Zest back to the Stacks agent wallet. Debt must be 0 (call repay first). Omit collateralSats to unlock the full locked amount. This does not send to Leather — use withdraw afterwards if the user wants sBTC in Leather/Xverse.",
      inputSchema: {
        collateralSats: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("sats to unlock. Omit to withdraw all locked sBTC."),
      },
    },
    async ({ collateralSats }, extra) => {
      try {
        const { userId } = await resolveMcpPaysatsUser(extra.authInfo);
        const res = await withdrawZestCollateral({
          privyUserId: userId,
          collateralSats,
        });
        return text(JSON.stringify(res, null, 2));
      } catch (e) {
        return text(errorMessage(e, "Failed to withdraw collateral"));
      }
    },
  );

  server.registerTool(
    "get_borrow_status",
    {
      title: "Get Zest borrow status",
      description:
        "Live Zest position (sBTC collateral, USDCx debt, health) on the Stacks agent account.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const { row } = await resolveMcpPaysatsUser(extra.authInfo);
        const payload = await stacksAccountPayload(row);
        if (!("zest" in payload)) {
          return text(JSON.stringify(payload, null, 2));
        }
        return text(
          JSON.stringify(
            {
              zest: payload.zest,
              recentAgentActions: payload.recentAgentActions,
            },
            null,
            2,
          ),
        );
      } catch (e) {
        return text(errorMessage(e, "Failed to load borrow status"));
      }
    },
  );

  server.registerTool(
    "withdraw",
    {
      title: "Withdraw from agent account",
      description:
        "Send USDCx, sBTC, or STX from the Stacks agent account to the user's linked Leather wallet (or an explicit recipient).",
      inputSchema: {
        token: z.enum(["usdcx", "sbtc", "stx"]),
        amount: z
          .number()
          .positive()
          .describe("Human units for USDCx/STX; sats for sbtc."),
        recipient: z
          .string()
          .optional()
          .describe("Stacks address. Defaults to the linked Leather wallet."),
      },
    },
    async ({ token, amount, recipient }, extra) => {
      try {
        const { userId } = await resolveMcpPaysatsUser(extra.authInfo);
        const res = await withdrawFromAgent({
          privyUserId: userId,
          token,
          amount,
          recipient,
        });
        return text(JSON.stringify(res, null, 2));
      } catch (e) {
        return text(errorMessage(e, "Failed to withdraw"));
      }
    },
  );
}

export function createStacksMcpAuthHandler(basePath: string) {
  return withPaysatsMcpAuth(
    createMcpHandler(
      registerStacksTools,
      { serverInfo: { name: "paysats-stacks", version: "0.1.0" } },
      { basePath, disableSse: true, verboseLogs: false },
    ),
  );
}

export const stacksMcpApiHandler = createStacksMcpAuthHandler("/api/stxmcp");
export const stacksMcpRootHandler = createStacksMcpAuthHandler("");
