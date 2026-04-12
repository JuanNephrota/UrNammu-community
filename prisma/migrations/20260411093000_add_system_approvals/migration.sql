-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'REVOKED');

-- CreateTable
CREATE TABLE "SystemApproval" (
    "id" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemApproval_aiSystemId_createdAt_idx" ON "SystemApproval"("aiSystemId", "createdAt");

-- CreateIndex
CREATE INDEX "SystemApproval_decidedByUserId_createdAt_idx" ON "SystemApproval"("decidedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "SystemApproval" ADD CONSTRAINT "SystemApproval_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AISystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemApproval" ADD CONSTRAINT "SystemApproval_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
