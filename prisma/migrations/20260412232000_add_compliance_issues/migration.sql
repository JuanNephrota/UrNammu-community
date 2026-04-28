-- CreateTable
CREATE TABLE "ComplianceIssue" (
    "id" TEXT NOT NULL,
    "policyAssignmentId" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "remediation" TEXT,
    "severity" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "status" "RiskIssueStatus" NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL DEFAULT 'ai_assessment',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceIssue_policyAssignmentId_status_createdAt_idx" ON "ComplianceIssue"("policyAssignmentId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "ComplianceIssue" ADD CONSTRAINT "ComplianceIssue_policyAssignmentId_fkey" FOREIGN KEY ("policyAssignmentId") REFERENCES "PolicyAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
