-- CreateTable
CREATE TABLE "StacksDcaOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stacksAddress" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "groupId" TEXT,
    "keeperContractId" TEXT NOT NULL,
    "amountPerOrderRaw" TEXT NOT NULL,
    "numberOfOrders" INTEGER NOT NULL,
    "executionFrequency" INTEGER NOT NULL,
    "fundingAmountRaw" TEXT NOT NULL,
    "fundingTxId" TEXT,
    "quotedOutRaw" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_funding',
    "nextExecutionAt" TIMESTAMP(3),
    "remainingOrders" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StacksDcaOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StacksDcaExecution" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "bitflowOrderId" TEXT,
    "txId" TEXT,
    "amountInRaw" TEXT,
    "amountOutRaw" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StacksDcaExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StacksDcaOrder_groupId_key" ON "StacksDcaOrder"("groupId");

-- CreateIndex
CREATE INDEX "StacksDcaOrder_userId_idx" ON "StacksDcaOrder"("userId");

-- CreateIndex
CREATE INDEX "StacksDcaOrder_stacksAddress_idx" ON "StacksDcaOrder"("stacksAddress");

-- CreateIndex
CREATE INDEX "StacksDcaOrder_status_idx" ON "StacksDcaOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StacksDcaExecution_orderId_bitflowOrderId_key" ON "StacksDcaExecution"("orderId", "bitflowOrderId");

-- CreateIndex
CREATE INDEX "StacksDcaExecution_orderId_idx" ON "StacksDcaExecution"("orderId");

-- CreateIndex
CREATE INDEX "StacksDcaExecution_txId_idx" ON "StacksDcaExecution"("txId");

-- AddForeignKey
ALTER TABLE "StacksDcaOrder" ADD CONSTRAINT "StacksDcaOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StacksDcaExecution" ADD CONSTRAINT "StacksDcaExecution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StacksDcaOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
