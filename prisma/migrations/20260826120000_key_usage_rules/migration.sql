-- CreateEnum
CREATE TYPE "KeyUsageConditionType" AS ENUM ('VOLUME_THRESHOLD', 'SPIKE_MULTIPLIER', 'NEW_KEY', 'DORMANT_REACTIVATION', 'OFF_HOURS', 'MODEL_ALLOWLIST', 'FAN_OUT');

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "keyUsageMetadata" JSONB;

-- CreateTable
CREATE TABLE "KeyUsageRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "conditionType" "KeyUsageConditionType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "providers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "apiKeyExternalIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "defaultLabel" TEXT,
    "defaultSeverity" "AlertSeverity",
    "defaultConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyUsageRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKeyProfile" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKeyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KeyUsageRule_key_key" ON "KeyUsageRule"("key");

-- CreateIndex
CREATE INDEX "KeyUsageRule_enabled_idx" ON "KeyUsageRule"("enabled");

-- CreateIndex
CREATE INDEX "KeyUsageRule_conditionType_idx" ON "KeyUsageRule"("conditionType");

-- CreateIndex
CREATE INDEX "ApiKeyProfile_provider_lastActiveAt_idx" ON "ApiKeyProfile"("provider", "lastActiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyProfile_provider_externalId_key" ON "ApiKeyProfile"("provider", "externalId");


-- Seed the built-in key-usage rules. Mirrors src/lib/key-usage-defaults.ts —
-- keep the two in sync. Admins can edit or disable these at
-- /alerts/key-usage-rules; the default* columns back "reset to default".
--
-- key_model_allowlist ships disabled: its allowlist is empty, and an empty
-- allowlist has no useful meaning until an admin populates it.
INSERT INTO "KeyUsageRule" (
  "id", "key", "label", "description", "conditionType", "severity",
  "providers", "apiKeyExternalIds", "config", "enabled", "builtIn",
  "defaultLabel", "defaultSeverity", "defaultConfig", "createdAt", "updatedAt"
) VALUES
  (gen_random_uuid()::text, 'key_spend_spike', 'API key spend spike', 'A key''s spend over the last 7 days is at least 3x its spend in the prior 7 days, on at least $25 of recent spend. Catches runaway loops, leaked keys, and unplanned batch jobs.', 'SPIKE_MULTIPLIER', 'HIGH', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '{"conditionType":"SPIKE_MULTIPLIER","metric":"cost","windowHours":168,"baselineHours":168,"multiplier":3,"minRecentCost":25}'::jsonb, true, true, 'API key spend spike', 'HIGH', '{"conditionType":"SPIKE_MULTIPLIER","metric":"cost","windowHours":168,"baselineHours":168,"multiplier":3,"minRecentCost":25}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'key_token_spike', 'API key token volume spike', 'A key''s token volume over the last 7 days is at least 3x the prior 7 days, on at least 250k recent tokens. Token spikes without a matching spend spike often mean a prompt or context change rather than more traffic.', 'SPIKE_MULTIPLIER', 'MEDIUM', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '{"conditionType":"SPIKE_MULTIPLIER","metric":"tokens","windowHours":168,"baselineHours":168,"multiplier":3,"minRecentTokens":250000}'::jsonb, true, true, 'API key token volume spike', 'MEDIUM', '{"conditionType":"SPIKE_MULTIPLIER","metric":"tokens","windowHours":168,"baselineHours":168,"multiplier":3,"minRecentTokens":250000}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'key_daily_spend_ceiling', 'API key exceeded daily spend ceiling', 'A single key spent more than $500 in 24 hours. An absolute ceiling, so it fires even when the spend has been consistently high and a spike rule would not.', 'VOLUME_THRESHOLD', 'HIGH', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '{"conditionType":"VOLUME_THRESHOLD","metric":"cost","windowHours":24,"threshold":500}'::jsonb, true, true, 'API key exceeded daily spend ceiling', 'HIGH', '{"conditionType":"VOLUME_THRESHOLD","metric":"cost","windowHours":24,"threshold":500}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'new_api_key_activity', 'New API key started transacting', 'A key never seen in telemetry before has moved at least 10k tokens. Worth confirming the key was issued deliberately and is attributable to a registered AI system.', 'NEW_KEY', 'MEDIUM', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '{"conditionType":"NEW_KEY","windowHours":24,"minTokens":10000}'::jsonb, true, true, 'New API key started transacting', 'MEDIUM', '{"conditionType":"NEW_KEY","windowHours":24,"minTokens":10000}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'dormant_key_reactivated', 'Dormant API key reactivated', 'A key idle for at least 30 days started transacting again. Reactivation of a forgotten key is a common signature of credential compromise.', 'DORMANT_REACTIVATION', 'HIGH', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '{"conditionType":"DORMANT_REACTIVATION","dormantDays":30,"windowHours":24,"minTokens":5000}'::jsonb, true, true, 'Dormant API key reactivated', 'HIGH', '{"conditionType":"DORMANT_REACTIVATION","dormantDays":30,"windowHours":24,"minTokens":5000}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'key_off_hours_activity', 'API key active outside business hours', 'A key moved at least 25k tokens outside 07:00-20:00 UTC on a weekday. Requires hourly-granularity telemetry — provider Admin API sync only reports daily totals, so this rule evaluates proxy-ingested keys only.', 'OFF_HOURS', 'MEDIUM', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '{"conditionType":"OFF_HOURS","windowHours":24,"businessHourStart":7,"businessHourEnd":20,"businessDays":[1,2,3,4,5],"timezoneOffsetMinutes":0,"minTokens":25000}'::jsonb, true, true, 'API key active outside business hours', 'MEDIUM', '{"conditionType":"OFF_HOURS","windowHours":24,"businessHourStart":7,"businessHourEnd":20,"businessDays":[1,2,3,4,5],"timezoneOffsetMinutes":0,"minTokens":25000}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'key_model_allowlist', 'API key used a non-approved model', 'A key invoked a model outside its allowlist. Ships disabled with an empty allowlist — add the model IDs your organization has approved, then enable it.', 'MODEL_ALLOWLIST', 'MEDIUM', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '{"conditionType":"MODEL_ALLOWLIST","windowHours":24,"allowedModels":[],"minTokens":1000}'::jsonb, false, true, 'API key used a non-approved model', 'MEDIUM', '{"conditionType":"MODEL_ALLOWLIST","windowHours":24,"allowedModels":[],"minTokens":1000}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'key_project_fan_out', 'API key spanning many projects', 'A single key was used across more than 5 distinct projects in 7 days. Broad reuse of one credential defeats per-project attribution and widens the blast radius if it leaks.', 'FAN_OUT', 'MEDIUM', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '{"conditionType":"FAN_OUT","windowHours":168,"dimension":"project","maxDistinct":5}'::jsonb, true, true, 'API key spanning many projects', 'MEDIUM', '{"conditionType":"FAN_OUT","windowHours":168,"dimension":"project","maxDistinct":5}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Serves the KeyUsageRule evaluator: the per-key telemetry window scan and the
-- min(bucketStart) first-seen backfill both filter on provider + key.
CREATE INDEX "UsageBucket_provider_apiKeyExternalId_bucketStart_idx" ON "UsageBucket"("provider", "apiKeyExternalId", "bucketStart");
