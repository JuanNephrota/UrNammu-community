import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { EXCLUDE_PROXY_DUPLICATES_SQL } from "./oversight-telemetry";

/**
 * Cost attribution rollups for the Oversight overview: spend by governed AI
 * system and spend by provider API key (or, where the provider only reports
 * spend per workspace, by workspace).
 *
 * Reads `CostBucket` directly rather than joining usage → cost through the
 * dimension key, because cost rows now carry their own `aiSystemId`,
 * `apiKeyExternalId`, and `workspaceExternalId` (see the provider sync).
 * Aggregates run in SQL so they are not capped by the page's row limits, and
 * exclude proxy-duplicated rows like every other Oversight total.
 */

export type CostBySystemRow = {
  aiSystemId: string | null;
  systemName: string | null;
  department: string | null;
  amount: number;
  providers: string[];
};

export type CostBySystemSummary = {
  rows: CostBySystemRow[]; // attributed systems, highest spend first
  attributedAmount: number;
  unattributedAmount: number;
  totalAmount: number;
  /** Share of spend (0–100) that resolves to a registered AI system. */
  coveragePct: number;
};

export type CostByKeyRow = {
  provider: string;
  scope: "api_key" | "workspace";
  externalId: string;
  label: string;
  systemName: string | null;
  workspaceName: string | null;
  amount: number;
};

export function summarizeCostBySystem(rows: CostBySystemRow[], take?: number): CostBySystemSummary {
  let attributedAmount = 0;
  let unattributedAmount = 0;
  const attributed: CostBySystemRow[] = [];
  for (const row of rows) {
    if (!(row.amount > 0)) continue;
    if (row.aiSystemId && row.systemName) {
      attributed.push(row);
      attributedAmount += row.amount;
    } else {
      unattributedAmount += row.amount;
    }
  }
  attributed.sort((a, b) => b.amount - a.amount);
  const totalAmount = attributedAmount + unattributedAmount;
  return {
    rows: typeof take === "number" ? attributed.slice(0, take) : attributed,
    attributedAmount,
    unattributedAmount,
    totalAmount,
    coveragePct: totalAmount > 0 ? Math.round((attributedAmount / totalAmount) * 100) : 0,
  };
}

/**
 * Merge per-key and per-workspace rows into one ranked list. Workspace rows
 * exist for providers whose cost report has no key dimension (Anthropic);
 * they never overlap with key rows for the same spend because a cost row has
 * either an `apiKeyExternalId` or only a `workspaceExternalId`.
 */
export function rankCostByKey(rows: CostByKeyRow[], take?: number): CostByKeyRow[] {
  const ranked = rows.filter((row) => row.amount > 0).sort((a, b) => b.amount - a.amount);
  return typeof take === "number" ? ranked.slice(0, take) : ranked;
}

type SystemAggRow = {
  ai_system_id: string | null;
  system_name: string | null;
  department: string | null;
  amount: number;
  providers: string[] | null;
};

type KeyAggRow = {
  provider: string;
  external_id: string;
  label: string | null;
  workspace_name: string | null;
  system_name: string | null;
  amount: number;
};

export async function loadCostBySystem(since: Date, take = 8): Promise<CostBySystemSummary> {
  const rows = await prisma.$queryRaw<SystemAggRow[]>(Prisma.sql`
    SELECT
      c."aiSystemId" AS ai_system_id,
      s.name AS system_name,
      s.department AS department,
      COALESCE(SUM(c.amount), 0)::float8 AS amount,
      ARRAY_AGG(DISTINCT c.provider) AS providers
    FROM "CostBucket" c
    LEFT JOIN "AISystem" s ON s.id = c."aiSystemId"
    WHERE c."bucketStart" >= ${since}
      AND ${EXCLUDE_PROXY_DUPLICATES_SQL}
    GROUP BY 1, 2, 3
  `);
  return summarizeCostBySystem(
    rows.map((row) => ({
      aiSystemId: row.ai_system_id,
      systemName: row.system_name,
      department: row.department,
      amount: Number(row.amount),
      providers: row.providers ?? [],
    })),
    take
  );
}

export async function loadCostByKey(since: Date, take = 8): Promise<CostByKeyRow[]> {
  const [keyRows, workspaceRows] = await Promise.all([
    prisma.$queryRaw<KeyAggRow[]>(Prisma.sql`
      SELECT
        c.provider,
        c."apiKeyExternalId" AS external_id,
        MAX(c."apiKeyName") AS label,
        MAX(c."workspaceName") AS workspace_name,
        MAX(s.name) AS system_name,
        COALESCE(SUM(c.amount), 0)::float8 AS amount
      FROM "CostBucket" c
      LEFT JOIN "AISystem" s ON s.id = c."aiSystemId"
      WHERE c."bucketStart" >= ${since}
        AND c."apiKeyExternalId" IS NOT NULL
        AND ${EXCLUDE_PROXY_DUPLICATES_SQL}
      GROUP BY 1, 2
      ORDER BY amount DESC
      LIMIT ${take}
    `),
    prisma.$queryRaw<KeyAggRow[]>(Prisma.sql`
      SELECT
        c.provider,
        c."workspaceExternalId" AS external_id,
        MAX(c."workspaceName") AS label,
        MAX(c."workspaceName") AS workspace_name,
        MAX(s.name) AS system_name,
        COALESCE(SUM(c.amount), 0)::float8 AS amount
      FROM "CostBucket" c
      LEFT JOIN "AISystem" s ON s.id = c."aiSystemId"
      WHERE c."bucketStart" >= ${since}
        AND c."apiKeyExternalId" IS NULL
        AND c."workspaceExternalId" IS NOT NULL
        AND ${EXCLUDE_PROXY_DUPLICATES_SQL}
      GROUP BY 1, 2
      ORDER BY amount DESC
      LIMIT ${take}
    `),
  ]);

  const toRow = (scope: CostByKeyRow["scope"]) => (row: KeyAggRow): CostByKeyRow => ({
    provider: row.provider,
    scope,
    externalId: row.external_id,
    label: row.label ?? row.external_id,
    systemName: row.system_name,
    workspaceName: row.workspace_name,
    amount: Number(row.amount),
  });

  return rankCostByKey(
    [...keyRows.map(toRow("api_key")), ...workspaceRows.map(toRow("workspace"))],
    take
  );
}
