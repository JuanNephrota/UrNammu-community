-- Agent kill switch: suspending an agent makes both proxies refuse traffic
-- that carries its x-agent-id until it is resumed.
ALTER TABLE "AIAgent"
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedById" TEXT,
  ADD COLUMN "suspendedReason" TEXT;

ALTER TABLE "AIAgent"
  ADD CONSTRAINT "AIAgent_suspendedById_fkey"
  FOREIGN KEY ("suspendedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
