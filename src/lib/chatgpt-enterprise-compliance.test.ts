import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceStreamWatermark,
  aggregateCodexEvents,
  aggregateConversationMessages,
  complianceActivityFromEvent,
  dedupeEvents,
  detectAdminRoleAuditGrants,
  detectAdminRoleGrants,
  detectGptsWithActions,
  detectNewWorkspaceUsers,
  latestGptCreatedAt,
  normalizeActor,
  normalizeWorkspaceUser,
  parseJsonl,
  planLogFileBatch,
  resolveLogCursor,
  type ChatGPTLogFileMetadata,
  type ChatGPTWorkspaceGpt,
  type ComplianceLogEnvelope,
} from "./chatgpt-enterprise-compliance";
import {
  chatgptDailyCountsToStat,
  codexDailyCountsToStat,
  mergeAssistantDailyStat,
} from "./assistant-daily-stats";

const DAY_MS = 24 * 60 * 60 * 1000;

function envelope(overrides: Partial<ComplianceLogEnvelope> & Record<string, unknown>): ComplianceLogEnvelope {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    type: "AUTH_LOG",
    timestamp: "2026-09-15T10:00:00.000Z",
    principal: { id: "ws-1", type: "CHATGPT_WORKSPACE" },
    actor: { type: "ACCOUNT_USER", user_id: "user-1", user_email: "Alice@Example.org" },
    ...overrides,
  };
}

// ─── JSONL + envelope ─────────────────────────────────────────────────────

test("parseJsonl keeps object lines, skips blanks, counts malformed lines", () => {
  const text = [
    '{"event_id":"a","type":"AUTH_LOG"}',
    "",
    "   ",
    "not json",
    '["array"]',
    '{"event_id":"b"}\r',
  ].join("\n");
  const parsed = parseJsonl(text);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].event_id, "a");
  assert.equal(parsed.records[1].event_id, "b");
  assert.equal(parsed.malformed, 2);
});

test("normalizeActor lower-cases the email and reads API-key actors", () => {
  assert.deepEqual(normalizeActor(envelope({})), {
    type: "ACCOUNT_USER",
    email: "alice@example.org",
    userId: "user-1",
    apiKeyId: null,
  });
  assert.deepEqual(
    normalizeActor(envelope({ actor: { type: "API_KEY", redacted_id: "sk-...abcd" } })),
    { type: "API_KEY", email: null, userId: null, apiKeyId: "sk-...abcd" },
  );
});

test("dedupeEvents drops repeated event_ids across files but keeps id-less events", () => {
  const seen = new Set<string>();
  const first = dedupeEvents([envelope({ event_id: "x" }), envelope({ event_id: "y" })], seen);
  assert.equal(first.events.length, 2);
  assert.equal(first.duplicates, 0);
  const second = dedupeEvents(
    [envelope({ event_id: "x" }), envelope({ event_id: "z" }), envelope({ event_id: undefined })],
    seen,
  );
  assert.equal(second.events.length, 2);
  assert.equal(second.duplicates, 1);
});

// ─── Cursor rules ─────────────────────────────────────────────────────────

test("resolveLogCursor starts 7 days back without a watermark and resumes from one", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  assert.equal(
    resolveLogCursor({ watermark: null, now }).toISOString(),
    new Date(now.getTime() - 7 * DAY_MS).toISOString(),
  );
  const watermark = new Date("2026-09-15T23:50:00Z");
  assert.equal(resolveLogCursor({ watermark, now }).getTime(), watermark.getTime());
});

test("resolveLogCursor never reaches past the 30-day retention window or into the future", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  const stale = new Date(now.getTime() - 45 * DAY_MS);
  assert.equal(
    resolveLogCursor({ watermark: stale, now }).getTime(),
    now.getTime() - 30 * DAY_MS,
  );
  const future = new Date(now.getTime() + DAY_MS);
  assert.equal(resolveLogCursor({ watermark: future, now }).getTime(), now.getTime());
  // A fresh install with a lookback wider than retention is clamped too.
  assert.equal(
    resolveLogCursor({ watermark: null, now, initialLookbackDays: 90 }).getTime(),
    now.getTime() - 30 * DAY_MS,
  );
});

function file(id: string, endTime: string, size = 1000): ChatGPTLogFileMetadata {
  return { id, event_type: "AUTH_LOG", end_time: endTime, file_name: `${id}.jsonl`, file_size: size, file_sha256: "x" };
}

