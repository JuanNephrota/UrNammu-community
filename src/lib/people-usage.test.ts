import test from "node:test";
import assert from "node:assert/strict";
import {
  mergePeopleUsage,
  normalizeEmail,
  parsePeopleUsageRange,
  resolvePeopleUsageWindow,
  rollupAssistantDailyStats,
  summarizePeopleUsage,
  type AssistantDailyStatRow,
  type PeopleUsageInputs,
} from "./people-usage";

const empty = (): PeopleUsageInputs => ({
  otel: [],
  claudeCodeAdmin: [],
  cursor: [],
  proxy: [],
  identities: [],
});

test("normalizeEmail lower-cases, trims, and rejects non-email actors", () => {
  assert.equal(normalizeEmail("  Ada.Lovelace@Example.com "), "ada.lovelace@example.com");
  assert.equal(normalizeEmail("user:123"), null);
  assert.equal(normalizeEmail("prod-api-key"), null);
  assert.equal(normalizeEmail("@nobody"), null);
  assert.equal(normalizeEmail("nobody@"), null);
  assert.equal(normalizeEmail(null), null);
});

test("range parsing falls back to 30d and resolves a window", () => {
  assert.equal(parsePeopleUsageRange("7d"), "7d");
  assert.equal(parsePeopleUsageRange("garbage"), "30d");
  assert.equal(parsePeopleUsageRange(undefined), "30d");
  const now = new Date("2026-09-15T12:00:00Z");
  const w = resolvePeopleUsageWindow("7d", now);
  assert.equal(w.until.toISOString(), now.toISOString());
  assert.equal(w.since.toISOString(), "2026-09-08T12:00:00.000Z");
});

test("merges the same person across surfaces regardless of email casing", () => {
  const inputs = empty();
  inputs.otel.push({
    email: "Ada@Example.com",
    surface: "claude_code",
    sessions: 3,
    commits: 2,
    linesAdded: 120,
    tokens: 10_000,
    cost: 4.5,
    lastActiveAt: new Date("2026-09-14T10:00:00Z"),
  });
  inputs.otel.push({
    email: "ada@example.com",
    surface: "cowork",
    sessions: 1,
    commits: 0,
    linesAdded: 0,
    tokens: 2_000,
    cost: 1.25,
    lastActiveAt: new Date("2026-09-15T09:00:00Z"),
  });
  inputs.cursor.push({
    email: "ADA@example.com",
    requests: 40,
    tokens: 5_000,
    linesAccepted: 300,
    activeDays: 4,
    cost: 2.0,
    lastActiveAt: new Date("2026-09-13T00:00:00Z"),
  });
  inputs.proxy.push({
    email: "ada@example.com",
    requests: 12,
    tokens: 800,
    cost: 0.3,
    flagged: 1,
    lastActiveAt: new Date("2026-09-12T00:00:00Z"),
  });
  inputs.identities.push({ email: "ada@example.com", name: "Ada Lovelace", department: "Engineering" });

  const { rows, unattributed } = mergePeopleUsage(inputs);
  assert.equal(rows.length, 1);
  const ada = rows[0];
  assert.equal(ada.email, "ada@example.com");
  assert.equal(ada.name, "Ada Lovelace");
  assert.equal(ada.department, "Engineering");
  assert.equal(ada.claudeCodeSource, "otel");
  assert.equal(ada.claudeCodeCost, 4.5);
  assert.equal(ada.coworkCost, 1.25);
  assert.equal(ada.cursorCost, 2);
  assert.equal(ada.proxyCost, 0.3);
  assert.equal(ada.proxyFlagged, 1);
  assert.equal(ada.totalCost, 8.05);
  assert.equal(ada.totalTokens, 17_800);
  assert.deepEqual(ada.surfaces, ["claude_code", "cowork", "cursor", "proxy"]);
  assert.equal(ada.lastActiveAt?.toISOString(), "2026-09-15T09:00:00.000Z");
  assert.equal(unattributed.cost, 0);
});

test("admin analytics only fill in Claude Code when OTel has nothing for that person", () => {
  const inputs = empty();
  inputs.otel.push({
    email: "instrumented@example.com",
    surface: "claude_code",
    sessions: 5,
    commits: 1,
    linesAdded: 50,
    tokens: 1_000,
    cost: 3,
    lastActiveAt: null,
  });
  inputs.claudeCodeAdmin.push({
    email: "instrumented@example.com",
    sessions: 5,
    linesAdded: 50,
    commits: 1,
    tokens: 1_000,
    cost: 3.2, // would double count if merged
    lastActiveAt: null,
  });
  inputs.claudeCodeAdmin.push({
    email: "uninstrumented@example.com",
    sessions: 2,
    linesAdded: 10,
    commits: 0,
    tokens: 400,
    cost: 0.9,
    lastActiveAt: new Date("2026-09-10T00:00:00Z"),
  });

  const { rows } = mergePeopleUsage(inputs);
  const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]));
  assert.equal(byEmail["instrumented@example.com"].claudeCodeSource, "otel");
  assert.equal(byEmail["instrumented@example.com"].claudeCodeCost, 3);
  assert.equal(byEmail["uninstrumented@example.com"].claudeCodeSource, "admin_api");
  assert.equal(byEmail["uninstrumented@example.com"].claudeCodeCost, 0.9);
  assert.equal(byEmail["uninstrumented@example.com"].claudeCodeSessions, 2);
});

