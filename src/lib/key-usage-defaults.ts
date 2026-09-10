import type { AlertSeverity } from "@prisma/client";
import type { KeyUsageRuleConfig } from "./validations/key-usage-rule";

/**
 * Built-in key-usage rules. These mirror the seed data in
 * `prisma/migrations/20260826120000_key_usage_rules/migration.sql` and are used
 * as a fallback when the database is unreachable (CI, cold starts, brief
 * outages). When the DB is up and seeded, those rows win — admins edit them at
 * `/alerts/key-usage-rules` and their overrides take precedence at runtime.
 *
 * Keep this list in sync with the migration seed.
 *
 * Tuning note: every default carries a volume floor (`minTokens` / `minCost`).
 * Per-key telemetry has a long tail of keys that transact a few hundred tokens
 * a week, and a 3x multiplier on a near-zero baseline fires constantly. The
 * floors are what keep these rules quiet enough to be worth routing to Alerts.
 */
export type BuiltInKeyUsageRule = {
  key: string;
  label: string;
  severity: AlertSeverity;
  conditionType: KeyUsageRuleConfig["conditionType"];
  providers: string[];
  apiKeyExternalIds: string[];
  config: KeyUsageRuleConfig;
  description: string;
};

export const BUILTIN_KEY_USAGE_RULES: BuiltInKeyUsageRule[] = [
  {
    key: "key_spend_spike",
    label: "API key spend spike",
    severity: "HIGH",
    conditionType: "SPIKE_MULTIPLIER",
    providers: [],
    apiKeyExternalIds: [],
    config: {
      conditionType: "SPIKE_MULTIPLIER",
      metric: "cost",
      windowHours: 168,
      baselineHours: 168,
      multiplier: 3,
      minRecentCost: 25,
    },
    description:
      "A key's spend over the last 7 days is at least 3x its spend in the prior 7 days, on at least $25 of recent spend. Catches runaway loops, leaked keys, and unplanned batch jobs.",
  },
  {
    key: "key_token_spike",
    label: "API key token volume spike",
    severity: "MEDIUM",
    conditionType: "SPIKE_MULTIPLIER",
    providers: [],
    apiKeyExternalIds: [],
    config: {
      conditionType: "SPIKE_MULTIPLIER",
      metric: "tokens",
      windowHours: 168,
      baselineHours: 168,
      multiplier: 3,
      minRecentTokens: 250_000,
    },
    description:
      "A key's token volume over the last 7 days is at least 3x the prior 7 days, on at least 250k recent tokens. Token spikes without a matching spend spike often mean a prompt or context change rather than more traffic.",
  },
  {
    key: "key_daily_spend_ceiling",
    label: "API key exceeded daily spend ceiling",
    severity: "HIGH",
    conditionType: "VOLUME_THRESHOLD",
    providers: [],
    apiKeyExternalIds: [],
    config: {
      conditionType: "VOLUME_THRESHOLD",
      metric: "cost",
      windowHours: 24,
      threshold: 500,
    },
    description:
      "A single key spent more than $500 in 24 hours. An absolute ceiling, so it fires even when the spend has been consistently high and a spike rule would not.",
  },
  {
    key: "new_api_key_activity",
    label: "New API key started transacting",
    severity: "MEDIUM",
    conditionType: "NEW_KEY",
    providers: [],
    apiKeyExternalIds: [],
    config: {
      conditionType: "NEW_KEY",
      windowHours: 24,
      minTokens: 10_000,
    },
    description:
      "A key never seen in telemetry before has moved at least 10k tokens. Worth confirming the key was issued deliberately and is attributable to a registered AI system.",
  },
  {
    key: "dormant_key_reactivated",
    label: "Dormant API key reactivated",
    severity: "HIGH",
    conditionType: "DORMANT_REACTIVATION",
    providers: [],
    apiKeyExternalIds: [],
    config: {
      conditionType: "DORMANT_REACTIVATION",
      dormantDays: 30,
      windowHours: 24,
      minTokens: 5_000,
    },
    description:
      "A key idle for at least 30 days started transacting again. Reactivation of a forgotten key is a common signature of credential compromise.",
  },
  {
    key: "key_off_hours_activity",
    label: "API key active outside business hours",
    severity: "MEDIUM",
    conditionType: "OFF_HOURS",
    providers: [],
    apiKeyExternalIds: [],
    config: {
      conditionType: "OFF_HOURS",
      windowHours: 24,
      businessHourStart: 7,
      businessHourEnd: 20,
      businessDays: [1, 2, 3, 4, 5],
      timezoneOffsetMinutes: 0,
      minTokens: 25_000,
    },
    description:
      "A key moved at least 25k tokens outside 07:00-20:00 UTC on a weekday. Requires hourly-granularity telemetry — provider Admin API sync only reports daily totals, so this rule evaluates proxy-ingested keys only.",
  },
  {
    key: "key_model_allowlist",
    label: "API key used a non-approved model",
    severity: "MEDIUM",
    conditionType: "MODEL_ALLOWLIST",
    providers: [],
    apiKeyExternalIds: [],
    config: {
      conditionType: "MODEL_ALLOWLIST",
      windowHours: 24,
      allowedModels: [],
      minTokens: 1_000,
    },
    description:
      "A key invoked a model outside its allowlist. Ships disabled with an empty allowlist — add the model IDs your organization has approved, then enable it.",
  },
  {
    key: "key_project_fan_out",
    label: "API key spanning many projects",
    severity: "MEDIUM",
    conditionType: "FAN_OUT",
    providers: [],
    apiKeyExternalIds: [],
    config: {
      conditionType: "FAN_OUT",
      windowHours: 168,
      dimension: "project",
      maxDistinct: 5,
    },
    description:
      "A single key was used across more than 5 distinct projects in 7 days. Broad reuse of one credential defeats per-project attribution and widens the blast radius if it leaks.",
  },
];

/**
 * The one built-in that ships disabled: an empty model allowlist would flag
 * every request, so an admin has to populate it before it is useful.
 */
export const DISABLED_BY_DEFAULT_KEYS = new Set(["key_model_allowlist"]);
