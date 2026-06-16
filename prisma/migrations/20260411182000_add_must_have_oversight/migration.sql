ALTER TABLE "Alert"
ADD COLUMN "aiSystemId" TEXT,
ADD COLUMN "governanceIncidentId" TEXT;

CREATE TABLE "EvidenceArtifact" (
    "id" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT,
    "linkUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GovernanceIncident" (
    "id" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "openedByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovernanceIncident_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvidenceArtifact_aiSystemId_createdAt_idx" ON "EvidenceArtifact"("aiSystemId", "createdAt");
CREATE INDEX "EvidenceArtifact_uploadedByUserId_createdAt_idx" ON "EvidenceArtifact"("uploadedByUserId", "createdAt");
CREATE INDEX "GovernanceIncident_aiSystemId_status_openedAt_idx" ON "GovernanceIncident"("aiSystemId", "status", "openedAt");
CREATE INDEX "GovernanceIncident_openedByUserId_createdAt_idx" ON "GovernanceIncident"("openedByUserId", "createdAt");

ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AISystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GovernanceIncident" ADD CONSTRAINT "GovernanceIncident_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AISystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GovernanceIncident" ADD CONSTRAINT "GovernanceIncident_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AISystem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_governanceIncidentId_fkey" FOREIGN KEY ("governanceIncidentId") REFERENCES "GovernanceIncident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
