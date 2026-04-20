-- One-off backfill: link historical Anthropic admin-sync UsageBucket rows
-- to the AISystem picked in Settings > Provider Admin APIs > Usage Attribution.
--
-- Safe to re-run: WHERE "aiSystemId" IS NULL prevents overwriting rows that
-- already got attribution (including proxy rows that were written with an
-- explicit x-ai-system-id header).
--
-- Scope:
--   provider     = 'anthropic'  -- OpenAI / Claude Code / Gemini not touched
--   granularity  = 'day'        -- matches what syncAnthropicTelemetry writes;
--                                  excludes proxy's 1h rows that already carry
--                                  per-request attribution when applicable
--   aiSystemId   IS NULL        -- don't clobber existing links
--
-- Run inside a transaction so you can inspect the count and ROLLBACK if wrong.

BEGIN;

-- Resolve the managed system id from AppSetting (plaintext — not a secret key).
-- Raises if the setting is unset or the referenced system has been deleted.
WITH target AS (
  SELECT s.id AS ai_system_id
  FROM "AppSetting" a
  JOIN "AISystem" s ON s.id = a.value
  WHERE a.key = 'anthropic_managed_system_id'
)
UPDATE "UsageBucket" u
SET "aiSystemId" = target.ai_system_id
FROM target
WHERE u.provider    = 'anthropic'
  AND u.granularity = 'day'
  AND u."aiSystemId" IS NULL;

-- Inspect before committing:
--   SELECT count(*) FROM "UsageBucket"
--     WHERE provider='anthropic' AND granularity='day' AND "aiSystemId" IS NOT NULL;

COMMIT;