test("planLogFileBatch orders by end_time, caps files, and advances only over processed files", () => {
  const files = [
    file("c", "2026-09-15T10:30:00Z"),
    file("a", "2026-09-15T10:10:00Z"),
    file("b", "2026-09-15T10:20:00Z"),
  ];
  const plan = planLogFileBatch(files, { maxFiles: 2 });
  assert.deepEqual(plan.files.map((f) => f.id), ["a", "b"]);
  assert.equal(plan.truncated, true);
  assert.equal(plan.nextWatermark?.toISOString(), "2026-09-15T10:20:00.000Z");

  const full = planLogFileBatch(files);
  assert.equal(full.truncated, false);
  assert.equal(full.nextWatermark?.toISOString(), "2026-09-15T10:30:00.000Z");
});

test("planLogFileBatch respects the byte cap but always takes at least one file", () => {
  const files = [file("a", "2026-09-15T10:10:00Z", 50), file("b", "2026-09-15T10:20:00Z", 60)];
  const plan = planLogFileBatch(files, { maxBytes: 100 });
  assert.deepEqual(plan.files.map((f) => f.id), ["a"]);
  assert.equal(plan.truncated, true);
  const huge = planLogFileBatch([file("big", "2026-09-15T10:10:00Z", 10_000)], { maxBytes: 100 });
  assert.equal(huge.files.length, 1);
  assert.equal(huge.truncated, false);
  assert.deepEqual(planLogFileBatch([]), { files: [], truncated: false, nextWatermark: null });
});

