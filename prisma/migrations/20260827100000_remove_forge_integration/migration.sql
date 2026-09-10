-- Remove the CertifID Forge integration.
--
-- Drops the AISkill mirror and its ForgeSyncRun history. AISkill.forgeId is
-- required and unique — every row originated from Forge, so the table has no
-- meaning once the sync is gone.
--
-- DESTRUCTIVE. Before applying to an environment with real data, export it:
--   AISkill rows (including linkedSystemId / linkedAgentId, which record which
--   governed systems and agents each skill was promoted into), ForgeSyncRun
--   history, and the forge_* AppSetting rows.
-- Dropping AISkill does not touch AISystem or AIAgent rows themselves — only
-- the association between them and the skills.

-- DropForeignKey
ALTER TABLE "AISkill" DROP CONSTRAINT "AISkill_linkedAgentId_fkey";

-- DropForeignKey
ALTER TABLE "AISkill" DROP CONSTRAINT "AISkill_linkedSystemId_fkey";

-- DropForeignKey
ALTER TABLE "ForgeSyncRun" DROP CONSTRAINT "ForgeSyncRun_triggeredByUserId_fkey";

-- DropTable
DROP TABLE "AISkill";

-- DropTable
DROP TABLE "ForgeSyncRun";

-- Clear the integration's runtime configuration. AppSetting is a generic
-- key-value store, so Prisma's diff cannot know these rows belong to Forge.
-- forge_integration_key holds a live Forge API credential; leaving it behind
-- in a table nothing reads any more would be a stale secret, not just clutter.
DELETE FROM "AppSetting" WHERE "key" IN (
  'forge_integration_key',
  'forge_base_url',
  'forge_sync_enabled',
  'forge_skills_last_since'
);
