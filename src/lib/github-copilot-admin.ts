import { getSetting } from "./settings";
import {
  buildSeatIndex,
  parseCopilotOrgReport,
  parseCopilotUserReport,
  type CopilotOrgDay,
  type CopilotSeat,
  type CopilotUserRow,
  type NdjsonParseResult,
} from "./github-copilot-metrics";

// GitHub Copilot usage metrics client. Mirrors the other provider-admin
// clients (cursor-admin.ts etc.).
//
// Docs: https://docs.github.com/en/rest/copilot/copilot-usage-metrics?apiVersion=2026-03-10
//
// Auth is a Bearer token. Scopes: `read:org` for an organization (the
// caller must be an org owner or hold the fine-grained "View Organization
// Copilot Metrics" permission); `manage_billing:copilot` or
// `read:enterprise` for an enterprise. The organization / enterprise must
// also have the **Copilot usage metrics** policy enabled, otherwise every
// report endpoint answers 403 with that exact sentence.
//
// The reports are daily: `…/copilot/metrics/reports/<report>?day=YYYY-MM-DD`
// returns `{ download_links, report_day }`; each link is a pre-signed NDJSON
// file (fetched WITHOUT the token — the URL carries its own signature).
// Data exists from 2025-10-10, is kept one year, and lands within two days.

const BASE_URL = "https://api.github.com";
export const GITHUB_API_VERSION = "2026-03-10";

export const GITHUB_COPILOT_SETTINGS = {
  /** Personal access token / GitHub App token with the scopes above. */
  TOKEN: "github_copilot_token",
  /** Organization login. Either this or ENTERPRISE is required. */
  ORG: "github_copilot_org",
  /** Enterprise slug. When set, reports are read at enterprise scope. */
  ENTERPRISE: "github_copilot_enterprise",
} as const;

export type CopilotScope = { kind: "org"; slug: string } | { kind: "enterprise"; slug: string };

export async function getCopilotScope(): Promise<CopilotScope | null> {
  const [enterprise, org] = await Promise.all([
    getSetting(GITHUB_COPILOT_SETTINGS.ENTERPRISE),
    getSetting(GITHUB_COPILOT_SETTINGS.ORG),
  ]);
  if (enterprise?.trim()) return { kind: "enterprise", slug: enterprise.trim() };
  if (org?.trim()) return { kind: "org", slug: org.trim() };
  return null;
}

export async function isGitHubCopilotConfigured(): Promise<boolean> {
  const [token, scope] = await Promise.all([getSetting(GITHUB_COPILOT_SETTINGS.TOKEN), getCopilotScope()]);
  return !!token && !!scope;
}

async function getToken(): Promise<string> {
  const token = await getSetting(GITHUB_COPILOT_SETTINGS.TOKEN);
  if (!token) {
    throw new Error("GitHub Copilot token not configured. Add it in Settings > Provider Admin APIs.");
  }
  return token;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

const POLICY_HINT =
  "Enable the 'Copilot usage metrics' policy for the organization / enterprise (Settings → Copilot → Policies) before syncing.";

async function ghFetch<T = Record<string, unknown>>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "UrNammu-governance",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let msg: string;
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      msg = text;
    }
    if (res.status === 403 && /usage metrics.*policy/i.test(msg)) msg = `${msg}. ${POLICY_HINT}`;
    throw new GitHubApiError(`GitHub API error (${res.status}) on ${path}: ${msg}`, res.status, path);
  }
  return res.json() as Promise<T>;
}

function scopePrefix(scope: CopilotScope): string {
  return scope.kind === "enterprise"
    ? `/enterprises/${encodeURIComponent(scope.slug)}`
    : `/orgs/${encodeURIComponent(scope.slug)}`;
}

/** Report names under `…/copilot/metrics/reports/`. Org vs enterprise differ in the aggregate report only. */
export type CopilotReportName = "users-1-day" | "organization-1-day" | "enterprise-1-day" | "repos-1-day";

export interface CopilotReportLinks {
  download_links: string[];
  report_day?: string;
  report_start_day?: string;
  report_end_day?: string;
}

/** `{ download_links, report_day }` for one report day, or null on 404 (not published yet / no data). */
export async function getCopilotReportLinks(
  scope: CopilotScope,
  report: CopilotReportName,
  day: string,
): Promise<CopilotReportLinks | null> {
  const path = `${scopePrefix(scope)}/copilot/metrics/reports/${report}?day=${encodeURIComponent(day)}`;
  try {
    const res = await ghFetch<CopilotReportLinks>(path);
    return { ...res, download_links: Array.isArray(res.download_links) ? res.download_links : [] };
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Download one pre-signed report file. No Authorization header: the URL is
 * signed and points at a storage host, and forwarding the token there would
 * leak it.
 */
export async function downloadCopilotReportFile(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "UrNammu-governance" } });
  if (!res.ok) {
    throw new Error(`Copilot report download failed (${res.status}) for ${new URL(url).hostname}`);
  }
  return res.text();
}

export interface CopilotDayReport<T> {
  /** Null when the report for the day is not published (404). */
  found: boolean;
  rows: T[];
  files: number;
  rejected: NdjsonParseResult<T>["rejected"];
}

