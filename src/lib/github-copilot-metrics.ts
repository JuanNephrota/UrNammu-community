import { z } from "zod";
import type { AssistantDailyStatValues } from "./assistant-daily-stats";

// ─── GitHub Copilot usage metrics: pure parsing + mapping ─────────────────
// The Copilot usage metrics API (X-GitHub-Api-Version 2026-03-10) is
// report-based: `GET …/copilot/metrics/reports/<report>?day=YYYY-MM-DD`
// returns `{ download_links, report_day }` and each link is an NDJSON file.
// This module owns everything that does not touch the network or Prisma:
//   - the Zod schemas for the per-user and per-organization report rows,
//     pinned to the fields UrNammu reads and tolerant of anything else;
//   - the NDJSON parser;
//   - the mapping from a user row to AssistantDailyStat columns;
//   - the day walk the sync performs from its watermark window.
// Field names come from GitHub's published example schema
// (docs.github.com → Copilot → Reference → Copilot usage metrics →
// Example schema) and were cross-checked against the field reference.

/** Earliest day the API has data for; requests before it are pointless. */
export const COPILOT_DATA_START_DAY = "2025-10-10";
/** Reports are retained upstream for one year. */
export const COPILOT_MAX_LOOKBACK_DAYS = 365;
/** A day's report lands "within two full days"; treat older 404s as no data. */
export const COPILOT_REPORT_LAG_DAYS = 2;
/** Upper bound on days walked in one sync (one links call + downloads each). */
export const COPILOT_MAX_DAYS_PER_RUN = 28;

const DAY_MS = 24 * 60 * 60 * 1000;

const tokenUsageSchema = z.looseObject({
  prompt_tokens_sum: z.number().nullish(),
  output_tokens_sum: z.number().nullish(),
  avg_tokens_per_request: z.number().nullish(),
});

const surfaceTotalsSchema = z.looseObject({
  prompt_count: z.number().nullish(),
  request_count: z.number().nullish(),
  session_count: z.number().nullish(),
  token_usage: tokenUsageSchema.nullish(),
});

const locFields = {
  code_acceptance_activity_count: z.number().nullish(),
  code_generation_activity_count: z.number().nullish(),
  loc_added_sum: z.number().nullish(),
  loc_deleted_sum: z.number().nullish(),
  loc_suggested_to_add_sum: z.number().nullish(),
  loc_suggested_to_delete_sum: z.number().nullish(),
  user_initiated_interaction_count: z.number().nullish(),
};

const featureTotalsSchema = z.looseObject({ feature: z.string().nullish(), ...locFields });
const ideTotalsSchema = z.looseObject({ ide: z.string().nullish(), ...locFields });
const languageFeatureSchema = z.looseObject({
  language: z.string().nullish(),
  feature: z.string().nullish(),
  ...locFields,
});
const modelFeatureSchema = z.looseObject({
  model: z.string().nullish(),
  feature: z.string().nullish(),
  ...locFields,
});
const thirdPartyAgentSchema = z.looseObject({
  agent_id: z.union([z.string(), z.number()]).nullish(),
  agent_name: z.string().nullish(),
  session_count: z.number().nullish(),
  user_initiated_interaction_count: z.number().nullish(),
});

/** One line of the `users-1-day` report: one user × one day. */
export const copilotUserRowSchema = z.looseObject({
  day: z.string(),
  user_id: z.union([z.number(), z.string()]).nullish(),
  user_login: z.string(),
  enterprise_id: z.union([z.string(), z.number()]).nullish(),
  organization_id: z.union([z.string(), z.number()]).nullish(),
  ai_credits_used: z.number().nullish(),
  ai_adoption_phase: z
    .looseObject({ phase: z.string().nullish(), phase_number: z.number().nullish(), version: z.string().nullish() })
    .nullish(),
  used_agent: z.boolean().nullish(),
  used_chat: z.boolean().nullish(),
  used_cli: z.boolean().nullish(),
  used_copilot_app: z.boolean().nullish(),
  used_copilot_cloud_agent: z.boolean().nullish(),
  used_copilot_coding_agent: z.boolean().nullish(),
  used_copilot_code_review_active: z.boolean().nullish(),
  used_copilot_code_review_passive: z.boolean().nullish(),
  totals_by_cli: surfaceTotalsSchema.nullish(),
  totals_by_copilot_app: surfaceTotalsSchema.nullish(),
  totals_by_feature: z.array(featureTotalsSchema).nullish(),
  totals_by_ide: z.array(ideTotalsSchema).nullish(),
  totals_by_language_feature: z.array(languageFeatureSchema).nullish(),
  totals_by_model_feature: z.array(modelFeatureSchema).nullish(),
  totals_by_3rd_party_agent: z.array(thirdPartyAgentSchema).nullish(),
  ...locFields,
});
export type CopilotUserRow = z.infer<typeof copilotUserRowSchema>;

