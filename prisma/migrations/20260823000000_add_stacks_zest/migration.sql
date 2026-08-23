-- CreateTable: durable record of Zest V2 sBTC collateral / USDCx borrow txs
CREATE TABLE "StacksZestTx" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stacksAddress" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountRaw" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StacksZestTx_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StacksZestTx_txId_key" ON "StacksZestTx"("txId");

-- CreateIndex
CREATE INDEX "StacksZestTx_userId_idx" ON "StacksZestTx"("userId");

-- CreateIndex
CREATE INDEX "StacksZestTx_stacksAddress_idx" ON "StacksZestTx"("stacksAddress");

-- AddForeignKey
ALTER TABLE "StacksZestTx" ADD CONSTRAINT "StacksZestTx_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
