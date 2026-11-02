-- Store every probe response of a sensitive scan (flagged or not) so reviewers
-- can read what the model actually answered each bait prompt with. Text is
-- sanitized and truncated before storage.
CREATE TABLE "SensitiveProbeResult" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "model" TEXT,
    "probeId" TEXT NOT NULL,
    "probeLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseExcerpt" TEXT,
    "responseLength" INTEGER NOT NULL DEFAULT 0,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "severity" TEXT,
    "categories" TEXT[],
    "findingId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensitiveProbeResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SensitiveProbeResult_scanId_idx" ON "SensitiveProbeResult"("scanId");

ALTER TABLE "SensitiveProbeResult" ADD CONSTRAINT "SensitiveProbeResult_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "SensitiveScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
