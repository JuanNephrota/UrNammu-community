-- Enforce uniqueness on DiscoveredAITool (toolName, detectedDomain).
-- The scan executor and DNS/proxy ingestion both dedup with findFirst+create,
-- which races under concurrent runs (cron scan overlapping a manual scan or a
-- Netskope batch import) and can produce duplicate rows. Before adding the
-- constraint, merge any duplicates that already exist:
--   keeper  = earliest row (createdAt, then id) per (toolName, detectedDomain)
--   alerts  = re-pointed from duplicates to the keeper
--   userCount = max across the group (matches the "only ever raise" semantics
--               both writers use)
-- Rows with NULL detectedDomain are left alone: Postgres treats NULLs as
-- distinct in unique indexes, matching Prisma's semantics for this constraint.

-- 1. Re-point alerts from duplicate rows to the keeper.
WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY "toolName", "detectedDomain"
      ORDER BY "createdAt" ASC, id ASC
    ) AS keeper_id
  FROM "DiscoveredAITool"
  WHERE "detectedDomain" IS NOT NULL
)
UPDATE "Alert" a
SET "relatedToolId" = r.keeper_id
FROM ranked r
WHERE a."relatedToolId" = r.id
  AND r.id <> r.keeper_id;

-- 2. Fold the highest userCount in each duplicate group into the keeper.
WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY "toolName", "detectedDomain"
      ORDER BY "createdAt" ASC, id ASC
    ) AS keeper_id,
    MAX("userCount") OVER (
      PARTITION BY "toolName", "detectedDomain"
    ) AS max_user_count
  FROM "DiscoveredAITool"
  WHERE "detectedDomain" IS NOT NULL
)
UPDATE "DiscoveredAITool" t
SET "userCount" = r.max_user_count
FROM ranked r
WHERE t.id = r.keeper_id
  AND t.id = r.id
  AND t."userCount" < r.max_user_count;

-- 3. Delete the duplicates.
WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY "toolName", "detectedDomain"
      ORDER BY "createdAt" ASC, id ASC
    ) AS keeper_id
  FROM "DiscoveredAITool"
  WHERE "detectedDomain" IS NOT NULL
)
DELETE FROM "DiscoveredAITool" t
USING ranked r
WHERE t.id = r.id
  AND r.id <> r.keeper_id;

-- 4. Add the unique constraint (Prisma default index name).
CREATE UNIQUE INDEX "DiscoveredAITool_toolName_detectedDomain_key"
  ON "DiscoveredAITool"("toolName", "detectedDomain");