test("cost without a person lands in unattributed, per surface", () => {
  const inputs = empty();
  inputs.otel.push({
    email: null,
    surface: "claude_code",
    sessions: 1,
    commits: 0,
    linesAdded: 0,
    tokens: 500,
    cost: 1.1,
    lastActiveAt: null,
  });
  inputs.cursor.push({
    email: "user:42",
    requests: 3,
    tokens: 100,
    linesAccepted: 0,
    activeDays: 1,
    cost: 0.4,
    lastActiveAt: null,
  });
  inputs.proxy.push({ email: null, requests: 9, tokens: 900, cost: 0.5, flagged: 0, lastActiveAt: null });

  const { rows, unattributed } = mergePeopleUsage(inputs);
  assert.equal(rows.length, 0);
  assert.equal(unattributed.cost, 2);
  assert.equal(unattributed.tokens, 1500);
  assert.equal(unattributed.bySurface.claude_code.cost, 1.1);
  assert.equal(unattributed.bySurface.cursor.cost, 0.4);
  assert.equal(unattributed.bySurface.proxy.cost, 0.5);
});

test("cursor cost stays null when no synced day carried per-user spend", () => {
  const inputs = empty();
  inputs.cursor.push({
    email: "dev@example.com",
    requests: 10,
    tokens: 0,
    linesAccepted: 20,
    activeDays: 2,
    cost: null,
    lastActiveAt: null,
  });
  const { rows } = mergePeopleUsage(inputs);
  assert.equal(rows[0].cursorCost, null);
  assert.equal(rows[0].totalCost, 0);
  assert.deepEqual(rows[0].surfaces, ["cursor"]);
});

test("rows sort by total cost and the summary rolls up by surface", () => {
  const inputs = empty();
  inputs.otel.push({ email: "a@x.io", surface: "claude_code", sessions: 1, commits: 0, linesAdded: 0, tokens: 100, cost: 1, lastActiveAt: null });
  inputs.otel.push({ email: "b@x.io", surface: "claude_code", sessions: 1, commits: 0, linesAdded: 0, tokens: 100, cost: 5, lastActiveAt: null });
  inputs.cursor.push({ email: "b@x.io", requests: 1, tokens: 50, linesAccepted: 0, activeDays: 1, cost: 2, lastActiveAt: null });
  inputs.proxy.push({ email: null, requests: 1, tokens: 10, cost: 0.25, flagged: 0, lastActiveAt: null });

  const { rows, unattributed } = mergePeopleUsage(inputs);
  assert.deepEqual(rows.map((r) => r.email), ["b@x.io", "a@x.io"]);

  const summary = summarizePeopleUsage(rows, unattributed);
  assert.equal(summary.people, 2);
  assert.equal(summary.totalCost, 8);
  assert.equal(summary.avgCostPerPerson, 4);
  assert.equal(summary.unattributedCost, 0.25);
  const cc = summary.bySurface.find((s) => s.surface === "claude_code")!;
  assert.equal(cc.people, 2);
  assert.equal(cc.cost, 6);
  const cursor = summary.bySurface.find((s) => s.surface === "cursor")!;
  assert.equal(cursor.people, 1);
  assert.equal(cursor.cost, 2);
});

// ── AssistantDailyStat rollup ─────────────────────────────────────────────

const statRow = (over: Partial<AssistantDailyStatRow> & Pick<AssistantDailyStatRow, "provider" | "actorExternalId" | "day">): AssistantDailyStatRow => ({
  isActive: null,
  sessions: null,
  requests: null,
  linesAdded: null,
  linesAccepted: null,
  commits: null,
  estimatedCost: null,
  inputTokens: null,
  outputTokens: null,
  ...over,
});