test("advanceStreamWatermark never moves backwards and widens earliest", () => {
  const start = new Date("2026-09-09T00:00:00Z");
  const first = advanceStreamWatermark(null, new Date("2026-09-15T10:20:00Z"), start);
  assert.equal(first?.watermark.toISOString(), "2026-09-15T10:20:00.000Z");
  assert.equal(first?.earliest.toISOString(), start.toISOString());
  const older = advanceStreamWatermark(first, new Date("2026-09-14T00:00:00Z"), new Date("2026-09-01T00:00:00Z"));
  assert.equal(older?.watermark.toISOString(), "2026-09-15T10:20:00.000Z");
  assert.equal(older?.earliest.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(advanceStreamWatermark(first, null, start), first);
});

// ─── ComplianceActivity rows ──────────────────────────────────────────────

test("complianceActivityFromEvent maps AUTH_LOG and AUDIT_LOG envelopes", () => {
  const auth = complianceActivityFromEvent(
    envelope({
      event_id: "auth-1",
      request_metadata: { client_ip: "10.0.0.1", client_user_agent: "UA" },
      action_data: { action: "login_success", auth_provider_name: "saml" },
    }),
    "AUTH_LOG",
    "ws-fallback",
  );
  assert.ok(auth);
  assert.equal(auth.id, "auth-1");
  assert.equal(auth.provider, "openai");
  assert.equal(auth.type, "auth_log:login_success");
  assert.equal(auth.organizationId, "ws-1");
  assert.equal(auth.actorEmail, "alice@example.org");
  assert.equal(auth.actorUserId, "user-1");
  assert.equal(auth.ipAddress, "10.0.0.1");
  assert.equal(auth.userAgent, "UA");
  assert.equal(auth.occurredAt.toISOString(), "2026-09-15T10:00:00.000Z");
  assert.deepEqual(Object.keys(auth.payload).sort(), ["action_data", "actor", "event_type", "principal", "request_metadata"]);

  const audit = complianceActivityFromEvent(
    envelope({
      event_id: "audit-1",
      type: "AUDIT_LOG",
      principal: undefined,
      action: "USER_ROLE_UPDATED",
      action_result: "SUCCESS",
      action_privilege: "ADMIN",
      request_metadata: { client_ip: "10.0.0.2" },
      action_data: { user_id: "user-9", role: "account-admin" },
    }),
    "AUDIT_LOG",
    "ws-fallback",
  );
  assert.ok(audit);
  assert.equal(audit.type, "audit_log:USER_ROLE_UPDATED");
  assert.equal(audit.organizationId, "ws-fallback");
  assert.equal(audit.payload.action_result, "SUCCESS");
  assert.equal((audit.payload.action_data as Record<string, unknown>).role, "account-admin");

  assert.equal(complianceActivityFromEvent(envelope({ event_id: undefined }), "AUTH_LOG", null), null);
  assert.equal(complianceActivityFromEvent(envelope({ timestamp: "garbage" }), "AUTH_LOG", null), null);
});

// ─── Conversation messages ────────────────────────────────────────────────

test("aggregateConversationMessages counts per user per day without touching content", () => {
  const events: ComplianceLogEnvelope[] = [
    envelope({
      type: "CONVERSATION_MESSAGE",
      timestamp: "2026-09-15T09:00:00Z",
      message: { id: "m1", author: { type: "user", client_type: "desktop_web" }, content: { type: "text", value: "SECRET" } },
      conversation: { id: "c1", title: "SECRET TITLE", gpt_id: "g-1" },
    }),
    envelope({
      type: "CONVERSATION_MESSAGE",
      timestamp: "2026-09-15T09:00:05Z",
      message: { id: "m2", author: { type: "assistant", model: "gpt-5" } },
      conversation: { id: "c1", gpt_id: "g-1" },
    }),
    envelope({
      type: "CONVERSATION_MESSAGE",
      timestamp: "2026-09-15T23:59:59Z",
      message: { id: "m3", author: { type: "user", client_type: "ios_app" } },
      conversation: { id: "c2", project_id: "p-1" },
    }),
    // Next UTC day, different user, no email → keyed by user id.
    envelope({
      type: "CONVERSATION_MESSAGE",
      timestamp: "2026-09-16T00:00:01Z",
      actor: { type: "ACCOUNT_USER", user_id: "user-2" },
      message: { id: "m4", author: { type: "user", client_type: "macos_app" } },
      conversation: { id: "c3" },
    }),
    // Unusable timestamp → dropped.
    envelope({ type: "CONVERSATION_MESSAGE", timestamp: "nope", message: { author: { type: "user" } } }),
  ];
  const rows = aggregateConversationMessages(events);
  assert.equal(rows.length, 2);
  const [alice, bob] = rows;
  assert.equal(alice.actorExternalId, "alice@example.org");
  assert.equal(alice.day, "2026-09-15");
  assert.equal(alice.userMessages, 2);
  assert.equal(alice.assistantMessages, 1);
  assert.equal(alice.conversations, 2);
  assert.equal(alice.gptConversations, 1);
  assert.equal(alice.projectConversations, 1);
  assert.equal(alice.gpts, 1);
  assert.deepEqual(alice.models, { "gpt-5": 1 });
  assert.deepEqual(alice.clientTypes, { desktop_web: 1, ios_app: 1 });
  assert.equal(JSON.stringify(alice).includes("SECRET"), false);

  assert.equal(bob.actorExternalId, "user:user-2");
  assert.equal(bob.email, null);
  assert.equal(bob.day, "2026-09-16");
  assert.equal(bob.userMessages, 1);
});

test("chatgptDailyCountsToStat maps requests/sessions and leaves cost unknown", () => {
  const [counts] = aggregateConversationMessages([
    envelope({
      type: "CONVERSATION_MESSAGE",
      message: { author: { type: "user", client_type: "desktop_web" } },
      conversation: { id: "c1" },
    }),
  ]);
  const stat = chatgptDailyCountsToStat(counts, { externalId: counts.actorExternalId, name: "alice" }, new Date("2026-09-15T00:00:00Z"));
  assert.equal(stat.provider, "chatgpt");
  assert.equal(stat.requests, 1);
  assert.equal(stat.sessions, 1);
  assert.equal(stat.isActive, true);
  assert.equal(stat.estimatedCost, null);
  assert.equal(stat.inputTokens, null);
  assert.equal(stat.metadata.source, "chatgpt_compliance_api");
});

// ─── Codex ────────────────────────────────────────────────────────────────

function codexLog(subType: string, details: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return envelope({
    type: "CODEX_LOG",
    timestamp: "2026-09-15T14:00:00Z",
    event_type: subType,
    client_id: "CODEX_CLI",
    event_details: { session_id: "s1", ...details },
    ...extra,
  });
}

test("aggregateCodexEvents counts prompts, tools, tokens and never reads prompt text", () => {
  const rows = aggregateCodexEvents(
    [
      codexLog("PROMPT_SENT", { prompt_text: "SECRET PROMPT", model: "gpt-5-codex" }),
      codexLog("PROMPT_RESPONSE_RECEIVED", {
        response_text: "SECRET RESPONSE",
        model: "gpt-5-codex",
        token_usage: { input_tokens: 100, output_tokens: 40, cached_input_tokens: 30, reasoning_output_tokens: 10 },
      }),
      codexLog("TOOL_CALL_COMPLETED", { tool_name: "shell", tool_input: "rm -rf SECRET" }),
      codexLog("TOOL_CALL_FAILED", { tool_name: "shell" }),
      codexLog("TOOL_DECISION", { decision: "denied", tool_name: "shell" }),
      codexLog("TOOL_DECISION", { decision: "approved_for_session", tool_name: "shell" }),
      codexLog("PROMPT_SENT", { session_id: "s2" }),
    ],
    [],
  );
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.prompts, 2);
  assert.equal(row.responses, 1);
  assert.equal(row.sessions, 2);
  assert.equal(row.toolCallsCompleted, 1);
  assert.equal(row.toolCallsFailed, 1);
  assert.equal(row.toolDecisionsDenied, 1);
  assert.equal(row.toolDecisionsApproved, 1);
  assert.equal(row.turns, 0);
  assert.equal(row.tokenSource, "codex_log");
  assert.deepEqual(row.tokens, { input: 100, output: 40, cachedInput: 30, reasoningOutput: 10 });
  assert.equal(row.costUsd, null);
  assert.deepEqual(row.clients, { CODEX_CLI: 7 });
  assert.deepEqual(row.models, { "gpt-5-codex": 1 });
  assert.equal(JSON.stringify(row).includes("SECRET"), false);

  const stat = codexDailyCountsToStat(row, { externalId: row.actorExternalId, name: "alice" }, new Date("2026-09-15T00:00:00Z"));
  assert.equal(stat.provider, "codex");
  assert.equal(stat.requests, 2);
  assert.equal(stat.toolAccepted, 2);
  assert.equal(stat.toolRejected, 2);
  assert.equal(stat.inputTokens, 100);
  assert.equal(stat.cacheReadTokens, 30);
  assert.equal(stat.estimatedCost, null);
});

