-- CreateTable
CREATE TABLE "CursorMetric" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serviceName" TEXT,
    "sessionId" TEXT,
    "userId" TEXT,
    "userEmail" TEXT,
    "appVersion" TEXT,
    "metricName" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "spanName" TEXT,
    "spanKind" TEXT,
    "genAiToolName" TEXT,
    "hookEvent" TEXT,
    "attributes" JSONB,

    CONSTRAINT "CursorMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CursorSpan" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "traceId" TEXT,
    "spanId" TEXT,
    "parentSpanId" TEXT,
    "sessionId" TEXT,
    "serviceName" TEXT,
    "userId" TEXT,
    "userEmail" TEXT,
    "appVersion" TEXT,
    "spanName" TEXT NOT NULL,
    "spanKind" TEXT,
    "hookEvent" TEXT,
    "genAiSystem" TEXT,
    "genAiModel" TEXT,
    "genAiOperation" TEXT,
    "genAiToolName" TEXT,
    "durationMs" INTEGER,
    "success" BOOLEAN,
    "riskSeverity" TEXT,
    "riskCategory" TEXT,
    "attributes" JSONB,

    CONSTRAINT "CursorSpan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CursorMetric_timestamp_idx" ON "CursorMetric"("timestamp");

-- CreateIndex
CREATE INDEX "CursorMetric_metricName_timestamp_idx" ON "CursorMetric"("metricName", "timestamp");

-- CreateIndex
CREATE INDEX "CursorMetric_userEmail_timestamp_idx" ON "CursorMetric"("userEmail", "timestamp");

-- CreateIndex
CREATE INDEX "CursorMetric_sessionId_timestamp_idx" ON "CursorMetric"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "CursorSpan_timestamp_idx" ON "CursorSpan"("timestamp");

-- CreateIndex
CREATE INDEX "CursorSpan_hookEvent_timestamp_idx" ON "CursorSpan"("hookEvent", "timestamp");

-- CreateIndex
CREATE INDEX "CursorSpan_spanKind_timestamp_idx" ON "CursorSpan"("spanKind", "timestamp");

-- CreateIndex
CREATE INDEX "CursorSpan_userEmail_timestamp_idx" ON "CursorSpan"("userEmail", "timestamp");

-- CreateIndex
CREATE INDEX "CursorSpan_sessionId_timestamp_idx" ON "CursorSpan"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "CursorSpan_traceId_idx" ON "CursorSpan"("traceId");

-- CreateIndex
CREATE INDEX "CursorSpan_riskSeverity_timestamp_idx" ON "CursorSpan"("riskSeverity", "timestamp");
