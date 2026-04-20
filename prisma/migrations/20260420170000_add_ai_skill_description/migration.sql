-- Forge returns a short description blurb on every skill that the sync
-- previously ignored. Persist it so we can surface it on the skill detail
-- view AND use it as the preferred source for AIAgent / AISystem
-- descriptions when promoting. File body (content) remains the secondary
-- source for text skills; the metadata fallback blurb stays as last resort.
ALTER TABLE "AISkill"
  ADD COLUMN "description" TEXT;