test("aggregateCodexEvents prefers CODEX_TURN tokens and sums turn cost", () => {
  const turn = (id: string, cost: Record<string, unknown>) =>
    envelope({
      type: "CODEX_TURN",
      timestamp: "2026-09-15T15:00:00Z",
      payload: {
        turn_id: id,
        session_id: "s9",
        product_client_id: "CODEX_IDE_VSCODE",
        model: "gpt-5",
        token_usage: { uncached_input_tokens: 100, cached_input_tokens: 20, output_tokens: 50 },
        ...cost,
      },
    });
  const rows = aggregateCodexEvents(
    [codexLog("PROMPT_RESPONSE_RECEIVED", { token_usage: { input_tokens: 1, output_tokens: 1 } })],
    [turn("t1", { cost_usd: 0.25 }), turn("t2", { estimated_cost_usd: 0.1, credits: 3 })],
  );
  const row = rows[0];
  assert.equal(row.turns, 2);
  assert.equal(row.tokenSource, "codex_turn");
  assert.deepEqual(row.tokens, { input: 240, output: 100, cachedInput: 40, reasoningOutput: 0 });
  assert.equal(row.costUsd, 0.35);
  assert.equal(row.credits, 3);
  assert.equal(row.sessions, 2);
  const stat = codexDailyCountsToStat(row, { externalId: row.actorExternalId, name: null }, new Date("2026-09-15T00:00:00Z"));
  // No PROMPT_SENT in the batch → turns stand in for requests.
  assert.equal(stat.requests, 2);
  assert.equal(stat.estimatedCost, 0.35);
  assert.equal(stat.metadata.tokenSource, "codex_turn");
});

// ─── Incremental merge ────────────────────────────────────────────────────

