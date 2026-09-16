import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dayStart,
  enterpriseUserToDailyStats,
  mergeEnterpriseDailyStats,
  normalizeEnterpriseProduct,
  parseEnterpriseCostRow,
  parseEnterpriseSummary,
  parseEnterpriseUsageRow,
  planEnterpriseDays,
  sumNumeric,
} from "./claude-enterprise-analytics";

const DAY = new Date("2026-09-15T00:00:00.000Z");

describe("enterpriseUserToDailyStats", () => {
  it("emits one row per product with activity and skips empty products", () => {
    const rows = enterpriseUserToDailyStats(
      {
        email: "Ada@Example.com",
        name: "Ada Lovelace",
        user_id: "u1",
        last_activity_date: "2026-09-15",
        web_search_count: 4,
        chat_metrics: { messages: 12, conversations: 3 },
        claude_code_metrics: {
          sessions: 2,
          lines_of_code: { added: 120, removed: 30 },
          commits: 1,
          pull_requests: 0,
          tool_actions: { Edit: { accepted: 5, rejected: 1 } },
        },
        cowork_metrics: { sessions: 0, tasks: 0 },
        design_metrics: {},
      },
      DAY,
    );
    assert.deepEqual(rows.map((r) => r.product), ["chat", "claude_code"]);
    const chat = rows[0];
    assert.equal(chat.provider, "claude_enterprise");
    assert.equal(chat.actorExternalId, "ada@example.com");
    assert.equal(chat.actorName, "Ada Lovelace");
    assert.equal(chat.requests, 12);
    assert.equal(chat.sessions, 3);
    assert.equal(chat.isActive, true);
    assert.equal(chat.estimatedCost, null);
    assert.equal(chat.inputTokens, null);
    assert.equal(chat.metadata.web_search_count, 4);
    const code = rows[1];
    assert.equal(code.sessions, 2);
    assert.equal(code.linesAdded, 120);
    assert.equal(code.linesRemoved, 30);
    assert.equal(code.commits, 1);
    assert.equal(code.pullRequests, 0);
    assert.equal(code.toolAccepted, 5);
    assert.equal(code.toolRejected, 1);
  });

  it("falls back to user:<id> when no email is reported and drops rows with neither", () => {
    const rows = enterpriseUserToDailyStats({ user_id: "u9", chat_metrics: { messages: 1 } }, DAY);
    assert.equal(rows[0].actorExternalId, "user:u9");
    assert.equal(enterpriseUserToDailyStats({ chat_metrics: { messages: 1 } }, DAY).length, 0);
  });

  it("sumNumeric counts every finite number in a nested metrics object", () => {
    assert.equal(sumNumeric({ a: 1, b: { c: 2, d: [3, "x", null] }, e: "7" }), 6);
    assert.equal(sumNumeric({}), 0);
  });
});

describe("summaries and reports", () => {
  it("parses a daily summary with tolerant field names", () => {
    const s = parseEnterpriseSummary({ date: "2026-09-15", daily_active_users: 40, weekly_active_users: 90, monthly_active_users: 120, seats: 150, pending_invites: 3 });
    assert.deepEqual({ ...s, raw: undefined }, { date: "2026-09-15", dau: 40, wau: 90, mau: 120, seats: 150, pendingInvites: 3, raw: undefined });
    const alt = parseEnterpriseSummary({ starting_date: "2026-09-14T00:00:00Z", active_users: { daily: 1, weekly: 2, monthly: 3 }, seats: { total: 10, pending_invites: 1 } });
    assert.equal(alt?.date, "2026-09-14");
    assert.equal(alt?.dau, 1);
    assert.equal(alt?.seats, 10);
    assert.equal(alt?.pendingInvites, 1);
    assert.equal(parseEnterpriseSummary({ dau: 1 }), null);
  });

  it("parses usage rows (tokens incl. cache) and cost rows (fractional cents → USD)", () => {
    const u = parseEnterpriseUsageRow({
      starting_at: "2026-09-15T00:00:00Z",
      ending_at: "2026-09-16T00:00:00Z",
      actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
      product: "Claude Code",
      model: "claude-sonnet-4-5",
      uncached_input_tokens: 1000,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 200,
      output_tokens: 300,
    });
    assert.ok(u);
    assert.equal(u.day.toISOString(), "2026-09-15T00:00:00.000Z");
    assert.equal(u.actorExternalId, "ada@example.com");
    assert.equal(u.product, "claude_code");
    assert.equal(u.model, "claude-sonnet-4-5");
    assert.deepEqual([u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheCreationTokens], [1000, 300, 500, 200]);

    const c = parseEnterpriseCostRow({ starting_at: "2026-09-15", actor: { email: "ada@example.com" }, product: "chat", amount: 1234.5, currency: "USD" });
    assert.ok(c);
    assert.equal(c.amountUsd, 12.345);
    assert.equal(c.currency, "usd");
    assert.equal(parseEnterpriseCostRow({ starting_at: "2026-09-15", amount: 5 }), null);
  });

  it("normalizes product names onto the closed set", () => {
    for (const [input, expected] of [
      ["claude.ai", "chat"],
      ["Claude", "chat"],
      ["Claude Code", "claude_code"],
      ["cowork", "cowork"],
      ["Office add-ins", "office"],
      ["design", "design"],
      ["something_else", "something_else"],
      [undefined, "chat"],
    ] as const) {
      assert.equal(normalizeEnterpriseProduct(input), expected);
    }
  });

  it("dayStart accepts YYYY-MM-DD and ISO timestamps", () => {
    assert.equal(dayStart("2026-09-15")?.toISOString(), "2026-09-15T00:00:00.000Z");
    assert.equal(dayStart("2026-09-15T17:45:00Z")?.toISOString(), "2026-09-15T00:00:00.000Z");
    assert.equal(dayStart("nope"), null);
  });
});

