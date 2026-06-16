#!/usr/bin/env node
/**
 * Guards against drift between the main app's Prisma schema and the ai-proxy
 * mirror. Both schemas point at the same database; the main app owns
 * migrations and the proxy only reads/writes already-existing tables — so a
 * column added to a shared model in one schema but not the other fails
 * silently at runtime (missing data, or Prisma client errors on write).
 *
 * Rules enforced:
 *  - Models the proxy WRITES must have exactly the same scalar columns
 *    (name + type + optionality) in both schemas.
 *  - Models the proxy only READS may declare a subset of the main schema's
 *    columns, but every declared column must match.
 *  - Enums present in both schemas must list the same values in order.
 *  - The proxy may read a Postgres enum column as a plain String (it does
 *    this for Policy.status) — that is treated as compatible.
 *
 * Run: node scripts/check-schema-drift.mjs   (also wired into CI)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mainSrc = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const proxySrc = readFileSync(
  join(root, "ai-proxy/prisma/schema.prisma"),
  "utf8"
);

// Models the proxy writes — scalar columns must match the main schema exactly.
const WRITE_MODELS = [
  "APIUsageLog",
  "PolicyDenial",
  "ProviderSyncRun",
  "UsageBucket",
  "CostBucket",
];
// Models the proxy only reads — the proxy may declare a subset.
const READ_MODELS = ["User", "Policy", "PolicyAssignment", "AppSetting"];

function parse(src) {
  const models = new Map();
  const enums = new Map();
  for (const m of src.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)) {
    models.set(m[1], m[2]);
  }
  for (const m of src.matchAll(/^enum\s+(\w+)\s+\{([\s\S]*?)^\}/gm)) {
    enums.set(
      m[1],
      m[2]
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("//"))
    );
  }
  return { models, enums };
}

/** Field name -> type token (e.g. "String?", "Int", "Json?", "String[]"),
 *  excluding relation fields (whose type is another model in that schema). */
function scalarFields(body, schema) {
  const fields = new Map();
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) {
      continue;
    }
    const match = trimmed.match(/^(\w+)\s+(\w+(?:\[\])?\??)/);
    if (!match) continue;
    const [, name, type] = match;
    const baseType = type.replace(/[[\]?]/g, "");
    if (schema.models.has(baseType)) continue; // relation, not a column
    fields.set(name, type);
  }
  return fields;
}

function typesCompatible(mainType, proxyType, mainEnums) {
  if (mainType === proxyType) return true;
  // The proxy may read a Postgres enum column as a plain String.
  const optional = (t) => t.endsWith("?");
  const base = (t) => t.replace(/[[\]?]/g, "");
  return (
    base(proxyType) === "String" &&
    mainEnums.has(base(mainType)) &&
    optional(mainType) === optional(proxyType)
  );
}

const main = parse(mainSrc);
const proxy = parse(proxySrc);
const errors = [];

for (const name of [...WRITE_MODELS, ...READ_MODELS]) {
  if (!main.models.has(name)) {
    errors.push(`model ${name}: missing from prisma/schema.prisma`);
    continue;
  }
  if (!proxy.models.has(name)) {
    errors.push(`model ${name}: missing from ai-proxy/prisma/schema.prisma`);
    continue;
  }
  const mainFields = scalarFields(main.models.get(name), main);
  const proxyFields = scalarFields(proxy.models.get(name), proxy);

  for (const [field, type] of proxyFields) {
    if (!mainFields.has(field)) {
      errors.push(
        `${name}.${field}: declared in ai-proxy schema but not in main schema`
      );
    } else if (!typesCompatible(mainFields.get(field), type, main.enums)) {
      errors.push(
        `${name}.${field}: type mismatch (main: ${mainFields.get(field)}, ai-proxy: ${type})`
      );
    }
  }

  if (WRITE_MODELS.includes(name)) {
    for (const field of mainFields.keys()) {
      if (!proxyFields.has(field)) {
        errors.push(
          `${name}.${field}: in main schema but missing from ai-proxy schema (the proxy writes this table)`
        );
      }
    }
  }
}

for (const [name, values] of proxy.enums) {
  if (!main.enums.has(name)) {
    errors.push(`enum ${name}: missing from main schema`);
    continue;
  }
  const mainValues = main.enums.get(name);
  if (mainValues.join(",") !== values.join(",")) {
    errors.push(
      `enum ${name}: values differ (main: ${mainValues.join(", ")}; ai-proxy: ${values.join(", ")})`
    );
  }
}

if (errors.length) {
  console.error("Schema drift detected between prisma/schema.prisma and ai-proxy/prisma/schema.prisma:\n");
  for (const err of errors) console.error(`  ✗ ${err}`);
  console.error(
    "\nThe main app owns migrations; update both schemas together (and migrate) so the proxy and app agree on shared tables."
  );
  process.exit(1);
}

console.log(
  `Schema drift check passed: ${WRITE_MODELS.length} write models + ${READ_MODELS.length} read models in sync.`
);
