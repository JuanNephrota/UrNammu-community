// Prisma-free types and constants for Usage by Person. Kept separate from
// people-usage.ts (which imports the Prisma client) so client components can
// import labels and row types without dragging the database client into the
// browser bundle.

export type PeopleUsageRange = "7d" | "30d" | "90d";

export const PEOPLE_USAGE_RANGES: { value: PeopleUsageRange; label: string; days: number }[] = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
];

export function parsePeopleUsageRange(raw: string | null | undefined): PeopleUsageRange {
  return PEOPLE_USAGE_RANGES.some((r) => r.value === raw) ? (raw as PeopleUsageRange) : "30d";
}

export function resolvePeopleUsageWindow(
  range: PeopleUsageRange,
  now: Date = new Date(),
): { since: Date; until: Date } {
  const days = PEOPLE_USAGE_RANGES.find((r) => r.value === range)?.days ?? 30;
  return { since: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), until: now };
}

export type PersonSurface = "claude_code" | "cowork" | "cursor" | "proxy";

export const SURFACE_LABELS: Record<PersonSurface, string> = {
  claude_code: "Claude Code",
  cowork: "Cowork",
  cursor: "Cursor",
  proxy: "API (proxy)",
};

export const SURFACE_ORDER: PersonSurface[] = ["claude_code", "cowork", "cursor", "proxy"];

export interface PersonUsageRow {
  email: string;
  name: string | null;
  department: string | null;

  // Claude Code (terminal / IDE). `claudeCodeSource` says where the numbers
  // came from: live OTel, or the Admin API analytics fallback.
  claudeCodeSource: "otel" | "admin_api" | null;
  claudeCodeSessions: number;
  claudeCodeTokens: number;
  claudeCodeLinesAdded: number;
  claudeCodeCommits: number;
  claudeCodeCost: number;

  // Cowork (Claude Desktop VM, entrypoint local-agent) — OTel only.
  coworkSessions: number;
  coworkTokens: number;
  coworkCost: number;

  // Cursor — Admin API sync. `cursorCost` is null when no synced day in the
  // window carried per-user spend (older rows predate that field).
  cursorRequests: number;
  cursorTokens: number;
  cursorLinesAccepted: number;
  cursorActiveDays: number;
  cursorCost: number | null;

  // Direct API calls through the governance proxy.
  proxyRequests: number;
  proxyTokens: number;
  proxyCost: number;
  proxyFlagged: number;

  // Rollups across surfaces.
  totalCost: number;
  totalTokens: number;
  surfaces: PersonSurface[];
  surfaceCount: number;
  lastActiveAt: Date | null;
}

export interface UnattributedUsage {
  cost: number;
  tokens: number;
  bySurface: Record<PersonSurface, { cost: number; tokens: number }>;
}

export interface PeopleUsageSummary {
  people: number;
  totalCost: number;
  totalTokens: number;
  avgCostPerPerson: number;
  unattributedCost: number;
  bySurface: { surface: PersonSurface; label: string; people: number; cost: number; tokens: number }[];
}
