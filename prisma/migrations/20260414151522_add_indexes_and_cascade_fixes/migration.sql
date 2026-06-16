-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- CreateIndex
CREATE INDEX "Alert_aiSystemId_idx" ON "Alert"("aiSystemId");

-- CreateIndex
CREATE INDEX "Alert_status_createdAt_idx" ON "Alert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_aiSystemId_idx" ON "AuditLog"("aiSystemId");

-- CreateIndex
CREATE INDEX "AuditLog_agentId_idx" ON "AuditLog"("agentId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
