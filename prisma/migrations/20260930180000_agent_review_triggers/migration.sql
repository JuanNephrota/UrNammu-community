-- AlterTable
ALTER TABLE "AIAgent" ADD COLUMN     "humanReviewEnforcement" TEXT NOT NULL DEFAULT 'monitor';

-- AlterTable
ALTER TABLE "AgentToolCall" ADD COLUMN     "reviewRequired" BOOLEAN NOT NULL DEFAULT false;

