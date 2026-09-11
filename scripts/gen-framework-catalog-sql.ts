/**
 * Emits the idempotent INSERT statements that seed the framework control
 * catalog and crosswalk from src/lib/framework-catalog.ts.
 *
 *   npx tsx scripts/gen-framework-catalog-sql.ts > /tmp/catalog.sql
 *
 * Paste the output at the end of a migration. Re-running against a database
 * that already has the rows is a no-op (ON CONFLICT DO NOTHING), so a later
 * migration can add controls by re-emitting the whole block.
 */
import {
  FRAMEWORK_CATALOG,
  FRAMEWORK_CROSSWALK,
  assertCatalogIntegrity,
} from "../src/lib/framework-catalog";

assertCatalogIntegrity();

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

const lines: string[] = [];
lines.push(
  "-- Seed the built-in framework control catalog. Mirrors src/lib/framework-catalog.ts —",
  "-- keep the two in sync (regenerate with `npx tsx scripts/gen-framework-catalog-sql.ts`).",
  'INSERT INTO "FrameworkControl" ("id", "framework", "code", "title", "description", "category", "sortOrder", "builtIn", "createdAt", "updatedAt") VALUES'
);
lines.push(
  FRAMEWORK_CATALOG.map(
    (c) =>
      `  (gen_random_uuid()::text, ${q(c.framework)}::"ComplianceFramework", ${q(c.code)}, ${q(c.title)}, ${q(c.description)}, ${q(c.category)}, ${c.sortOrder}, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).join(",\n")
);
lines.push('ON CONFLICT ("framework", "code") DO NOTHING;', "");

lines.push("-- Crosswalk pairs, resolved by (framework, code) so ids need not be known.");
for (const xw of FRAMEWORK_CROSSWALK) {
  lines.push(
    `INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")`,
    `  SELECT gen_random_uuid()::text, f."id", t."id", ${xw.note ? q(xw.note) : "NULL"}, CURRENT_TIMESTAMP`,
    `  FROM "FrameworkControl" f, "FrameworkControl" t`,
    `  WHERE f."framework" = ${q(xw.from.framework)}::"ComplianceFramework" AND f."code" = ${q(xw.from.code)}`,
    `    AND t."framework" = ${q(xw.to.framework)}::"ComplianceFramework" AND t."code" = ${q(xw.to.code)}`,
    `  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;`
  );
}

process.stdout.write(lines.join("\n") + "\n");
