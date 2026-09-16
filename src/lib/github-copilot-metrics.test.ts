import test from "node:test";
import assert from "node:assert/strict";
import {
  COPILOT_MAX_DAYS_PER_RUN,
  buildSeatIndex,
  copilotActorExternalId,
  copilotOrgDayToTotals,
  copilotUserRowToStat,
  isCopilotReportPending,
  parseCopilotNdjson,
  parseCopilotOrgReport,
  parseCopilotUserReport,
  planCopilotDayWalk,
  resolveCopilotWatermarkWindow,
  copilotUserRowSchema,
} from "./github-copilot-metrics";

// A users-1-day line shaped like GitHub's published example schema, with an
// extra unknown field to prove the parser tolerates additions.
const USER_LINE = JSON.stringify({
  ai_adoption_phase: { phase: "Phase 2", phase_number: 2, version: "v1" },
  ai_credits_used: 12.5,
  code_acceptance_activity_count: 3,
  code_generation_activity_count: 4,
  day: "2026-09-10",
  enterprise_id: "1",
  organization_id: "22",
  loc_added_sum: 32,
  loc_deleted_sum: 6,
  loc_suggested_to_add_sum: 34,
  loc_suggested_to_delete_sum: 6,
  totals_by_cli: {
    last_known_cli_version: { cli_version: "1.0.8", sampled_at: "2026-09-10T00:01:43.000Z" },
    prompt_count: 2,
    request_count: 2,
    session_count: 2,
    token_usage: { avg_tokens_per_request: 4400.0, output_tokens_sum: 5000, prompt_tokens_sum: 3800 },
  },
  totals_by_copilot_app: {
    prompt_count: 1,
    request_count: 3,
    session_count: 1,
    token_usage: { avg_tokens_per_request: 3200.0, output_tokens_sum: 4200, prompt_tokens_sum: 5400 },
  },
  totals_by_3rd_party_agent: [{ agent_id: "2246796", agent_name: "Claude (Anthropic)", user_initiated_interaction_count: 2 }],
  totals_by_feature: [
    { code_acceptance_activity_count: 1, code_generation_activity_count: 1, feature: "code_completion", loc_added_sum: 8, loc_deleted_sum: 0, loc_suggested_to_add_sum: 10, loc_suggested_to_delete_sum: 0, user_initiated_interaction_count: 0 },
    { code_acceptance_activity_count: 2, code_generation_activity_count: 3, feature: "chat_panel_agent_mode", loc_added_sum: 24, loc_deleted_sum: 6, loc_suggested_to_add_sum: 24, loc_suggested_to_delete_sum: 6, user_initiated_interaction_count: 1 },
  ],
  totals_by_ide: [
    { code_acceptance_activity_count: 3, code_generation_activity_count: 4, ide: "vscode", last_known_ide_version: { ide_version: "1.85.0", sampled_at: "2026-09-10T00:00:02.000Z" }, loc_added_sum: 32, loc_deleted_sum: 6, loc_suggested_to_add_sum: 34, loc_suggested_to_delete_sum: 6, user_initiated_interaction_count: 1 },
  ],
  totals_by_language_feature: [
    { code_acceptance_activity_count: 3, code_generation_activity_count: 4, feature: "code_completion", language: "typescript", loc_added_sum: 32, loc_deleted_sum: 6, loc_suggested_to_add_sum: 34, loc_suggested_to_delete_sum: 6 },
  ],
  totals_by_language_model: [],
  totals_by_model_feature: [{ model: "gpt-5", feature: "chat_panel_agent_mode", code_acceptance_activity_count: 2, code_generation_activity_count: 3, loc_added_sum: 24, loc_deleted_sum: 6, loc_suggested_to_add_sum: 24, loc_suggested_to_delete_sum: 6, user_initiated_interaction_count: 1 }],
  used_agent: true,
  used_chat: false,
  used_cli: true,
  used_copilot_app: true,
  used_copilot_cloud_agent: false,
  used_copilot_code_review_active: null,
  used_copilot_code_review_passive: null,
  used_copilot_coding_agent: false,
  user_id: 1,
  user_login: "OctoCat",
  user_initiated_interaction_count: 1,
  etl_id: "green",
  day_partition: "2026-09-10",
  entity_id_partition: 1,
  some_future_field: { nested: true },
});

