-- Milestone 3: per-user Stacks agent account + MCP action trail
ALTER TABLE "User" ADD COLUMN "stacksAgentAddress" TEXT;
ALTER TABLE "User" ADD COLUMN "stacksAgentKeyEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "stacksAgentKeySource" TEXT;
ALTER TABLE "User" ADD COLUMN "stacksAgentCreatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_stacksAgentAddress_key" ON "User"("stacksAgentAddress");

CREATE TABLE "StacksAgentAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "txId" TEXT,
    "network" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paramsJson" TEXT,
    "resultJson" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StacksAgentAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StacksAgentAction_userId_idx" ON "StacksAgentAction"("userId");
CREATE INDEX "StacksAgentAction_txId_idx" ON "StacksAgentAction"("txId");

ALTER TABLE "StacksAgentAction" ADD CONSTRAINT "StacksAgentAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
