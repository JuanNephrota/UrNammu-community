import { adminFetch, isAnthropicAdminConfigured } from "./anthropic-admin";

export { isAnthropicAdminConfigured as isClaudeCodeAnalyticsAvailable };

// ---------- Types ----------

/** Matches Anthropic Admin API: user_actor vs api_actor. */
export type ClaudeCodeActor =
  | { type: "user_actor"; email_address: string }
  | { type: "api_actor"; api_key_name: string };

export function getClaudeCodeActorExternalId(actor: ClaudeCodeActor): string | undefined {
  if (actor.type === "user_actor") return actor.email_address;
  if (actor.type === "api_actor") return actor.api_key_name;
  return undefined;
}

export interface ClaudeCodeEntry {
  date: string;
  actor: ClaudeCodeActor;
  organization_id: string;
  customer_type: string;
  terminal_type: string;
  core_metrics: {
    num_sessions: number;
    lines_of_code: { added: number; removed: number };
    commits_by_claude_code: number;
    pull_requests_by_claude_code: number;
  };
  tool_actions: Record<string, { accepted: number; rejected: number }>;
  model_breakdown: {
    model: string;
    tokens: {
      input: number;
      output: number;
      cache_read: number;
      cache_creation: number;
    };
    estimated_cost: { currency: string; amount: number };
  }[];
}

interface ClaudeCodeReportPage {
  data: ClaudeCodeEntry[];
  has_more: boolean;
  next_page: string | null;
}

// ---------- API ----------

/**
 * Fetch Claude Code analytics for a single day (handles pagination).
 * `date` must be YYYY-MM-DD.
 */
export async function getClaudeCodeReport(date: string): Promise<ClaudeCodeEntry[]> {
  const entries: ClaudeCodeEntry[] = [];
  let page: string | undefined;

  do {
    const query = new URLSearchParams();
    query.set("starting_at", date);
    query.set("limit", "1000");
    if (page) query.set("page", page);

    const res = (await adminFetch(
      `/v1/organizations/usage_report/claude_code?${query}`
    )) as unknown as ClaudeCodeReportPage;

    entries.push(...res.data);
    page = res.has_more ? (res.next_page ?? undefined) : undefined;
  } while (page);

  return entries;
}

export interface ClaudeCodeRangeResult {
  entries: ClaudeCodeEntry[];
  daysRequested: number;
  daysSucceeded: number;
  daysFailed: number;
  errors: string[];
}

/**
 * Fetch Claude Code analytics for a date range (inclusive start, exclusive end).
 * Loops over each day since the API only accepts a single day per request.
 */
export async function getClaudeCodeReportRange(
  startDate: string,
  endDate: string,
): Promise<ClaudeCodeRangeResult> {
  const entries: ClaudeCodeEntry[] = [];
  const errors: string[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let daysRequested = 0;
  let daysSucceeded = 0;

  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    daysRequested++;
    try {
      const dayEntries = await getClaudeCodeReport(dateStr);
      entries.push(...dayEntries);
      daysSucceeded++;
    } catch (err) {
      errors.push(`${dateStr}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  return {
    entries,
    daysRequested,
    daysSucceeded,
    daysFailed: daysRequested - daysSucceeded,
    errors,
  };
}
