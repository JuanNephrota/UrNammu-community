#!/usr/bin/env tsx
/**
 * Backfill `DiscoveredAITool.category` from the known-AI-tools registry.
 *
 * Rows created before the category column existed have `category = NULL`.
 * This resolves each such row against the registry — by the registry
 * toolName the scanners stored, then by detectedDomain — and writes the
 * category. Rows that match nothing (heuristic ".ai domain" candidates,
 * manual reports of unknown tools) are left NULL and counted.
 *
 * Only NULL categories are touched, so a value a reviewer has set by hand is
 * never overwritten. Safe to re-run.
 *
 *   npx tsx scripts/backfill-tool-categories.ts            # write
 *   npx tsx scripts/backfill-tool-categories.ts --dry-run  # report only
 *
 * Uses DATABASE_URL from the environment (.env), i.e. the same database the
 * app points at — run it against production after `prisma migrate deploy`
 * has added the column.
 */
import { PrismaClient } from "@prisma/client";
import {
  AI_TOOL_CATEGORY_LABELS,
  resolveToolCategory,
  type AIToolCategory,
} from "../src/lib/ai-tools-registry";

const dryRun = process.argv.includes("--dry-run");
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.discoveredAITool.findMany({
    where: { category: null },
    select: { id: true, toolName: true, detectedDomain: true },
    orderBy: { detectedAt: "asc" },
  });

  console.log(
    `${rows.length} discovered tool(s) without a category${dryRun ? " (dry run)" : ""}.`
  );

  const perCategory = new Map<AIToolCategory, number>();
  const unresolved: string[] = [];
  let updated = 0;

  for (const row of rows) {
    const category = resolveToolCategory({
      toolName: row.toolName,
      domain: row.detectedDomain,
    });
    if (!category) {
      unresolved.push(`${row.toolName}${row.detectedDomain ? ` (${row.detectedDomain})` : ""}`);
      continue;
    }
    perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    if (!dryRun) {
      await prisma.discoveredAITool.update({
        where: { id: row.id },
        data: { category },
      });
    }
    updated++;
  }

  console.log(`${dryRun ? "Would set" : "Set"} category on ${updated} row(s):`);
  for (const [category, count] of Array.from(perCategory.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${AI_TOOL_CATEGORY_LABELS[category].padEnd(20)} ${count}`);
  }

  if (unresolved.length > 0) {
    console.log(
      `${unresolved.length} row(s) match nothing in the registry and stay uncategorized ` +
        `(set them from the Shadow AI page if needed):`
    );
    for (const label of unresolved) console.log(`  - ${label}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
