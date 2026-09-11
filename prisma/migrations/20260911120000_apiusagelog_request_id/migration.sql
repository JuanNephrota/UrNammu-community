-- Record the upstream provider request id on proxied calls.
--
-- Anthropic returns it as the `request-id` response header, OpenAI as
-- `x-request-id`. Claude Code's OTel `api_request` event already records the
-- same id (attributes->>'request_id'), so this column is the join between a
-- proxied call and the session trace it belongs to.
--
-- Additive and nullable: existing rows keep NULL (their request id was never
-- captured), and nothing reads the column until it is populated.

ALTER TABLE "APIUsageLog" ADD COLUMN "requestId" TEXT;

-- Traces look rows up by request id, a handful at a time.
CREATE INDEX "APIUsageLog_requestId_idx" ON "APIUsageLog"("requestId");
