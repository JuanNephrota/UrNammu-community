-- AlterEnum
-- New values are committed here and used by the next migration (Postgres
-- cannot use an enum value added in the same transaction).
ALTER TYPE "ComplianceFramework" ADD VALUE IF NOT EXISTS 'COLORADO_AI';
ALTER TYPE "ComplianceFramework" ADD VALUE IF NOT EXISTS 'NEW_YORK_AI';