test("rollup sums Claude Code admin stats per actor and keeps cache tokens out of the token total", () => {
  const { claudeCodeAdmin, cursor } = rollupAssistantDailyStats([
    statRow({
      provider: "claude_code",
      actorExternalId: "ada@example.com",
      day: new Date("2026-09-10T00:00:00Z"),
      sessions: 3,
      linesAdded: 100,
      commits: 2,
      inputTokens: 1_000,
      outputTokens: 500,
      estimatedCost: 1.25,
    }),
    statRow({
      provider: "claude_code",
      actorExternalId: "ada@example.com",
      day: new Date("2026-09-12T00:00:00Z"),
      sessions: 1,
      linesAdded: 20,
      commits: 0,
      inputTokens: 200,
      outputTokens: 100,
      estimatedCost: 0.5,
    }),
    statRow({
      provider: "claude_code",
      actorExternalId: "ci-key",
      day: new Date("2026-09-11T00:00:00Z"),
      sessions: 9,
      estimatedCost: 4,
    }),
  ]);
  assert.equal(cursor.length, 0);
  assert.equal(claudeCodeAdmin.length, 2);
  const ada = claudeCodeAdmin.find((a) => a.email === "ada@example.com")!;
  assert.equal(ada.sessions, 4);
  assert.equal(ada.linesAdded, 120);
  assert.equal(ada.commits, 2);
  assert.equal(ada.tokens, 1_800);
  assert.equal(ada.cost, 1.75);
  assert.equal(ada.lastActiveAt?.toISOString(), "2026-09-12T00:00:00.000Z");
  // Non-email actors (API keys) are passed through; mergePeopleUsage sends
  // them to unattributed.
  const key = claudeCodeAdmin.find((a) => a.email === "ci-key")!;
  assert.equal(key.sessions, 9);
  const { rows, unattributed } = mergePeopleUsage({ otel: [], claudeCodeAdmin, cursor, proxy: [], identities: [] });
  assert.equal(rows.length, 1);
  assert.equal(unattributed.bySurface.claude_code.cost, 4);
});

test("rollup counts Cursor active days from isActive and only advances last-active on active days", () => {
  const { cursor } = rollupAssistantDailyStats([
    statRow({
      provider: "cursor",
      actorExternalId: "dev@example.com",
      day: new Date("2026-09-08T00:00:00Z"),
      isActive: true,
      requests: 12,
      linesAccepted: 40,
      inputTokens: 300,
      outputTokens: 100,
      estimatedCost: 0.8,
    }),
    statRow({
      provider: "cursor",
      actorExternalId: "dev@example.com",
      day: new Date("2026-09-09T00:00:00Z"),
      isActive: false,
      requests: 0,
      linesAccepted: 0,
      estimatedCost: 0,
    }),
    statRow({
      provider: "cursor",
      actorExternalId: "dev@example.com",
      day: new Date("2026-09-07T00:00:00Z"),
      isActive: null, // provider did not say — counts as active
      requests: 3,
      linesAccepted: 5,
      estimatedCost: 0.2,
    }),
  ]);
  assert.equal(cursor.length, 1);
  const dev = cursor[0];
  assert.equal(dev.requests, 15);
  assert.equal(dev.tokens, 400);
  assert.equal(dev.linesAccepted, 45);
  assert.equal(dev.activeDays, 2);
  assert.equal(dev.cost, 1);
  assert.equal(dev.lastActiveAt?.toISOString(), "2026-09-08T00:00:00.000Z");
});

test("rollup keeps Cursor cost null until a day carried spend, and drops idle seats", () => {
  const { cursor } = rollupAssistantDailyStats([
    statRow({
      provider: "cursor",
      actorExternalId: "quiet@example.com",
      day: new Date("2026-09-08T00:00:00Z"),
      isActive: true,
      requests: 4,
      linesAccepted: 10,
      estimatedCost: null,
    }),
    statRow({
      provider: "cursor",
      actorExternalId: "quiet@example.com",
      day: new Date("2026-09-09T00:00:00Z"),
      isActive: true,
      requests: 2,
      estimatedCost: null,
    }),
    // Every seat appears in Cursor's daily-usage feed every day; an idle
    // member with nothing to report must not become a zero row.
    statRow({
      provider: "cursor",
      actorExternalId: "idle@example.com",
      day: new Date("2026-09-08T00:00:00Z"),
      isActive: false,
      requests: 0,
      linesAccepted: 0,
      estimatedCost: null,
    }),
  ]);
  assert.deepEqual(cursor.map((c) => c.email), ["quiet@example.com"]);
  assert.equal(cursor[0].cost, null);
  assert.equal(cursor[0].activeDays, 2);
  const { rows } = mergePeopleUsage({ otel: [], claudeCodeAdmin: [], cursor, proxy: [], identities: [] });
  assert.equal(rows[0].cursorCost, null);
  assert.deepEqual(rows[0].surfaces, ["cursor"]);
});

test("rollup ignores providers it does not know", () => {
  const out = rollupAssistantDailyStats([
    statRow({ provider: "copilot", actorExternalId: "x@example.com", day: new Date(), sessions: 1 }),
  ]);
  assert.deepEqual(out, { claudeCodeAdmin: [], cursor: [] });
});
