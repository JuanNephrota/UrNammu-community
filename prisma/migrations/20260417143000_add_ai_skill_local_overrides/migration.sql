-- Per-field override tracking. Each entry is a field name on AISkill
-- that was edited locally in UrNammu; Forge sync skips these keys so
-- the user's value stays authoritative. Clearing a field on the edit
-- form removes its entry, letting the next sync refill from Forge.
ALTER TABLE "AISkill"
  ADD COLUMN "localOverrides" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
