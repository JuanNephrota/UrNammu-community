-- CreateTable
CREATE TABLE "ProxyHealthSnapshot" (
    "id" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "invocationCount" INTEGER,
    "http2xxCount" INTEGER,
    "http4xxCount" INTEGER,
    "http5xxCount" INTEGER,
    "avgResponseTimeMs" DOUBLE PRECISION,
    "rawMetrics" JSONB,
    "syncError" TEXT,

    CONSTRAINT "ProxyHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProxyHealthSnapshot_capturedAt_idx" ON "ProxyHealthSnapshot"("capturedAt");