test("parseCopilotNdjson skips blank lines, keeps unknown fields, and reports bad lines without failing", () => {
  const body = `${USER_LINE}\n\n  \nnot json at all\n{"user_login":"missing-day"}\n${USER_LINE}\n`;
  const { rows, rejected } = parseCopilotUserReport(body);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].user_login, "OctoCat");
  // Unknown fields survive (loose object).
  assert.deepEqual((rows[0] as Record<string, unknown>).some_future_field, { nested: true });
  assert.equal(rejected.length, 2);
  assert.equal(rejected[0].line, 4);
  assert.match(rejected[0].reason, /invalid JSON/);
  assert.equal(rejected[1].line, 5);
  assert.match(rejected[1].reason, /day/);
});

test("parseCopilotNdjson also accepts a JSON array body and an empty body", () => {
  const arr = parseCopilotNdjson(`[${USER_LINE}]`, copilotUserRowSchema);
  assert.equal(arr.rows.length, 1);
  assert.equal(arr.rejected.length, 0);
  const empty = parseCopilotNdjson("   \n", copilotUserRowSchema);
  assert.deepEqual(empty, { rows: [], rejected: [] });
});

test("copilotUserRowToStat maps the documented fields onto AssistantDailyStat columns", () => {
  const [row] = parseCopilotUserReport(USER_LINE).rows;
  const stat = copilotUserRowToStat(row, { externalId: "octocat@example.com", name: "OctoCat" });
  assert.equal(stat.provider, "github_copilot");
  assert.equal(stat.day.toISOString(), "2026-09-10T00:00:00.000Z");
  assert.equal(stat.actorExternalId, "octocat@example.com");
  assert.equal(stat.isActive, true);
  assert.equal(stat.requests, 1); // user_initiated_interaction_count
  assert.equal(stat.sessions, 3); // cli 2 + app 1
  assert.equal(stat.inputTokens, 3800 + 5400);
  assert.equal(stat.outputTokens, 5000 + 4200);
  assert.equal(stat.linesAdded, 32);
  assert.equal(stat.linesRemoved, 6);
  assert.equal(stat.linesAccepted, 32); // Copilot-produced lines that landed
  assert.equal(stat.toolAccepted, 3); // code_acceptance_activity_count
  assert.equal(stat.toolRejected, null);
  assert.equal(stat.estimatedCost, null); // seat-licensed; credits are not USD
  assert.equal(stat.metadata.aiCreditsUsed, 12.5);
  assert.equal(stat.metadata.codeGenerationCount, 4);
  assert.equal(stat.metadata.locSuggestedToAdd, 34);
  assert.equal(stat.metadata.adoptionPhase, "Phase 2");
  assert.deepEqual((stat.metadata.features as { feature: string }[]).map((f) => f.feature), ["code_completion", "chat_panel_agent_mode"]);
  assert.deepEqual((stat.metadata.ides as { ide: string }[]).map((i) => i.ide), ["vscode"]);
  assert.deepEqual((stat.metadata.models as { model: string }[]).map((m) => m.model), ["gpt-5"]);
  assert.equal((stat.metadata.used as { cli: boolean }).cli, true);
});

test("copilotUserRowToStat leaves tokens/sessions null when neither CLI nor app totals are present", () => {
  const row = copilotUserRowSchema.parse({ day: "2026-09-10", user_login: "quiet", user_initiated_interaction_count: 0 });
  const stat = copilotUserRowToStat(row, { externalId: "quiet", name: "quiet" });
  assert.equal(stat.inputTokens, null);
  assert.equal(stat.outputTokens, null);
  assert.equal(stat.sessions, null);
  assert.equal(stat.isActive, false);
});

test("copilotActorExternalId prefers the seat email, else the lower-cased login", () => {
  assert.equal(copilotActorExternalId("OctoCat", "Octo.Cat@Example.com"), "octo.cat@example.com");
  assert.equal(copilotActorExternalId("OctoCat", null), "octocat");
  assert.equal(copilotActorExternalId("OctoCat", "not-an-email"), "octocat");
  const index = buildSeatIndex([
    { login: "OctoCat", userId: 1, email: "octo@example.com", lastActivityAt: null, lastActivityEditor: null, planType: "business", createdAt: null, pendingCancellationDate: null },
  ]);
  assert.equal(index.get("octocat")?.email, "octo@example.com");
});

