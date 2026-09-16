import { prisma } from "./prisma";

/**
 * Server helper: other dangerous_prompt alerts that carry the same prompt
 * hash. Queried by the JSON path `promptRiskMetadata.promptHash`, so a single
 * round trip covers every hash on the Alerts page.
 */

export type RelatedPromptAlert = {
  id: string;
  title: string;
  severity: string;
  status: string;
  createdAt: Date;
  provider: string | null;
  userEmail: string | null;
  occurrences: number;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readMeta(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Map of promptHash → alerts (newest first) sharing that hash. Every alert in
 * the result is included under its own hash; callers filter out the alert
 * they are rendering. Empty input returns an empty map without a query.
 */
export async function findAlertsByPromptHashes(
  hashes: string[]
): Promise<Map<string, RelatedPromptAlert[]>> {
  const unique = [...new Set(hashes.filter((h) => typeof h === "string" && h.length > 0))];
  const byHash = new Map<string, RelatedPromptAlert[]>();
  if (unique.length === 0) return byHash;

  const rows = await prisma.alert.findMany({
    where: {
      source: "dangerous_prompt",
      OR: unique.map((hash) => ({
        promptRiskMetadata: { path: ["promptHash"], equals: hash },
      })),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      severity: true,
      status: true,
      createdAt: true,
      promptRiskMetadata: true,
    },
  });

  for (const row of rows) {
    const meta = readMeta(row.promptRiskMetadata);
    const hash = str(meta.promptHash);
    if (!hash) continue;
    const occurrences =
      typeof meta.occurrences === "number" && meta.occurrences > 0 ? meta.occurrences : 1;
    const list = byHash.get(hash) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      createdAt: row.createdAt,
      provider: str(meta.provider),
      userEmail: str(meta.userEmail),
      occurrences,
    });
    byHash.set(hash, list);
  }
  return byHash;
}