const pullRequestsSchema = z.looseObject({
  total_created: z.number().nullish(),
  total_created_by_copilot: z.number().nullish(),
  total_merged: z.number().nullish(),
  total_merged_created_by_copilot: z.number().nullish(),
  total_merged_reviewed_by_copilot: z.number().nullish(),
  total_reviewed: z.number().nullish(),
  total_reviewed_by_copilot: z.number().nullish(),
  total_suggestions: z.number().nullish(),
  total_copilot_suggestions: z.number().nullish(),
  total_applied_suggestions: z.number().nullish(),
  total_copilot_applied_suggestions: z.number().nullish(),
  median_minutes_to_merge: z.number().nullish(),
  median_minutes_to_merge_copilot_authored: z.number().nullish(),
  median_minutes_to_merge_copilot_reviewed: z.number().nullish(),
});

const adoptionPhaseTotalsSchema = z.looseObject({
  phase: z.string().nullish(),
  phase_number: z.number().nullish(),
  total_engaged_users: z.number().nullish(),
});

/** One organization (or enterprise) day of aggregated totals. */
export const copilotOrgDaySchema = z.looseObject({
  day: z.string(),
  enterprise_id: z.union([z.string(), z.number()]).nullish(),
  organization_id: z.union([z.string(), z.number()]).nullish(),
  daily_active_users: z.number().nullish(),
  weekly_active_users: z.number().nullish(),
  monthly_active_users: z.number().nullish(),
  monthly_active_chat_users: z.number().nullish(),
  monthly_active_agent_users: z.number().nullish(),
  daily_active_cli_users: z.number().nullish(),
  daily_active_copilot_app_users: z.number().nullish(),
  daily_active_copilot_cloud_agent_users: z.number().nullish(),
  daily_active_copilot_code_review_users: z.number().nullish(),
  daily_passive_copilot_code_review_users: z.number().nullish(),
  pull_requests: pullRequestsSchema.nullish(),
  totals_by_cli: surfaceTotalsSchema.nullish(),
  totals_by_copilot_app: surfaceTotalsSchema.nullish(),
  totals_by_feature: z.array(featureTotalsSchema).nullish(),
  totals_by_ide: z.array(ideTotalsSchema).nullish(),
  totals_by_language_feature: z.array(languageFeatureSchema).nullish(),
  totals_by_model_feature: z.array(modelFeatureSchema).nullish(),
  totals_by_3rd_party_agent: z.array(thirdPartyAgentSchema).nullish(),
  totals_by_ai_adoption_phase: z.array(adoptionPhaseTotalsSchema).nullish(),
  ...locFields,
});
export type CopilotOrgDay = z.infer<typeof copilotOrgDaySchema>;

/**
 * The organization / enterprise report line. GitHub's example wraps the day
 * in `day_totals: [...]` (one entry per day in the report window) next to
 * the entity ids; a flat row with `day` at the top level is accepted too so
 * a schema wobble between the two shapes does not drop the whole report.
 */
const copilotOrgRowSchema = z.union([
  z.looseObject({ day_totals: z.array(copilotOrgDaySchema) }),
  copilotOrgDaySchema,
]);

export type NdjsonParseResult<T> = {
  rows: T[];
  /** Lines that were not JSON or failed the schema, with the reason. */
  rejected: { line: number; reason: string }[];
};

/**
 * Parse an NDJSON body with a Zod schema. Blank lines are skipped; a bad
 * line is reported, not fatal, so one malformed record cannot hide a day.
 * A body that is a JSON array (as the docs example is printed) is accepted
 * as well.
 */