test("parseCopilotOrgReport unwraps day_totals and accepts flat rows", () => {
  const wrapped = JSON.stringify({
    day_totals: [
      { day: "2026-09-10", organization_id: "22", enterprise_id: "", daily_active_users: 7, weekly_active_users: 9, monthly_active_users: 10, user_initiated_interaction_count: 40, loc_added_sum: 300, pull_requests: { total_created: 4, total_created_by_copilot: 1, total_merged: 3 }, totals_by_feature: [{ feature: "code_completion", loc_added_sum: 200 }], totals_by_ai_adoption_phase: [{ phase: "Phase 1", phase_number: 1, total_engaged_users: 4 }], totals_by_cli: { session_count: 3, token_usage: { prompt_tokens_sum: 100, output_tokens_sum: 50 } } },
    ],
    organization_id: "22",
    report_start_day: "2026-09-10",
    report_end_day: "2026-09-10",
  });
  const flat = JSON.stringify({ day: "2026-09-11", organization_id: "22", daily_active_users: 3 });
  const { rows, rejected } = parseCopilotOrgReport(`${wrapped}\n${flat}\n`);
  assert.equal(rejected.length, 0);
  assert.deepEqual(rows.map((r) => r.day), ["2026-09-10", "2026-09-11"]);
  const totals = copilotOrgDayToTotals(rows[0]);
  assert.equal(totals.interactions, 40);
  assert.equal(totals.inputTokens, 100);
  assert.equal(totals.outputTokens, 50);
  assert.equal(totals.metadata.dailyActiveUsers, 7);
  assert.equal((totals.metadata.pullRequests as { createdByCopilot: number }).createdByCopilot, 1);
  assert.deepEqual((totals.metadata.adoptionPhases as { phase: string }[]).map((p) => p.phase), ["Phase 1"]);
  const second = copilotOrgDayToTotals(rows[1]);
  assert.equal(second.inputTokens, null);
  assert.equal(second.metadata.pullRequests, null);
});

test("planCopilotDayWalk covers whole past UTC days only, ascending", () => {
  const walk = planCopilotDayWalk({
    from: new Date("2026-09-10T00:00:00.000Z"),
    to: new Date("2026-09-14T15:42:00.000Z"),
  });
  // The partial current day (09-14) is never requested.
  assert.deepEqual(walk.days, ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
  assert.deepEqual(walk.skippedDays, []);
  assert.equal(walk.beforeDataStart, 0);
});

test("planCopilotDayWalk keeps the newest days when the window exceeds the per-run cap", () => {
  const walk = planCopilotDayWalk({
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2026-09-14T01:00:00.000Z"),
  });
  assert.equal(walk.days.length, COPILOT_MAX_DAYS_PER_RUN);
  assert.equal(walk.days[walk.days.length - 1], "2026-09-13");
  assert.equal(walk.days[0], "2026-08-17");
  assert.equal(walk.skippedDays[0], "2026-08-01");
  assert.equal(walk.skippedDays[walk.skippedDays.length - 1], "2026-08-16");
});

test("planCopilotDayWalk drops days before the API's data start", () => {
  const walk = planCopilotDayWalk({
    from: new Date("2025-10-08T00:00:00.000Z"),
    to: new Date("2025-10-12T12:00:00.000Z"),
  });
  assert.deepEqual(walk.days, ["2025-10-10", "2025-10-11"]);
  assert.equal(walk.beforeDataStart, 2);
});

test("isCopilotReportPending treats a 404 inside the two-day publication lag as pending", () => {
  const now = new Date("2026-09-14T10:00:00.000Z");
  assert.equal(isCopilotReportPending("2026-09-13", now), true);
  assert.equal(isCopilotReportPending("2026-09-12", now), true);
  assert.equal(isCopilotReportPending("2026-09-11", now), false);
});

test("resolveCopilotWatermarkWindow holds the watermark at the earliest pending day", () => {
  const window = { from: new Date("2026-09-10T00:00:00.000Z"), to: new Date("2026-09-14T10:00:00.000Z") };
  assert.deepEqual(resolveCopilotWatermarkWindow(window, []), window);
  const held = resolveCopilotWatermarkWindow(window, ["2026-09-13", "2026-09-12"]);
  assert.equal(held.from.toISOString(), window.from.toISOString());
  assert.equal(held.to.toISOString(), "2026-09-12T00:00:00.000Z");
  // A pending day at or before the window start still yields a non-empty window.
  const clamped = resolveCopilotWatermarkWindow(window, ["2026-09-10"]);
  assert.ok(clamped.to > clamped.from);
});
