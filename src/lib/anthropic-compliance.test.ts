import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  advanceComplianceWatermark,
  buildComplianceFeedQuery,
  classifyComplianceActivity,
  deriveCountry,
  evaluateComplianceAlerts,
  extractCreatedApiKey,
  isOutsideBusinessHours,
  localHour,
  normalizeComplianceActivity,
  normalizeComplianceSession,
  parseComplianceActor,
  parseComplianceFeedPage,
  parseComplianceSessionsPage,
  planComplianceFeedPull,
  type NormalizedComplianceActivity,
} from "./anthropic-compliance";

const NOW = new Date("2026-09-16T15:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

function activity(overrides: Partial<NormalizedComplianceActivity> & { id: string; type: string }): NormalizedComplianceActivity {
  return {
    occurredAt: hoursAgo(1),
    organizationId: "org_1",
    actorType: "user_actor",
    actorEmail: "ada@example.com",
    actorUserId: "user_1",
    actorApiKeyId: null,
    ipAddress: "203.0.113.5",
    ipCountry: null,
    userAgent: null,
    payload: {},
    ...overrides,
  };
}

describe("parseComplianceActor / normalizeComplianceActivity", () => {
  it("reads every actor variant and lower-cases the email", () => {
    const user = parseComplianceActor({ type: "user_actor", email_address: "Ada@Example.com", user_id: "u1", ip_address: "1.2.3.4", user_agent: "Mozilla" });
    assert.equal(user.type, "user_actor");
    assert.equal(user.email, "ada@example.com");
    assert.equal(user.userId, "u1");
    assert.equal(user.ipAddress, "1.2.3.4");
    assert.equal(user.userAgent, "Mozilla");

    const api = parseComplianceActor({ type: "api_actor", api_key_id: "apikey_01", ip_address: "5.6.7.8" });
    assert.equal(api.apiKeyId, "apikey_01");
    assert.equal(api.email, null);

    assert.equal(parseComplianceActor(null).type, "unknown");
    assert.equal(parseComplianceActor({ type: "scim_directory_sync_actor" }).type, "scim_directory_sync_actor");
  });

  it("maps a feed item to the ComplianceActivity columns and keeps the payload", () => {
    const row = normalizeComplianceActivity({
      id: "act_1",
      type: "activity",
      activity_type: "api_key_created",
      created_at: "2026-09-16T03:12:00Z",
      organization_id: "org_1",
      actor: { type: "user_actor", email_address: "ada@example.com", user_id: "u1", ip_address: "1.2.3.4", country_code: "gb" },
      api_key: { id: "apikey_9", name: "ci-runner" },
    });
    assert.ok(row);
    assert.equal(row.id, "act_1");
    assert.equal(row.type, "api_key_created");
    assert.equal(row.occurredAt.toISOString(), "2026-09-16T03:12:00.000Z");
    assert.equal(row.actorEmail, "ada@example.com");
    assert.equal(row.ipCountry, "GB");
    assert.equal(row.payload.organization_id, "org_1");
    assert.deepEqual(extractCreatedApiKey(row.payload), { id: "apikey_9", name: "ci-runner" });
  });

  it("uses `type` when no specific field exists, and rejects items without id or timestamp", () => {
    const row = normalizeComplianceActivity({ id: "a", type: "user_logged_in", created_at: 1789000000 });
    assert.equal(row?.type, "user_logged_in");
    assert.equal(row?.occurredAt.getTime(), 1789000000 * 1000);
    assert.equal(normalizeComplianceActivity({ type: "x", created_at: "2026-01-01T00:00:00Z" }), null);
    assert.equal(normalizeComplianceActivity({ id: "a", type: "x" }), null);
    assert.equal(normalizeComplianceActivity("nope"), null);
  });

  it("derives a country only when the upstream record carries one", () => {
    assert.equal(deriveCountry({ ip_country: "US" }), "US");
    assert.equal(deriveCountry({ location: { country: "de" } }), "DE");
    assert.equal(deriveCountry({ geo: { country_code: "Germany" } }), "Germany");
    assert.equal(deriveCountry({ ip_address: "1.2.3.4" }), null);
    assert.equal(deriveCountry(null, undefined, 42), null);
  });
});

describe("classifyComplianceActivity", () => {
  it("buckets upstream type names into governance classes", () => {
    assert.equal(classifyComplianceActivity("api_key_created"), "api_key_created");
    assert.equal(classifyComplianceActivity("admin_api_key.generated"), "api_key_created");
    assert.equal(classifyComplianceActivity("api_key_deleted"), "api_key_lifecycle");
    assert.equal(classifyComplianceActivity("compliance_api_accessed"), "compliance_api_accessed");
    assert.equal(classifyComplianceActivity("compliance.activities.read"), "compliance_api_accessed");
    assert.equal(classifyComplianceActivity("user_logged_in"), "login");
    assert.equal(classifyComplianceActivity("login_succeeded"), "login");
    assert.equal(classifyComplianceActivity("member_invited"), "other");
  });
});

describe("feed pages and query", () => {
  it("parses data / has_more / first_id / last_id, falling back to item ids", () => {
    const page = parseComplianceFeedPage({ data: [{ id: "n" }, { id: "m" }], has_more: true, last_id: "m" });
    assert.equal(page.items.length, 2);
    assert.equal(page.hasMore, true);
    assert.equal(page.firstId, "n");
    assert.equal(page.lastId, "m");
    const empty = parseComplianceFeedPage({});
    assert.deepEqual(empty, { items: [], hasMore: false, firstId: null, lastId: null });
  });

  it("builds the documented query parameters", () => {
    const qs = buildComplianceFeedQuery({
      afterId: "act_9",
      createdAtGte: new Date("2026-09-01T00:00:00Z"),
      createdAtLt: new Date("2026-09-02T00:00:00Z"),
      limit: 9000,
      activityTypes: ["api_key_created", "user_logged_in"],
    });
    const q = new URLSearchParams(qs);
    assert.equal(q.get("limit"), "5000"); // clamped to the documented maximum
    assert.equal(q.get("after_id"), "act_9");
    assert.equal(q.get("created_at.gte"), "2026-09-01T00:00:00.000Z");
    assert.equal(q.get("created_at.lt"), "2026-09-02T00:00:00.000Z");
    assert.deepEqual(q.getAll("activity_types[]"), ["api_key_created", "user_logged_in"]);
  });
});

describe("planComplianceFeedPull / advanceComplianceWatermark", () => {
  it("first run reaches back the lookback window and learns a baseline", () => {
    const plan = planComplianceFeedPull({ state: null, now: NOW, lookbackDays: 30 });
    assert.equal(plan.firstRun, true);
    assert.equal(plan.incrementalSince.toISOString(), "2026-08-17T15:00:00.000Z");
    assert.equal(plan.backfill, null);
  });

  it("subsequent runs start an overlap before the watermark and resume a truncated backfill", () => {
    const state = { watermark: hoursAgo(12), earliest: hoursAgo(300), cursor: "act_old" };
    const plan = planComplianceFeedPull({ state, now: NOW, lookbackDays: 30, overlapMs: 6 * 60 * 60 * 1000 });
    assert.equal(plan.firstRun, false);
    assert.equal(plan.incrementalSince.getTime(), hoursAgo(18).getTime());
    assert.deepEqual(plan.backfill, { afterId: "act_old", since: new Date("2026-08-17T15:00:00.000Z") });
  });

  it("never starts before the lookback floor even with a stale watermark", () => {
    const state = { watermark: new Date("2026-01-01T00:00:00Z"), earliest: new Date("2025-12-01T00:00:00Z"), cursor: null };
    const plan = planComplianceFeedPull({ state, now: NOW, lookbackDays: 30 });
    assert.equal(plan.incrementalSince.toISOString(), "2026-08-17T15:00:00.000Z");
  });

  it("the watermark only moves forward, earliest only back, cursor follows the backfill", () => {
    const prev = { watermark: hoursAgo(10), earliest: hoursAgo(100), cursor: "c1" };
    const next = advanceComplianceWatermark(prev, [{ occurredAt: hoursAgo(50) }, { occurredAt: hoursAgo(2) }, { occurredAt: hoursAgo(200) }], null);
    assert.ok(next);
    assert.equal(next.watermark.getTime(), hoursAgo(2).getTime());
    assert.equal(next.earliest.getTime(), hoursAgo(200).getTime());
    assert.equal(next.cursor, null);

    const unchanged = advanceComplianceWatermark(prev, [], "c2");
    assert.equal(unchanged?.watermark.getTime(), prev.watermark.getTime());
    assert.equal(unchanged?.cursor, "c2");
    assert.equal(advanceComplianceWatermark(null, [], null), null);
  });
});

describe("business hours", () => {
  it("computes the local hour in an IANA zone and falls back to UTC on a bad zone", () => {
    const t = new Date("2026-09-16T03:30:00Z");
    assert.equal(localHour(t, "UTC"), 3);
    assert.equal(localHour(t, "America/New_York"), 23); // previous evening, EDT
    assert.equal(localHour(t, "Asia/Kolkata"), 9);
    assert.equal(localHour(t, "Not/AZone"), 3);
  });

  it("07:00–19:00 org-local is business hours", () => {
    assert.equal(isOutsideBusinessHours(new Date("2026-09-16T12:00:00Z"), "UTC"), false);
    assert.equal(isOutsideBusinessHours(new Date("2026-09-16T06:59:00Z"), "UTC"), true);
    assert.equal(isOutsideBusinessHours(new Date("2026-09-16T19:00:00Z"), "UTC"), true);
    // 12:00Z is 08:00 in New York → inside; 23:00Z is 19:00 → outside.
    assert.equal(isOutsideBusinessHours(new Date("2026-09-16T12:00:00Z"), "America/New_York"), false);
    assert.equal(isOutsideBusinessHours(new Date("2026-09-16T23:00:00Z"), "America/New_York"), true);
  });
});

describe("evaluateComplianceAlerts", () => {
  const baseCtx = () => ({
    knownActorEmails: new Set(["ada@example.com"]),
    knownComplianceKeyIds: new Set(["apikey_known"]),
    knownLoginCountries: new Map([["ada@example.com", new Set(["GB"])]]),
    timeZone: "UTC",
    firstRun: false,
    now: NOW,
  });

  it("flags an API key created by an unknown actor and one created off-hours", () => {
    const alerts = evaluateComplianceAlerts(
      [
        activity({ id: "a1", type: "api_key_created", actorEmail: "stranger@example.com", occurredAt: new Date("2026-09-16T12:00:00Z"), payload: { api_key: { id: "k1", name: "new-key" } } }),
        activity({ id: "a2", type: "api_key_created", actorEmail: "ada@example.com", occurredAt: new Date("2026-09-16T02:00:00Z"), payload: { api_key_id: "k2" } }),
        activity({ id: "a3", type: "api_key_created", actorEmail: "ada@example.com", occurredAt: new Date("2026-09-16T12:00:00Z") }),
      ],
      baseCtx(),
    );
    // Evaluated oldest-first: a2 (02:00) is off-hours, a1 (12:00) is an unknown actor.
    assert.deepEqual(
      alerts.map((a) => [a.rule, a.activityId]),
      [
        ["api_key_created_off_hours", "a2"],
        ["api_key_created_unknown_actor", "a1"],
      ],
    );
    const unknown = alerts.find((a) => a.rule === "api_key_created_unknown_actor");
    assert.equal(unknown?.severity, "HIGH");
    assert.match(unknown?.description ?? "", /new-key/);
    assert.match(unknown?.description ?? "", /Activity a1/);
    const offHours = alerts.find((a) => a.rule === "api_key_created_off_hours");
    assert.equal(offHours?.severity, "MEDIUM");
    assert.match(offHours?.description ?? "", /07:00–19:00 UTC/);
  });

  it("uses the org timezone for the business-hours check", () => {
    const ctx = { ...baseCtx(), timeZone: "America/Los_Angeles" };
    // 16:00Z is 09:00 in Los Angeles → inside hours, no alert.
    const inside = evaluateComplianceAlerts([activity({ id: "a", type: "api_key_created", occurredAt: new Date("2026-09-16T16:00:00Z") })], ctx);
    assert.equal(inside.length, 0);
    // 04:00Z is 21:00 the previous evening in Los Angeles → outside.
    const outside = evaluateComplianceAlerts([activity({ id: "b", type: "api_key_created", occurredAt: new Date("2026-09-16T04:00:00Z") })], ctx);
    assert.equal(outside.length, 1);
    assert.match(outside[0].description, /America\/Los_Angeles/);
  });

  it("flags Compliance API access from a key never seen before, once per key", () => {
    const alerts = evaluateComplianceAlerts(
      [
        activity({ id: "c1", type: "compliance_api_accessed", actorType: "api_actor", actorEmail: null, actorApiKeyId: "apikey_known" }),
        activity({ id: "c2", type: "compliance_api_accessed", actorType: "api_actor", actorEmail: null, actorApiKeyId: "apikey_new", occurredAt: hoursAgo(3) }),
        activity({ id: "c3", type: "compliance_api_accessed", actorType: "api_actor", actorEmail: null, actorApiKeyId: "apikey_new", occurredAt: hoursAgo(2) }),
      ],
      baseCtx(),
    );
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].rule, "compliance_api_unknown_key");
    assert.equal(alerts[0].activityId, "c2");
    assert.equal(alerts[0].severity, "HIGH");
  });

  it("flags a login from a new country, but not the first country ever seen or a repeat", () => {
    const alerts = evaluateComplianceAlerts(
      [
        activity({ id: "l1", type: "user_logged_in", ipCountry: "GB" }),
        activity({ id: "l2", type: "user_logged_in", ipCountry: "BR", occurredAt: hoursAgo(2) }),
        activity({ id: "l3", type: "user_logged_in", ipCountry: "BR", occurredAt: hoursAgo(1) }),
        activity({ id: "l4", type: "user_logged_in", actorEmail: "newbie@example.com", ipCountry: "FR" }),
        activity({ id: "l5", type: "user_logged_in", ipCountry: null }),
      ],
      baseCtx(),
    );
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].rule, "login_new_country");
    assert.equal(alerts[0].activityId, "l2");
    assert.match(alerts[0].description, /previous logins came from GB/);
  });

  it("on the first run only recent off-hours key creations alert; baseline rules stay quiet", () => {
    const ctx = { ...baseCtx(), firstRun: true, knownActorEmails: new Set<string>(), knownComplianceKeyIds: new Set<string>(), knownLoginCountries: new Map<string, Set<string>>() };
    const alerts = evaluateComplianceAlerts(
      [
        activity({ id: "f1", type: "api_key_created", actorEmail: "stranger@example.com", occurredAt: new Date("2026-09-16T02:00:00Z") }),
        activity({ id: "f2", type: "api_key_created", actorEmail: "stranger@example.com", occurredAt: new Date("2026-09-01T02:00:00Z") }),
        activity({ id: "f3", type: "compliance_api_accessed", actorType: "api_actor", actorApiKeyId: "k" }),
        activity({ id: "f4", type: "user_logged_in", ipCountry: "US" }),
      ],
      ctx,
    );
    assert.deepEqual(alerts.map((a) => [a.rule, a.activityId]), [["api_key_created_off_hours", "f1"]]);
  });
});