export function parseCopilotNdjson<T>(body: string, schema: z.ZodType<T>): NdjsonParseResult<T> {
  const rows: T[] = [];
  const rejected: { line: number; reason: string }[] = [];
  const trimmed = body.trim();
  if (trimmed.length === 0) return { rows, rejected };

  const candidates: { line: number; value: unknown }[] = [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) parsed.forEach((value, i) => candidates.push({ line: i + 1, value }));
      else candidates.push({ line: 1, value: parsed });
    } catch (error) {
      rejected.push({ line: 1, reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` });
      return { rows, rejected };
    }
  } else {
    body.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      try {
        candidates.push({ line: i + 1, value: JSON.parse(line) });
      } catch (error) {
        rejected.push({ line: i + 1, reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` });
      }
    });
  }

  for (const { line, value } of candidates) {
    const result = schema.safeParse(value);
    if (result.success) rows.push(result.data);
    else rejected.push({ line, reason: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  return { rows, rejected };
}

export function parseCopilotUserReport(body: string): NdjsonParseResult<CopilotUserRow> {
  return parseCopilotNdjson(body, copilotUserRowSchema);
}

/** Organization report → one entry per day (unwrapping `day_totals`). */
export function parseCopilotOrgReport(body: string): NdjsonParseResult<CopilotOrgDay> {
  const parsed = parseCopilotNdjson(body, copilotOrgRowSchema);
  const rows: CopilotOrgDay[] = [];
  for (const row of parsed.rows) {
    if ("day_totals" in row && Array.isArray(row.day_totals)) rows.push(...row.day_totals);
    else rows.push(row as CopilotOrgDay);
  }
  return { rows, rejected: parsed.rejected };
}

// ─── Identity ─────────────────────────────────────────────────────────────

/** Seat assignment from `GET /orgs/{org}/copilot/billing/seats` (subset). */
export interface CopilotSeat {
  login: string;
  userId: number | null;
  email: string | null;
  lastActivityAt: string | null;
  lastActivityEditor: string | null;
  planType: string | null;
  createdAt: string | null;
  pendingCancellationDate: string | null;
}

/**
 * The `actorExternalId` for a Copilot user: the seat's email when GitHub
 * exposes one (only for some enterprise/EMU configurations), otherwise the
 * login. Lower-cased either way so Usage by Person can merge on it.
 */
export function copilotActorExternalId(login: string, seatEmail: string | null | undefined): string {
  const email = seatEmail?.trim().toLowerCase();
  if (email && email.includes("@")) return email;
  return login.trim().toLowerCase();
}

export function buildSeatIndex(seats: CopilotSeat[]): Map<string, CopilotSeat> {
  const index = new Map<string, CopilotSeat>();
  for (const seat of seats) index.set(seat.login.toLowerCase(), seat);
  return index;
}

// ─── Mapping ──────────────────────────────────────────────────────────────

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function sumTokens(row: { totals_by_cli?: unknown; totals_by_copilot_app?: unknown }) {
  const surfaces = [row.totals_by_cli, row.totals_by_copilot_app].filter(
    (s): s is z.infer<typeof surfaceTotalsSchema> => !!s && typeof s === "object",
  );
  if (surfaces.length === 0) return { input: null, output: null, sessions: null, requests: 0 };
  let input = 0;
  let output = 0;
  let sessions = 0;
  let requests = 0;
  let sawTokens = false;
  for (const s of surfaces) {
    sessions += num(s.session_count);
    requests += num(s.request_count);
    if (s.token_usage) {
      sawTokens = true;
      input += num(s.token_usage.prompt_tokens_sum);
      output += num(s.token_usage.output_tokens_sum);
    }
  }
  return { input: sawTokens ? input : null, output: sawTokens ? output : null, sessions, requests };
}

/** "YYYY-MM-DD" → UTC midnight. */
export function copilotDay(day: string): Date {
  return new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
}

export function copilotUserUsedAnything(row: CopilotUserRow): boolean {
  return (
    row.used_agent === true ||
    row.used_chat === true ||
    row.used_cli === true ||
    row.used_copilot_app === true ||
    row.used_copilot_cloud_agent === true ||
    row.used_copilot_coding_agent === true ||
    row.used_copilot_code_review_active === true ||
    num(row.user_initiated_interaction_count) > 0 ||
    num(row.code_generation_activity_count) > 0 ||
    num(row.code_acceptance_activity_count) > 0
  );
}

/**
 * Map one `users-1-day` row to AssistantDailyStat columns.
 *
 * Column semantics for Copilot (they differ from Cursor, see the schema):
 *   - `requests`      = `user_initiated_interaction_count` (explicit prompts);
 *   - `linesAdded` / `linesRemoved` = `loc_added_sum` / `loc_deleted_sum`,
 *     which GitHub defines as Copilot-produced lines that actually landed in
 *     the editor, so `linesAccepted` equals `linesAdded`. The lines Copilot
 *     merely *suggested* are kept in metadata (`locSuggestedToAdd/Delete`);
 *   - `toolAccepted`  = `code_acceptance_activity_count`; the generation
 *     count lives in metadata so an acceptance rate can be derived;
 *   - `sessions` / tokens come from the CLI + Copilot app totals only (the
 *     IDE features do not report tokens); null when neither surface is present;
 *   - `estimatedCost` is null: Copilot is seat-licensed and `ai_credits_used`
 *     is not a currency amount. It is stored in metadata as `aiCreditsUsed`.
 */
export function copilotUserRowToStat(
  row: CopilotUserRow,
  actor: { externalId: string; name: string | null },
): AssistantDailyStatValues {
  const totals = sumTokens(row);
  const features = (row.totals_by_feature ?? [])
    .filter((f) => !!f.feature)
    .map((f) => ({
      feature: f.feature as string,
      interactions: num(f.user_initiated_interaction_count),
      generated: num(f.code_generation_activity_count),
      accepted: num(f.code_acceptance_activity_count),
      locAdded: num(f.loc_added_sum),
      locDeleted: num(f.loc_deleted_sum),
    }));
  const ides = (row.totals_by_ide ?? [])
    .filter((i) => !!i.ide)
    .map((i) => ({
      ide: i.ide as string,
      interactions: num(i.user_initiated_interaction_count),
      generated: num(i.code_generation_activity_count),
      accepted: num(i.code_acceptance_activity_count),
      locAdded: num(i.loc_added_sum),
    }));
  const languages = (row.totals_by_language_feature ?? [])
    .filter((l) => !!l.language)
    .map((l) => ({
      language: l.language as string,
      feature: l.feature ?? null,
      accepted: num(l.code_acceptance_activity_count),
      locAdded: num(l.loc_added_sum),
    }));
  const models = (row.totals_by_model_feature ?? [])
    .filter((m) => !!m.model)
    .map((m) => ({
      model: m.model as string,
      feature: m.feature ?? null,
      interactions: num(m.user_initiated_interaction_count),
      generated: num(m.code_generation_activity_count),
      accepted: num(m.code_acceptance_activity_count),
      locAdded: num(m.loc_added_sum),
    }));
  const thirdPartyAgents = (row.totals_by_3rd_party_agent ?? [])
    .filter((a) => !!a.agent_name)
    .map((a) => ({
      agentId: a.agent_id == null ? null : String(a.agent_id),
      agentName: a.agent_name as string,
      interactions: num(a.user_initiated_interaction_count),
    }));

  const locAdded = Math.round(num(row.loc_added_sum));
  return {
    provider: "github_copilot",
    day: copilotDay(row.day),
    actorExternalId: actor.externalId,
    product: "",
    actorName: actor.name,
    isActive: copilotUserUsedAnything(row),
    sessions: totals.sessions,
    requests: Math.round(num(row.user_initiated_interaction_count)),
    linesAdded: locAdded,
    linesRemoved: Math.round(num(row.loc_deleted_sum)),
    linesAccepted: locAdded,
    commits: null,
    pullRequests: null,
    toolAccepted: Math.round(num(row.code_acceptance_activity_count)),
    toolRejected: null,
    estimatedCost: null,
    inputTokens: totals.input == null ? null : Math.round(totals.input),
    outputTokens: totals.output == null ? null : Math.round(totals.output),
    cacheReadTokens: null,
    cacheCreationTokens: null,
    metadata: {
      login: row.user_login,
      userId: row.user_id == null ? null : String(row.user_id),
      aiCreditsUsed: typeof row.ai_credits_used === "number" ? row.ai_credits_used : null,
      adoptionPhase: row.ai_adoption_phase?.phase ?? null,
      adoptionPhaseNumber: row.ai_adoption_phase?.phase_number ?? null,
      codeGenerationCount: Math.round(num(row.code_generation_activity_count)),
      codeAcceptanceCount: Math.round(num(row.code_acceptance_activity_count)),
      locSuggestedToAdd: Math.round(num(row.loc_suggested_to_add_sum)),
      locSuggestedToDelete: Math.round(num(row.loc_suggested_to_delete_sum)),
      surfaceRequests: totals.requests,
      used: {
        agent: row.used_agent ?? null,
        chat: row.used_chat ?? null,
        cli: row.used_cli ?? null,
        copilotApp: row.used_copilot_app ?? null,
        cloudAgent: row.used_copilot_cloud_agent ?? null,
        codingAgent: row.used_copilot_coding_agent ?? null,
        codeReviewActive: row.used_copilot_code_review_active ?? null,
        codeReviewPassive: row.used_copilot_code_review_passive ?? null,
      },
      features,
      ides,
      languages,
      models,
      thirdPartyAgents,
    },
  };
}

/** Org-level totals the sync stores on the day's UsageBucket. */
export interface CopilotOrgDayTotals {
  day: string;
  interactions: number;
  inputTokens: number | null;
  outputTokens: number | null;
  metadata: Record<string, unknown>;
}

export function copilotOrgDayToTotals(row: CopilotOrgDay): CopilotOrgDayTotals {
  const totals = sumTokens(row);
  const pr = row.pull_requests ?? null;
  return {
    day: row.day.slice(0, 10),
    interactions: Math.round(num(row.user_initiated_interaction_count)),
    inputTokens: totals.input == null ? null : Math.round(totals.input),
    outputTokens: totals.output == null ? null : Math.round(totals.output),
    metadata: {
      organizationId: row.organization_id == null ? null : String(row.organization_id),
      enterpriseId: row.enterprise_id == null ? null : String(row.enterprise_id),
      dailyActiveUsers: row.daily_active_users ?? null,
      weeklyActiveUsers: row.weekly_active_users ?? null,
      monthlyActiveUsers: row.monthly_active_users ?? null,
      monthlyActiveChatUsers: row.monthly_active_chat_users ?? null,
      monthlyActiveAgentUsers: row.monthly_active_agent_users ?? null,
      dailyActiveCliUsers: row.daily_active_cli_users ?? null,
      dailyActiveCopilotAppUsers: row.daily_active_copilot_app_users ?? null,
      dailyActiveCloudAgentUsers: row.daily_active_copilot_cloud_agent_users ?? null,
      dailyActiveCodeReviewUsers: row.daily_active_copilot_code_review_users ?? null,
      dailyPassiveCodeReviewUsers: row.daily_passive_copilot_code_review_users ?? null,
      codeGenerationCount: Math.round(num(row.code_generation_activity_count)),
      codeAcceptanceCount: Math.round(num(row.code_acceptance_activity_count)),
      locAdded: Math.round(num(row.loc_added_sum)),
      locDeleted: Math.round(num(row.loc_deleted_sum)),
      locSuggestedToAdd: Math.round(num(row.loc_suggested_to_add_sum)),
      locSuggestedToDelete: Math.round(num(row.loc_suggested_to_delete_sum)),
      sessions: totals.sessions,
      pullRequests: pr
        ? {
            created: pr.total_created ?? null,
            createdByCopilot: pr.total_created_by_copilot ?? null,
            merged: pr.total_merged ?? null,
            mergedCreatedByCopilot: pr.total_merged_created_by_copilot ?? null,
            mergedReviewedByCopilot: pr.total_merged_reviewed_by_copilot ?? null,
            reviewed: pr.total_reviewed ?? null,
            reviewedByCopilot: pr.total_reviewed_by_copilot ?? null,
            suggestions: pr.total_suggestions ?? null,
            copilotSuggestions: pr.total_copilot_suggestions ?? null,
            appliedSuggestions: pr.total_applied_suggestions ?? null,
            copilotAppliedSuggestions: pr.total_copilot_applied_suggestions ?? null,
            medianMinutesToMerge: pr.median_minutes_to_merge ?? null,
            medianMinutesToMergeCopilotAuthored: pr.median_minutes_to_merge_copilot_authored ?? null,
            medianMinutesToMergeCopilotReviewed: pr.median_minutes_to_merge_copilot_reviewed ?? null,
          }
        : null,
      features: (row.totals_by_feature ?? [])
        .filter((f) => !!f.feature)
        .map((f) => ({
          feature: f.feature as string,
          interactions: num(f.user_initiated_interaction_count),
          generated: num(f.code_generation_activity_count),
          accepted: num(f.code_acceptance_activity_count),
          locAdded: num(f.loc_added_sum),
          locDeleted: num(f.loc_deleted_sum),
        })),
      ides: (row.totals_by_ide ?? [])
        .filter((i) => !!i.ide)
        .map((i) => ({
          ide: i.ide as string,
          interactions: num(i.user_initiated_interaction_count),
          generated: num(i.code_generation_activity_count),
          accepted: num(i.code_acceptance_activity_count),
          locAdded: num(i.loc_added_sum),
        })),
      languages: (row.totals_by_language_feature ?? [])
        .filter((l) => !!l.language)
        .map((l) => ({ language: l.language as string, feature: l.feature ?? null, accepted: num(l.code_acceptance_activity_count), locAdded: num(l.loc_added_sum) })),
      models: (row.totals_by_model_feature ?? [])
        .filter((m) => !!m.model)
        .map((m) => ({ model: m.model as string, feature: m.feature ?? null, interactions: num(m.user_initiated_interaction_count), generated: num(m.code_generation_activity_count), accepted: num(m.code_acceptance_activity_count), locAdded: num(m.loc_added_sum) })),
      thirdPartyAgents: (row.totals_by_3rd_party_agent ?? [])
        .filter((a) => !!a.agent_name)
        .map((a) => ({ agentName: a.agent_name as string, sessions: num(a.session_count), interactions: num(a.user_initiated_interaction_count) })),
      adoptionPhases: (row.totals_by_ai_adoption_phase ?? [])
        .filter((p) => !!p.phase)
        .map((p) => ({ phase: p.phase as string, phaseNumber: p.phase_number ?? null, engagedUsers: num(p.total_engaged_users) })),
    },
  };
}

// ─── Day walk ─────────────────────────────────────────────────────────────

export function formatCopilotDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

export interface CopilotDayWalk {
  /** Days to request, ascending, as "YYYY-MM-DD". */
  days: string[];
  /** Days inside the window that were dropped because of the per-run cap. */
  skippedDays: string[];
  /** Days before COPILOT_DATA_START_DAY that were dropped (never available). */
  beforeDataStart: number;
}

/**
 * Turn a sync window into the list of report days to fetch.
 *
 * Reports are per UTC day and a day's report is only complete once the day
 * has ended, so the walk covers `[startOfDay(from), startOfDay(to))` — the
 * current (partial) day is never requested. Days before the API's data
 * start are dropped. When the window holds more than
 * `COPILOT_MAX_DAYS_PER_RUN` days the *newest* days are kept and the older
 * ones are reported as skipped: the scheduled sync must always land the
 * freshest data, and the skipped range is what Backfill is for.
 */
export function planCopilotDayWalk(
  window: { from: Date; to: Date },
  options: { maxDays?: number; dataStartDay?: string } = {},
): CopilotDayWalk {
  const maxDays = options.maxDays ?? COPILOT_MAX_DAYS_PER_RUN;
  const dataStart = options.dataStartDay ?? COPILOT_DATA_START_DAY;
  const all: string[] = [];
  let beforeDataStart = 0;
  const end = startOfUtcDay(window.to);
  for (let cursor = startOfUtcDay(window.from); cursor < end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const day = formatCopilotDay(cursor);
    if (day < dataStart) {
      beforeDataStart++;
      continue;
    }
    all.push(day);
  }
  if (all.length <= maxDays) return { days: all, skippedDays: [], beforeDataStart };
  return {
    days: all.slice(all.length - maxDays),
    skippedDays: all.slice(0, all.length - maxDays),
    beforeDataStart,
  };
}

/**
 * Whether a missing report for `day` is still expected to arrive: GitHub
 * publishes a day's report within `COPILOT_REPORT_LAG_DAYS` full days. A
 * 404 inside that lag is "pending"; an older 404 is a day with no data.
 */
export function isCopilotReportPending(day: string, now: Date, lagDays: number = COPILOT_REPORT_LAG_DAYS): boolean {
  const dayStart = copilotDay(day).getTime();
  const cutoff = startOfUtcDay(now).getTime() - lagDays * DAY_MS;
  return dayStart >= cutoff;
}

/**
 * The window to hand to the watermark after a run. Pending days (recent
 * reports that were not published yet) hold the watermark back so the next
 * scheduled run re-requests them instead of relying on the overlap alone;
 * anything older than the publication lag is treated as final.
 */
export function resolveCopilotWatermarkWindow(
  window: { from: Date; to: Date },
  pendingDays: string[],
): { from: Date; to: Date } {
  if (pendingDays.length === 0) return window;
  const earliest = [...pendingDays].sort()[0];
  const holdBack = copilotDay(earliest);
  if (holdBack <= window.from) return { from: window.from, to: new Date(window.from.getTime() + DAY_MS) };
  return holdBack < window.to ? { from: window.from, to: holdBack } : window;
}