async function fetchReport<T>(
  scope: CopilotScope,
  report: CopilotReportName,
  day: string,
  parse: (body: string) => NdjsonParseResult<T>,
): Promise<CopilotDayReport<T>> {
  const links = await getCopilotReportLinks(scope, report, day);
  if (!links) return { found: false, rows: [], files: 0, rejected: [] };
  const rows: T[] = [];
  const rejected: NdjsonParseResult<T>["rejected"] = [];
  for (const url of links.download_links) {
    const body = await downloadCopilotReportFile(url);
    const parsed = parse(body);
    rows.push(...parsed.rows);
    rejected.push(...parsed.rejected);
  }
  return { found: true, rows, files: links.download_links.length, rejected };
}

/** Per-user rows for one day. */
export function getCopilotUsersReport(scope: CopilotScope, day: string): Promise<CopilotDayReport<CopilotUserRow>> {
  return fetchReport(scope, "users-1-day", day, parseCopilotUserReport);
}

/** Aggregated org / enterprise totals for one day. */
export function getCopilotAggregateReport(scope: CopilotScope, day: string): Promise<CopilotDayReport<CopilotOrgDay>> {
  const report: CopilotReportName = scope.kind === "enterprise" ? "enterprise-1-day" : "organization-1-day";
  return fetchReport(scope, report, day, parseCopilotOrgReport);
}

// ─── Seats (identity join) ────────────────────────────────────────────────

interface SeatsPage {
  total_seats?: number;
  seats?: Array<{
    assignee?: { login?: string; id?: number; email?: string | null } | null;
    last_activity_at?: string | null;
    last_activity_editor?: string | null;
    plan_type?: string | null;
    created_at?: string | null;
    pending_cancellation_date?: string | null;
  }>;
}

export const COPILOT_SEATS_PAGE_SIZE = 100;
export const COPILOT_SEATS_MAX_PAGES = 50;

/**
 * Every Copilot seat assignment: login, email when GitHub exposes it, and
 * `last_activity_at` (90-day retention upstream). Org scope uses
 * `/orgs/{org}/copilot/billing/seats`; enterprise scope uses the enterprise
 * variant. Paginated with `page` / `per_page`.
 */
export async function listCopilotSeats(
  scope: CopilotScope,
): Promise<{ seats: CopilotSeat[]; totalSeats: number | null; pages: number; truncated: boolean }> {
  const seats: CopilotSeat[] = [];
  let totalSeats: number | null = null;
  let pages = 0;
  let truncated = false;
  for (let page = 1; page <= COPILOT_SEATS_MAX_PAGES; page++) {
    const res = await ghFetch<SeatsPage>(
      `${scopePrefix(scope)}/copilot/billing/seats?per_page=${COPILOT_SEATS_PAGE_SIZE}&page=${page}`,
    );
    pages++;
    if (typeof res.total_seats === "number") totalSeats = res.total_seats;
    const items = res.seats ?? [];
    for (const item of items) {
      const login = item.assignee?.login;
      if (!login) continue;
      seats.push({
        login,
        userId: typeof item.assignee?.id === "number" ? item.assignee.id : null,
        email: item.assignee?.email ?? null,
        lastActivityAt: item.last_activity_at ?? null,
        lastActivityEditor: item.last_activity_editor ?? null,
        planType: item.plan_type ?? null,
        createdAt: item.created_at ?? null,
        pendingCancellationDate: item.pending_cancellation_date ?? null,
      });
    }
    if (items.length < COPILOT_SEATS_PAGE_SIZE) break;
    if (totalSeats != null && seats.length >= totalSeats) break;
    if (page === COPILOT_SEATS_MAX_PAGES) truncated = true;
  }
  return { seats, totalSeats, pages, truncated };
}

export { buildSeatIndex };

/** Lightweight connectivity/auth check for the Settings "Test" button. */
export async function testGitHubCopilot(): Promise<{ success: boolean; message: string }> {
  try {
    const scope = await getCopilotScope();
    if (!scope) {
      return { success: false, message: "Set a GitHub organization or enterprise first." };
    }
    const label = scope.kind === "enterprise" ? `enterprise ${scope.slug}` : `organization ${scope.slug}`;
    // Two checks: the seats endpoint proves the token and scope; the 28-day
    // report proves the usage-metrics policy is enabled (it 403s otherwise).
    const seats = await listCopilotSeats(scope).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    const reportPath = `${scopePrefix(scope)}/copilot/metrics/reports/users-28-day/latest`;
    const report = await ghFetch<CopilotReportLinks>(reportPath).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));

    if ("error" in report) {
      const seatsNote = "error" in seats ? "" : ` Seats endpoint OK (${seats.seats.length} seat${seats.seats.length === 1 ? "" : "s"}).`;
      return { success: false, message: `Usage metrics report unavailable for ${label}: ${report.error}.${seatsNote}` };
    }
    const seatsNote =
      "error" in seats
        ? ` Seats endpoint failed (${seats.error}); users will be keyed by login.`
        : ` ${seats.seats.length} seat${seats.seats.length === 1 ? "" : "s"} visible.`;
    const days =
      report.report_start_day && report.report_end_day
        ? ` Latest 28-day report covers ${report.report_start_day} → ${report.report_end_day}.`
        : "";
    return { success: true, message: `Connected to ${label}.${seatsNote}${days}` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Connection failed" };
  }
}