describe("mergeEnterpriseDailyStats", () => {
  it("fills tokens and cost per (day, person, product), summing across models, and creates report-only rows", () => {
    const stats = enterpriseUserToDailyStats({ email: "ada@example.com", chat_metrics: { messages: 5 } }, DAY);
    const usage = [
      parseEnterpriseUsageRow({ starting_at: "2026-09-15", actor: { email: "ada@example.com" }, product: "chat", model: "m1", uncached_input_tokens: 100, output_tokens: 10 })!,
      parseEnterpriseUsageRow({ starting_at: "2026-09-15", actor: { email: "ada@example.com" }, product: "chat", model: "m2", uncached_input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 7 })!,
      parseEnterpriseUsageRow({ starting_at: "2026-09-15", actor: { email: "bob@example.com", name: "Bob" }, product: "design", uncached_input_tokens: 1, output_tokens: 1 })!,
    ];
    const cost = [
      parseEnterpriseCostRow({ starting_at: "2026-09-15", actor: { email: "ada@example.com" }, product: "chat", model: "m1", amount: 100 })!,
      parseEnterpriseCostRow({ starting_at: "2026-09-15", actor: { email: "ada@example.com" }, product: "chat", model: "m2", amount: 50 })!,
    ];
    const merged = mergeEnterpriseDailyStats(stats, usage, cost).sort((a, b) => a.actorExternalId.localeCompare(b.actorExternalId));
    assert.equal(merged.length, 2);
    const ada = merged[0];
    assert.equal(ada.requests, 5); // activity endpoint value survives
    assert.equal(ada.inputTokens, 150);
    assert.equal(ada.outputTokens, 15);
    assert.equal(ada.cacheReadTokens, 7);
    assert.equal(ada.estimatedCost, 1.5);
    assert.deepEqual(ada.metadata.models, { m1: 110, m2: 55 });
    const bob = merged[1];
    assert.equal(bob.product, "design");
    assert.equal(bob.actorName, "Bob");
    assert.equal(bob.metadata.from_reports_only, true);
    assert.equal(bob.estimatedCost, null);
  });

  it("leaves activity-endpoint tokens alone when the usage report has nothing for that row", () => {
    const stats = enterpriseUserToDailyStats({ email: "ada@example.com", chat_metrics: { messages: 5, tokens: { input: 9, output: 1 } } }, DAY);
    const merged = mergeEnterpriseDailyStats(stats, [], []);
    assert.equal(merged[0].inputTokens, 9);
    assert.equal(merged[0].outputTokens, 1);
  });
});

describe("planEnterpriseDays", () => {
  const NOW = new Date("2026-09-16T15:00:00Z");
  it("first run pulls the default lookback up to yesterday", () => {
    const days = planEnterpriseDays({ watermark: null, now: NOW, lookbackDays: 7 });
    assert.deepEqual(days, ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15"]);
  });
  it("later runs re-pull the overlap behind the watermark", () => {
    const days = planEnterpriseDays({ watermark: new Date("2026-09-14T00:00:00Z"), now: NOW, overlapDays: 3 });
    assert.deepEqual(days, ["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15"]);
  });
  it("caps a long gap oldest-first so it drains over several runs", () => {
    const days = planEnterpriseDays({ watermark: new Date("2026-07-01T00:00:00Z"), now: NOW, overlapDays: 0, maxDays: 14 });
    assert.equal(days.length, 14);
    assert.equal(days[0], "2026-07-01");
    assert.equal(days[13], "2026-07-14");
  });
  it("returns nothing when the watermark is already at yesterday and there is no overlap", () => {
    assert.deepEqual(planEnterpriseDays({ watermark: new Date("2026-09-16T00:00:00Z"), now: NOW, overlapDays: 0 }), []);
  });
});
