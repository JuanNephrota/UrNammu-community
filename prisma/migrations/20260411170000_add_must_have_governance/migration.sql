CREATE TYPE "GovernanceReviewStage" AS ENUM ('OWNER', 'SECURITY', 'LEGAL', 'COMPLIANCE');

CREATE TYPE "GovernanceExceptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

ALTER TABLE "AISystem"
ADD COLUMN "reviewIntervalDays" INTEGER NOT NULL DEFAULT 365,
ADD COLUMN "nextReviewDate" TIMESTAMP(3),
ADD COLUMN "requireOwnerApproval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "requireSecurityApproval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "requireLegalApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requireComplianceApproval" BOOLEAN NOT NULL DEFAULT true;

UPDATE "AISystem"
SET "nextReviewDate" = NOW() + INTERVAL '365 days'
WHERE "nextReviewDate" IS NULL;

ALTER TABLE "AISystem"
ALTER COLUMN "nextReviewDate" SET NOT NULL;

CREATE TABLE "GovernanceReview" (
    "id" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "stage" "GovernanceReviewStage" NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernanceReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GovernanceException" (
    "id" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "GovernanceExceptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovernanceException_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GovernanceReview_aiSystemId_stage_createdAt_idx" ON "GovernanceReview"("aiSystemId", "stage", "createdAt");
CREATE INDEX "GovernanceReview_decidedByUserId_createdAt_idx" ON "GovernanceReview"("decidedByUserId", "createdAt");
CREATE INDEX "GovernanceException_aiSystemId_status_expiresAt_idx" ON "GovernanceException"("aiSystemId", "status", "expiresAt");
CREATE INDEX "GovernanceException_approvedByUserId_createdAt_idx" ON "GovernanceException"("approvedByUserId", "createdAt");

ALTER TABLE "GovernanceReview" ADD CONSTRAINT "GovernanceReview_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AISystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GovernanceReview" ADD CONSTRAINT "GovernanceReview_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GovernanceException" ADD CONSTRAINT "GovernanceException_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AISystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GovernanceException" ADD CONSTRAINT "GovernanceException_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
