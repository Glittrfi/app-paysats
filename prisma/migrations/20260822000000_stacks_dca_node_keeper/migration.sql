-- AlterTable
ALTER TABLE "StacksDcaOrder" ADD COLUMN "lastError" TEXT;

-- AlterTable
ALTER TABLE "StacksDcaExecution" ADD COLUMN "payoutTxId" TEXT;
