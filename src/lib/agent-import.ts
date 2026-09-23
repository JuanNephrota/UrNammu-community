/**
 * Shared plumbing for agent-platform inventory imports (Gap 2 of
 * docs/plans/agent-discovery.md). Each importer maps a platform's listing to
 * `DiscoveredAgentInput`s with pure functions, then hands them to
 * `applyAgentImport`, which writes through `upsertDiscoveredAgent()` and
 * counts the outcome. The upsert is injectable so the counting is testable
 * without a database.
 */
import {
  upsertDiscoveredAgent,
  type DiscoveredAgentInput,
  type UpsertOutcome,
} from "./agent-discovery";

/** What every importer reports. `error` is set when the import failed or partly failed. */
export type AgentImportSummary = {
  found: number;
  created: number;
  updated: number;
  error?: string;
};

export type AgentUpsertFn = (input: DiscoveredAgentInput) => Promise<UpsertOutcome>;

/** A fetch-compatible function; importers take one so tests can stub the network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function emptyImportSummary(): AgentImportSummary {
  return { found: 0, created: 0, updated: 0 };
}

/**
 * Upsert every input. A failing row does not stop the rest: the first
 * failure is reported in `error` with the number of rows that failed.
 */
export async function applyAgentImport(
  inputs: readonly DiscoveredAgentInput[],
  upsert: AgentUpsertFn = upsertDiscoveredAgent
): Promise<AgentImportSummary> {
  const summary = emptyImportSummary();
  summary.found = inputs.length;
  let failed = 0;
  let firstError: string | null = null;
  for (const input of inputs) {
    try {
      const outcome = await upsert(input);
      if (outcome.created) summary.created++;
      else summary.updated++;
    } catch (err) {
      failed++;
      firstError ??= err instanceof Error ? err.message : String(err);
    }
  }
  if (failed > 0) {
    summary.error = `${failed} of ${inputs.length} agent(s) failed to save: ${firstError}`;
  }
  return summary;
}

/** Unix seconds (number or numeric string) or an ISO string → Date. */
export function toDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Seconds unless it is clearly already milliseconds.
    const d = new Date(n > 1e12 ? n : n * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Bare hostname of a URL, or null. Never keeps a path or query. */
export function hostOfUrl(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Read an error message from a JSON or text response body. */
export async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return res.statusText || `HTTP ${res.status}`;
  try {
    const body = JSON.parse(text) as unknown;
    if (Array.isArray(body)) {
      // Salesforce returns [{ message, errorCode }].
      const first = asRecord(body[0]);
      return asString(first.message) ?? asString(first.errorCode) ?? text.slice(0, 300);
    }
    const rec = asRecord(body);
    const err = rec.error;
    if (typeof err === "string") return asString(rec.error_description) ?? err;
    const errRec = asRecord(err);
    return asString(errRec.message) ?? asString(rec.message) ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}
