-- AlterTable: Stacks pilot — externally-connected Stacks wallet linked to the account
ALTER TABLE "User" ADD COLUMN     "stacksAddress" TEXT,
ADD COLUMN     "stacksNetwork" TEXT,
ADD COLUMN     "stacksLinkedAt" TIMESTAMP(3);

-- CreateTable: durable record of USDCx -> sBTC swaps submitted via Bitflow
CREATE TABLE "StacksSwap" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stacksAddress" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "tokenIn" TEXT NOT NULL,
    "tokenOut" TEXT NOT NULL,
    "amountInRaw" TEXT NOT NULL,
    "amountOutRaw" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StacksSwap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StacksSwap_txId_key" ON "StacksSwap"("txId");

-- CreateIndex
CREATE INDEX "StacksSwap_userId_idx" ON "StacksSwap"("userId");

-- CreateIndex
CREATE INDEX "StacksSwap_stacksAddress_idx" ON "StacksSwap"("stacksAddress");

-- AddForeignKey
ALTER TABLE "StacksSwap" ADD CONSTRAINT "StacksSwap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
