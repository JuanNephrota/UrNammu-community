import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKeyProfileUpdates,
  evaluateKeyUsageRules,
  groupBucketsByKey,
  parseKeyUsageRuleConfig,
  type EvaluableKeyUsageRule,
  type KeyUsageBucketInput,
} from "./key-usage-rules";
import { BUILTIN_KEY_USAGE_RULES } from "./key-usage-defaults";

const NOW = new Date("2026-08-26T12:00:00Z");

function bucket(overrides: Partial<KeyUsageBucketInput> = {}): KeyUsageBucketInput {
  return {
    provider: "anthropic",
    apiKeyExternalId: "apikey_abc",
    apiKeyName: "prod-batch",
    bucketStart: new Date("2026-08-26T00:00:00Z"),
    bucketEnd: new Date("2026-08-27T00:00:00Z"),
    granularity: "day",
    model: "claude-sonnet-4-6",
    projectExternalId: "proj_1",
    projectName: "Billing",
    actorExternalId: "user_1",
    actorName: "Ada",
    totalTokens: 1000,
    requestCount: 10,
    cost: 1,
    ...overrides,
  };
}

function rule(overrides: Partial<EvaluableKeyUsageRule> = {}): EvaluableKeyUsageRule {
  return {
    id: "rule-1",
    key: "test_rule",
    label: "Test rule",
    description: null,
    conditionType: "VOLUME_THRESHOLD",
    severity: "HIGH",
    providers: [],
    apiKeyExternalIds: [],
    config: { conditionType: "VOLUME_THRESHOLD", metric: "cost", windowHours: 24, threshold: 100 },
    enabled: true,
    ...overrides,
  };
}

// ─── Built-in defaults ──────────────────────────────────

test("every built-in rule carries a config that validates and matches its conditionType", () => {
  for (const builtIn of BUILTIN_KEY_USAGE_RULES) {
    const parsed = parseKeyUsageRuleConfig(builtIn.config);
    assert.ok(parsed, `${builtIn.key} config failed validation`);
    assert.equal(parsed.conditionType, builtIn.conditionType, `${builtIn.key} conditionType mismatch`);
  }
});

test("built-in rule keys are unique", () => {
  const keys = BUILTIN_KEY_USAGE_RULES.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
});

// ─── Grouping / scoping ─────────────────────────────────