test("mergeAssistantDailyStat adds a later batch onto the same day", () => {
  const day = new Date("2026-09-15T00:00:00Z");
  const first = chatgptDailyCountsToStat(
    aggregateConversationMessages([
      envelope({ type: "CONVERSATION_MESSAGE", message: { author: { type: "user", client_type: "desktop_web" } }, conversation: { id: "c1" } }),
      envelope({ type: "CONVERSATION_MESSAGE", message: { author: { type: "assistant", model: "gpt-5" } }, conversation: { id: "c1" } }),
    ])[0],
    { externalId: "alice@example.org", name: "alice" },
    day,
  );
  const second = chatgptDailyCountsToStat(
    aggregateConversationMessages([
      envelope({ type: "CONVERSATION_MESSAGE", timestamp: "2026-09-15T18:00:00Z", message: { author: { type: "user", client_type: "ios_app" } }, conversation: { id: "c2" } }),
      envelope({ type: "CONVERSATION_MESSAGE", timestamp: "2026-09-15T18:00:01Z", message: { author: { type: "assistant", model: "gpt-5" } }, conversation: { id: "c2" } }),
      envelope({ type: "CONVERSATION_MESSAGE", timestamp: "2026-09-15T18:00:02Z", message: { author: { type: "assistant", model: "o3" } }, conversation: { id: "c2" } }),
    ])[0],
    { externalId: "alice@example.org", name: "alice" },
    day,
  );
  const merged = mergeAssistantDailyStat({ ...first, metadata: first.metadata }, second);
  assert.equal(merged.requests, 2);
  assert.equal(merged.sessions, 2);
  assert.equal(merged.isActive, true);
  assert.equal(merged.estimatedCost, null);
  assert.equal(merged.metadata.assistantMessages, 3);
  assert.deepEqual(merged.metadata.models, { "gpt-5": 2, o3: 1 });
  assert.deepEqual(merged.metadata.clientTypes, { desktop_web: 1, ios_app: 1 });
  // No existing row → incoming unchanged.
  assert.equal(mergeAssistantDailyStat(null, second), second);
});

test("mergeAssistantDailyStat keeps unknown cost unknown and adds known cost", () => {
  const day = new Date("2026-09-15T00:00:00Z");
  const base = codexDailyCountsToStat(
    aggregateCodexEvents([codexLog("PROMPT_SENT", {})], [])[0],
    { externalId: "alice@example.org", name: null },
    day,
  );
  const withCost = codexDailyCountsToStat(
    aggregateCodexEvents(
      [],
      [envelope({ type: "CODEX_TURN", timestamp: "2026-09-15T15:00:00Z", payload: { turn_id: "t", cost_usd: 0.5, token_usage: { uncached_input_tokens: 10, output_tokens: 5 } } })],
    )[0],
    { externalId: "alice@example.org", name: null },
    day,
  );
  assert.equal(mergeAssistantDailyStat(base, base).estimatedCost, null);
  assert.equal(mergeAssistantDailyStat(base, withCost).estimatedCost, 0.5);
  assert.equal(mergeAssistantDailyStat(withCost, withCost).estimatedCost, 1);
  assert.equal(mergeAssistantDailyStat(base, withCost).inputTokens, 10);
});

// ─── Users, roles, GPTs ───────────────────────────────────────────────────

test("normalizeWorkspaceUser lower-cases email, derives a name, converts unix seconds", () => {
  const user = normalizeWorkspaceUser({ id: "u1", email: "Bob@Example.org", created_at: 1757900000, role: "standard-user", status: "active" });
  assert.deepEqual(user, {
    externalId: "u1",
    email: "bob@example.org",
    name: "bob",
    role: "standard-user",
    status: "active",
    createdAt: new Date(1757900000 * 1000),
  });
  assert.equal(normalizeWorkspaceUser({ email: "x@y.z" }), null);
});

test("detectAdminRoleGrants reports only transitions from a known non-admin role", () => {
  const previous = new Map<string, string | null>([
    ["u1", "standard-user"],
    ["u2", "account-admin"],
    ["u3", null],
  ]);
  const grants = detectAdminRoleGrants(previous, [
    { id: "u1", email: "A@x.org", role: "account-admin" },
    { id: "u2", email: "b@x.org", role: "account-owner" }, // already admin
    { id: "u3", email: "c@x.org", role: "account-owner" }, // unknown previous role → grant
    { id: "u4", email: "d@x.org", role: "account-admin" }, // never seen → baseline, no alert
    { id: "u5", email: "e@x.org", role: "standard-user" },
  ]);
  assert.deepEqual(grants, [
    { userId: "u1", email: "a@x.org", previousRole: "standard-user", newRole: "account-admin" },
    { userId: "u3", email: "c@x.org", previousRole: null, newRole: "account-owner" },
  ]);
});

