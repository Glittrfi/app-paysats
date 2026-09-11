import type { StacksNetworkId } from "@/lib/stacks/config";

export type AgentKeySource = "generated" | "imported";

export type AgentBalances = {
  address: string;
  network: StacksNetworkId;
  stxRaw: string;
  stx: number;
  usdcxRaw: string;
  usdcx: number;
  sbtcRaw: string;
  sbtcSats: number;
};

export type AgentWalletView = {
  agentReady: true;
  agentAddress: string;
  keySource: AgentKeySource;
  createdAt: string;
  linkedAddress: string | null;
  bnsName: string | null;
  balances: AgentBalances;
  mcp: {
    url: string;
    instructions: string;
  };
};

export type AgentWalletNotReady = {
  agentReady: false;
  connectUrl: string;
};
