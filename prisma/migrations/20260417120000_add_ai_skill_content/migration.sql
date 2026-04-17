-- Store the downloaded skill body + when we last pulled it, so promotion
-- can use the real content as the AIAgent/AISystem description and so
-- subsequent syncs only re-download when the upstream has changed.
ALTER TABLE "AISkill"
  ADD COLUMN "content" TEXT,
  ADD COLUMN "contentFetchedAt" TIMESTAMP(3);