test("detectAdminRoleAuditGrants finds admin role grants in the audit feed", () => {
  const grants = detectAdminRoleAuditGrants([
    envelope({ type: "AUDIT_LOG", action: "USER_ROLE_UPDATED", action_result: "SUCCESS", action_data: { user_id: "u9", role: "account-admin" } }),
    envelope({ type: "AUDIT_LOG", action: "USER_ROLE_UPDATED", action_result: "BLOCKED", action_data: { user_id: "u8", role: "account-admin" } }),
    envelope({ type: "AUDIT_LOG", action: "USER_ROLE_UPDATED", action_result: "SUCCESS", action_data: { user_id: "u7", seat_type: "usage_based" } }),
    envelope({ type: "AUDIT_LOG", action: "INVITE_USERS", action_result: "SUCCESS", action_data: { email_addresses: ["New@x.org"], role: "account-owner" } }),
    envelope({ type: "AUDIT_LOG", action: "INVITE_USERS", action_result: "SUCCESS", action_data: { email_addresses: ["std@x.org"], role: "standard-user" } }),
    envelope({ type: "AUDIT_LOG", action: "GROUP_CREATE", action_data: { role: "account-admin" } }),
  ]);
  assert.equal(grants.length, 2);
  assert.equal(grants[0].action, "USER_ROLE_UPDATED");
  assert.equal(grants[0].targetUserId, "u9");
  assert.equal(grants[0].actorEmail, "alice@example.org");
  assert.equal(grants[1].action, "INVITE_USERS");
  assert.deepEqual(grants[1].targetEmails, ["new@x.org"]);
  assert.equal(grants[1].role, "account-owner");
});

function gpt(id: string, createdAt: number, tools: Record<string, unknown>[], configCreatedAt?: number): ChatGPTWorkspaceGpt {
  return {
    id,
    created_at: createdAt,
    owner_email: "Owner@x.org",
    sharing: { visibility: "workspace" },
    latest_config: { data: [{ id: `${id}-cfg`, name: `GPT ${id}`, created_at: configCreatedAt ?? createdAt, tools: { data: tools } }] },
  };
}

test("detectGptsWithActions reports new GPTs with custom actions and nothing on the baseline run", () => {
  const since = new Date("2026-09-10T00:00:00Z");
  const before = Math.floor(since.getTime() / 1000) - 3600;
  const after = Math.floor(since.getTime() / 1000) + 3600;
  const gpts = [
    gpt("g-old", before, [{ type: "custom_action", action_domain: "API.Vendor.com", auth_type: "oauth" }]),
    gpt("g-new", after, [{ type: "browser" }, { type: "custom_action", action_domain: "hooks.example.com", auth_type: "service_http" }]),
    gpt("g-new-plain", after, [{ type: "code_interpreter" }]),
    // Old GPT whose latest config (with an action) was created after the watermark.
    gpt("g-updated", before, [{ type: "custom_action", action_domain: "x.io" }], after + 60),
  ];
  const hits = detectGptsWithActions(gpts, since);
  assert.deepEqual(hits.map((h) => h.gptId), ["g-new", "g-updated"]);
  assert.deepEqual(hits[0].actionDomains, ["hooks.example.com"]);
  assert.deepEqual(hits[0].authTypes, ["service_http"]);
  assert.equal(hits[0].ownerEmail, "owner@x.org");
  assert.equal(hits[0].visibility, "workspace");
  assert.equal(hits[0].name, "GPT g-new");
  assert.deepEqual(detectGptsWithActions(gpts, null), []);
  assert.equal(latestGptCreatedAt(gpts)?.getTime(), (after + 60) * 1000);
  assert.equal(latestGptCreatedAt([]), null);
});

test("detectNewWorkspaceUsers returns users created after the watermark only", () => {
  const since = new Date("2026-09-10T00:00:00Z");
  const s = Math.floor(since.getTime() / 1000);
  const users = detectNewWorkspaceUsers(
    [
      { id: "u1", email: "old@x.org", created_at: s - 10 },
      { id: "u2", email: "new@x.org", created_at: s + 10 },
      { id: "u3", email: "nodate@x.org" },
    ],
    since,
  );
  assert.deepEqual(users.map((u) => u.externalId), ["u2"]);
  assert.deepEqual(detectNewWorkspaceUsers([{ id: "u2", created_at: s + 10 }], null), []);
});
