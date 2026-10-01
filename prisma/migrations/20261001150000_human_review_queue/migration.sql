-- CreateEnum
CREATE TYPE "HumanReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED');

-- CreateTable
CREATE TABLE "HumanReviewRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" "HumanReviewStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "fingerprint" TEXT NOT NULL,
    "triggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "calls" JSONB NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "userEmail" TEXT,
    "department" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "waiverScope" TEXT,
    "expiresAt" TIMESTAMP(3),
    "usesRemaining" INTEGER,
    "lastWaivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumanReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HumanReviewRequest_agentId_status_createdAt_idx" ON "HumanReviewRequest"("agentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "HumanReviewRequest_status_createdAt_idx" ON "HumanReviewRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "HumanReviewRequest_agentId_fingerprint_status_idx" ON "HumanReviewRequest"("agentId", "fingerprint", "status");

-- AddForeignKey
ALTER TABLE "HumanReviewRequest" ADD CONSTRAINT "HumanReviewRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanReviewRequest" ADD CONSTRAINT "HumanReviewRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