describe("sessions", () => {
  it("keeps metadata only and drops anything content-shaped", () => {
    const s = normalizeComplianceSession(
      {
        id: "sess_1",
        product_surface: "claude_code",
        user: { email_address: "Ada@Example.com", user_id: "u1" },
        workspace_id: "ws_1",
        created_at: "2026-09-16T10:00:00Z",
        updated_at: "2026-09-16T11:00:00Z",
        messages: [{ role: "user", content: "secret" }],
        transcript: "…",
      },
      "local",
    );
    assert.ok(s);
    assert.equal(s.userEmail, "ada@example.com");
    assert.equal(s.productSurface, "claude_code");
    assert.equal(s.workspaceId, "ws_1");
    assert.equal(s.sessionKind, "local");
    assert.equal(s.startedAt?.toISOString(), "2026-09-16T10:00:00.000Z");
    assert.equal(s.lastActivityAt?.toISOString(), "2026-09-16T11:00:00.000Z");
    assert.equal("messages" in s.raw, false);
    assert.equal("transcript" in s.raw, false);
    assert.equal(normalizeComplianceSession({ product_surface: "x" }, "remote"), null);
  });

  it("parses page / next_page", () => {
    assert.deepEqual(parseComplianceSessionsPage({ data: [{ id: "a" }], next_page: "p2", has_more: true }), { items: [{ id: "a" }], nextPage: "p2" });
    assert.deepEqual(parseComplianceSessionsPage({ data: [], next_page: "p2", has_more: false }), { items: [], nextPage: null });
  });
});