test("buckets without a key identity are excluded from evaluation", () => {
  const groups = groupBucketsByKey([
    bucket({ apiKeyExternalId: null, apiKeyName: null }),
    bucket({ apiKeyExternalId: "apikey_abc" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].apiKeyExternalId, "apikey_abc");
});

test("a key name is recovered from any bucket that carries one", () => {
  const groups = groupBucketsByKey([
    bucket({ apiKeyName: null }),
    bucket({ apiKeyName: "prod-batch" }),
  ]);
  assert.equal(groups[0].apiKeyName, "prod-batch");
});

test("provider and key scope filters exclude non-matching keys", () => {
  const buckets = [bucket({ totalTokens: 10, cost: 500 })];
  const providerScoped = evaluateKeyUsageRules({
    rules: [rule({ providers: ["openai"] })],
    buckets,
    profiles: [],
    now: NOW,
  });
  assert.equal(providerScoped.length, 0);

  const keyScoped = evaluateKeyUsageRules({
    rules: [rule({ apiKeyExternalIds: ["some_other_key"] })],
    buckets,
    profiles: [],
    now: NOW,
  });
  assert.equal(keyScoped.length, 0);

  const matching = evaluateKeyUsageRules({
    rules: [rule({ providers: ["anthropic"], apiKeyExternalIds: ["apikey_abc"] })],
    buckets,
    profiles: [],
    now: NOW,
  });
  assert.equal(matching.length, 1);
});

test("disabled rules never fire", () => {
  const findings = evaluateKeyUsageRules({
    rules: [rule({ enabled: false })],
    buckets: [bucket({ cost: 5000 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

test("a malformed stored config is skipped instead of throwing", () => {
  const findings = evaluateKeyUsageRules({
    rules: [rule({ config: { conditionType: "VOLUME_THRESHOLD", metric: "bananas" } })],
    buckets: [bucket({ cost: 5000 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

// ─── VOLUME_THRESHOLD ───────────────────────────────────

test("volume threshold fires only above the ceiling", () => {
  const over = evaluateKeyUsageRules({
    rules: [rule()],
    buckets: [bucket({ cost: 101 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(over.length, 1);
  assert.equal(over[0].observed, 101);
  assert.equal(over[0].threshold, 100);

  const under = evaluateKeyUsageRules({
    rules: [rule()],
    buckets: [bucket({ cost: 100 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(under.length, 0);
});

test("volume threshold ignores buckets outside the window", () => {
  const findings = evaluateKeyUsageRules({
    rules: [rule()],
    buckets: [bucket({ cost: 5000, bucketStart: new Date("2026-08-01T00:00:00Z") })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

// ─── SPIKE_MULTIPLIER ───────────────────────────────────

const spikeRule = rule({
  key: "spike",
  conditionType: "SPIKE_MULTIPLIER",
  config: {
    conditionType: "SPIKE_MULTIPLIER",
    metric: "cost",
    windowHours: 168,
    baselineHours: 168,
    multiplier: 3,
    minRecentCost: 25,
  },
});

test("spike fires when recent exceeds baseline by the multiplier", () => {
  const findings = evaluateKeyUsageRules({
    rules: [spikeRule],
    buckets: [
      bucket({ cost: 120, bucketStart: new Date("2026-08-24T00:00:00Z") }),
      bucket({ cost: 20, bucketStart: new Date("2026-08-15T00:00:00Z") }),
    ],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].observed, 120);
  assert.equal(findings[0].baseline, 20);
  assert.match(findings[0].reasons[0], /6\.0x/);
});

test("spike stays silent below the volume floor even at a huge multiplier", () => {
  const findings = evaluateKeyUsageRules({
    rules: [spikeRule],
    buckets: [
      bucket({ cost: 5, bucketStart: new Date("2026-08-24T00:00:00Z") }),
      bucket({ cost: 0.01, bucketStart: new Date("2026-08-15T00:00:00Z") }),
    ],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

test("spike does not fire on a zero baseline — that is a NEW_KEY case", () => {
  const findings = evaluateKeyUsageRules({
    rules: [spikeRule],
    buckets: [bucket({ cost: 900, bucketStart: new Date("2026-08-24T00:00:00Z") })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

// ─── NEW_KEY ────────────────────────────────────────────

const newKeyRule = rule({
  key: "new_key",
  conditionType: "NEW_KEY",
  severity: "MEDIUM",
  config: { conditionType: "NEW_KEY", windowHours: 24, minTokens: 10_000 },
});

test("new key fires when no profile exists and the floor is cleared", () => {
  const findings = evaluateKeyUsageRules({
    rules: [newKeyRule],
    buckets: [bucket({ totalTokens: 50_000 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].reasons[0], /first time/);
});

test("new key does not fire for a key first seen before the window", () => {
  const findings = evaluateKeyUsageRules({
    rules: [newKeyRule],
    buckets: [bucket({ totalTokens: 50_000 })],
    profiles: [
      {
        provider: "anthropic",
        externalId: "apikey_abc",
        firstSeenAt: new Date("2026-01-01T00:00:00Z"),
        lastActiveAt: new Date("2026-08-25T00:00:00Z"),
      },
    ],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

test("new key does not fire when a bucket predates the window, even with no profile", () => {
  const findings = evaluateKeyUsageRules({
    rules: [newKeyRule],
    buckets: [
      bucket({ totalTokens: 50_000 }),
      bucket({ totalTokens: 100, bucketStart: new Date("2026-07-01T00:00:00Z") }),
    ],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

test("new key respects its volume floor", () => {
  const findings = evaluateKeyUsageRules({
    rules: [newKeyRule],
    buckets: [bucket({ totalTokens: 500, cost: 0 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

// ─── DORMANT_REACTIVATION ───────────────────────────────

const dormantRule = rule({
  key: "dormant",
  conditionType: "DORMANT_REACTIVATION",
  config: {
    conditionType: "DORMANT_REACTIVATION",
    dormantDays: 30,
    windowHours: 24,
    minTokens: 5_000,
  },
});

test("dormant reactivation fires after a long idle gap", () => {
  const findings = evaluateKeyUsageRules({
    rules: [dormantRule],
    buckets: [
      bucket({ totalTokens: 20_000 }),
      bucket({ totalTokens: 500, bucketStart: new Date("2026-05-01T00:00:00Z") }),
    ],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].reasons[0], /idle for 11[0-9] days/);
});

test("dormant reactivation does not fire for a continuously active key", () => {
  const findings = evaluateKeyUsageRules({
    rules: [dormantRule],
    buckets: [
      bucket({ totalTokens: 20_000 }),
      bucket({ totalTokens: 500, bucketStart: new Date("2026-08-24T00:00:00Z") }),
    ],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

test("dormant reactivation needs prior activity — an unknown key is not a reactivation", () => {
  const findings = evaluateKeyUsageRules({
    rules: [dormantRule],
    buckets: [bucket({ totalTokens: 20_000 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

test("dormancy ignores zero-volume buckets when locating the last prior activity", () => {
  // A provider that reports the key with no usage must not reset the clock.
  const findings = evaluateKeyUsageRules({
    rules: [dormantRule],
    buckets: [
      bucket({ totalTokens: 20_000 }),
      bucket({
        totalTokens: 0,
        cost: 0,
        requestCount: 0,
        bucketStart: new Date("2026-08-24T00:00:00Z"),
      }),
      bucket({ totalTokens: 500, bucketStart: new Date("2026-05-01T00:00:00Z") }),
    ],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 1);
});

test("dormancy falls back to history older than the loaded bucket range", () => {
  // The key's only prior activity is 60 days back, outside what the evaluator
  // loads. Without the fallback the long gap it exists to catch is invisible.
  const findings = evaluateKeyUsageRules({
    rules: [dormantRule],
    buckets: [bucket({ totalTokens: 20_000 })],
    profiles: [],
    lastActivityBeforeLoad: new Map([
      ["anthropic::apikey_abc", new Date("2026-06-27T00:00:00Z")],
    ]),
    now: NOW,
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].reasons[0], /2026-06-27/);
});

test("dormancy prefers in-range prior activity over older history", () => {
  // In-range activity 2 days ago means the key is not dormant, even though
  // older history exists.
  const findings = evaluateKeyUsageRules({
    rules: [dormantRule],
    buckets: [
      bucket({ totalTokens: 20_000 }),
      bucket({ totalTokens: 500, bucketStart: new Date("2026-08-24T00:00:00Z") }),
    ],
    profiles: [],
    lastActivityBeforeLoad: new Map([
      ["anthropic::apikey_abc", new Date("2026-01-01T00:00:00Z")],
    ]),
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

test("dormancy is unaffected by the profile row, which this job also mutates", () => {
  const withMisleadingProfile = evaluateKeyUsageRules({
    rules: [dormantRule],
    buckets: [
      bucket({ totalTokens: 20_000 }),
      bucket({ totalTokens: 500, bucketStart: new Date("2026-05-01T00:00:00Z") }),
    ],
    profiles: [
      {
        provider: "anthropic",
        externalId: "apikey_abc",
        firstSeenAt: new Date("2026-01-01T00:00:00Z"),
        // Already advanced to now, as it would be after a profile write.
        lastActiveAt: NOW,
      },
    ],
    now: NOW,
  });
  assert.equal(withMisleadingProfile.length, 1);
});

// ─── OFF_HOURS ──────────────────────────────────────────

const offHoursRule = rule({
  key: "off_hours",
  conditionType: "OFF_HOURS",
  config: {
    conditionType: "OFF_HOURS",
    windowHours: 24,
    businessHourStart: 7,
    businessHourEnd: 20,
    businessDays: [1, 2, 3, 4, 5],
    timezoneOffsetMinutes: 0,
    minTokens: 25_000,
  },
});

test("off hours fires on hourly buckets outside the business window", () => {
  const findings = evaluateKeyUsageRules({
    rules: [offHoursRule],
    buckets: [
      // 2026-08-26 is a Wednesday; 03:00 UTC is outside 07:00-20:00.
      bucket({
        granularity: "1h",
        totalTokens: 40_000,
        bucketStart: new Date("2026-08-26T03:00:00Z"),
        bucketEnd: new Date("2026-08-26T04:00:00Z"),
      }),
    ],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].reasons[0], /outside 07:00-20:00 UTC/);
});

test("off hours ignores activity inside the business window", () => {
  const findings = evaluateKeyUsageRules({
    rules: [offHoursRule],
    buckets: [
      bucket({
        granularity: "1h",
        totalTokens: 40_000,
        bucketStart: new Date("2026-08-26T10:00:00Z"),
        bucketEnd: new Date("2026-08-26T11:00:00Z"),
      }),
    ],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

test("off hours stays silent on daily buckets, which have no intra-day resolution", () => {
  const findings = evaluateKeyUsageRules({
    rules: [offHoursRule],
    buckets: [bucket({ granularity: "day", totalTokens: 400_000 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

test("off hours treats a non-business day as off hours regardless of the hour", () => {
  const findings = evaluateKeyUsageRules({
    rules: [
      rule({
        key: "off_hours_weekend",
        conditionType: "OFF_HOURS",
        config: {
          conditionType: "OFF_HOURS",
          windowHours: 96,
          businessHourStart: 7,
          businessHourEnd: 20,
          businessDays: [1, 2, 3, 4, 5],
          timezoneOffsetMinutes: 0,
          minTokens: 1_000,
        },
      }),
    ],
    buckets: [
      // 2026-08-23 is a Sunday, mid-morning.
      bucket({
        granularity: "1h",
        totalTokens: 40_000,
        bucketStart: new Date("2026-08-23T10:00:00Z"),
        bucketEnd: new Date("2026-08-23T11:00:00Z"),
      }),
    ],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 1);
});

test("off hours honours the timezone offset", () => {
  // 09:00 UTC is inside 07:00-20:00 UTC, but 23:00 the previous day in
  // UTC-10 — off hours there.
  const findings = evaluateKeyUsageRules({
    rules: [
      rule({
        key: "off_hours_tz",
        conditionType: "OFF_HOURS",
        config: {
          conditionType: "OFF_HOURS",
          windowHours: 24,
          businessHourStart: 7,
          businessHourEnd: 20,
          businessDays: [1, 2, 3, 4, 5],
          timezoneOffsetMinutes: -600,
          minTokens: 1_000,
        },
      }),
    ],
    buckets: [
      bucket({
        granularity: "1h",
        totalTokens: 40_000,
        bucketStart: new Date("2026-08-26T09:00:00Z"),
        bucketEnd: new Date("2026-08-26T10:00:00Z"),
      }),
    ],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 1);
});

// ─── MODEL_ALLOWLIST ────────────────────────────────────

test("model allowlist fires on a model outside the list", () => {
  const findings = evaluateKeyUsageRules({
    rules: [
      rule({
        key: "allowlist",
        conditionType: "MODEL_ALLOWLIST",
        config: {
          conditionType: "MODEL_ALLOWLIST",
          windowHours: 24,
          allowedModels: ["claude-sonnet"],
          minTokens: 1_000,
        },
      }),
    ],
    buckets: [bucket({ model: "gpt-5", totalTokens: 5_000 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].reasons[0], /gpt-5/);
});

test("model allowlist matches as a substring so dated releases are covered", () => {
  const findings = evaluateKeyUsageRules({
    rules: [
      rule({
        key: "allowlist",
        conditionType: "MODEL_ALLOWLIST",
        config: {
          conditionType: "MODEL_ALLOWLIST",
          windowHours: 24,
          allowedModels: ["claude-sonnet"],
          minTokens: 1_000,
        },
      }),
    ],
    buckets: [bucket({ model: "claude-sonnet-4-6-20260514", totalTokens: 5_000 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

test("an empty allowlist is treated as unconfigured, not as deny-all", () => {
  const findings = evaluateKeyUsageRules({
    rules: [
      rule({
        key: "allowlist",
        conditionType: "MODEL_ALLOWLIST",
        config: {
          conditionType: "MODEL_ALLOWLIST",
          windowHours: 24,
          allowedModels: [],
          minTokens: 1_000,
        },
      }),
    ],
    buckets: [bucket({ model: "gpt-5", totalTokens: 5_000 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

// ─── FAN_OUT ────────────────────────────────────────────

test("fan out fires above the distinct-project limit", () => {
  const buckets = [1, 2, 3, 4, 5, 6].map((n) =>
    bucket({ projectExternalId: `proj_${n}`, bucketStart: new Date("2026-08-24T00:00:00Z") })
  );
  const findings = evaluateKeyUsageRules({
    rules: [
      rule({
        key: "fan_out",
        conditionType: "FAN_OUT",
        config: { conditionType: "FAN_OUT", windowHours: 168, dimension: "project", maxDistinct: 5 },
      }),
    ],
    buckets,
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].observed, 6);
});

test("fan out stays silent at the limit", () => {
  const buckets = [1, 2, 3, 4, 5].map((n) =>
    bucket({ projectExternalId: `proj_${n}`, bucketStart: new Date("2026-08-24T00:00:00Z") })
  );
  const findings = evaluateKeyUsageRules({
    rules: [
      rule({
        key: "fan_out",
        conditionType: "FAN_OUT",
        config: { conditionType: "FAN_OUT", windowHours: 168, dimension: "project", maxDistinct: 5 },
      }),
    ],
    buckets,
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 0);
});

// ─── Ordering + dedupe identity ─────────────────────────

test("findings are ordered most severe first", () => {
  const findings = evaluateKeyUsageRules({
    rules: [
      rule({ id: "a", key: "low_rule", severity: "LOW" }),
      rule({ id: "b", key: "crit_rule", severity: "CRITICAL" }),
    ],
    buckets: [bucket({ cost: 500 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings.length, 2);
  assert.equal(findings[0].severity, "CRITICAL");
});

test("dedupe key is stable per rule, provider, and key", () => {
  const findings = evaluateKeyUsageRules({
    rules: [rule()],
    buckets: [bucket({ cost: 500 })],
    profiles: [],
    now: NOW,
  });
  assert.equal(findings[0].dedupeKey, "test_rule::anthropic::apikey_abc");
});

// ─── Profile maintenance ────────────────────────────────

test("profile firstSeenAt comes from the earliest observed bucket, not now", () => {
  const updates = buildKeyProfileUpdates([
    bucket({ bucketStart: new Date("2026-08-20T00:00:00Z") }),
    bucket({ bucketStart: new Date("2026-08-24T00:00:00Z") }),
  ]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].firstSeenAt.toISOString(), "2026-08-20T00:00:00.000Z");
  assert.equal(updates[0].lastActiveAt.toISOString(), "2026-08-24T00:00:00.000Z");
});

test("zero-volume buckets do not advance lastActiveAt", () => {
  const updates = buildKeyProfileUpdates([
    bucket({ bucketStart: new Date("2026-08-20T00:00:00Z"), totalTokens: 100, cost: 1, requestCount: 1 }),
    bucket({ bucketStart: new Date("2026-08-24T00:00:00Z"), totalTokens: 0, cost: 0, requestCount: 0 }),
  ]);
  assert.equal(updates[0].lastActiveAt.toISOString(), "2026-08-20T00:00:00.000Z");
});

test("keys that never transacted in the window produce no profile row", () => {
  const updates = buildKeyProfileUpdates([
    bucket({ totalTokens: 0, cost: 0, requestCount: 0 }),
  ]);
  assert.equal(updates.length, 0);
});

test("profile updates skip buckets with no key identity", () => {
  const updates = buildKeyProfileUpdates([bucket({ apiKeyExternalId: null })]);
  assert.equal(updates.length, 0);
});
