import { z } from "zod";

/**
 * Zod schemas for KeyUsageRule. The `config` column is a discriminated union
 * on `conditionType`; each condition carries only the parameters it uses.
 *
 * The rule row also stores `conditionType` as a typed Prisma enum column so it
 * stays queryable/indexable. The two must agree — `keyUsageRuleSchema` enforces
 * that with a `.refine()` rather than trusting callers to keep them in sync.
 */

export const KEY_USAGE_METRICS = ["tokens", "cost", "requests"] as const;
export const KEY_USAGE_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export const FAN_OUT_DIMENSIONS = ["project", "actor"] as const;

// Stable key: lowercase, alphanumeric + underscore — mirrors PromptRiskRule so
// the two rule surfaces read the same way and keys stay URL/dedupe safe.
const KEY_REGEX = /^[a-z][a-z0-9_]{2,39}$/;

// One week of hourly buckets is the practical ceiling for a single evaluation
// pass; 90 days of daily buckets is the ceiling for longer windows.
const windowHours = z.number().int().min(1).max(2160);

const volumeFloors = {
  minTokens: z.number().int().min(0).max(1_000_000_000).optional(),
  minCost: z.number().min(0).max(1_000_000).optional(),
};

const volumeThresholdConfig = z.object({
  conditionType: z.literal("VOLUME_THRESHOLD"),
  metric: z.enum(KEY_USAGE_METRICS),
  windowHours,
  threshold: z.number().min(0),
});

const spikeMultiplierConfig = z.object({
  conditionType: z.literal("SPIKE_MULTIPLIER"),
  metric: z.enum(KEY_USAGE_METRICS),
  windowHours,
  baselineHours: windowHours,
  // Below 1.1 the rule fires on ordinary week-to-week variance.
  multiplier: z.number().min(1.1).max(1000),
  minRecentTokens: volumeFloors.minTokens,
  minRecentCost: volumeFloors.minCost,
});

const newKeyConfig = z.object({
  conditionType: z.literal("NEW_KEY"),
  windowHours,
  ...volumeFloors,
});

const dormantReactivationConfig = z.object({
  conditionType: z.literal("DORMANT_REACTIVATION"),
  dormantDays: z.number().int().min(1).max(730),
  windowHours,
  ...volumeFloors,
});

const offHoursConfig = z
  .object({
    conditionType: z.literal("OFF_HOURS"),
    windowHours,
    // Inclusive start, exclusive end, in the timezone implied by
    // timezoneOffsetMinutes. 7-20 means "07:00 up to but not including 20:00".
    businessHourStart: z.number().int().min(0).max(23),
    businessHourEnd: z.number().int().min(1).max(24),
    // 0 = Sunday .. 6 = Saturday.
    businessDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    // Minutes east of UTC (e.g. -300 for US Eastern standard time). A fixed
    // offset rather than an IANA zone: buckets are hour-aligned and the rule
    // only needs to know which local hour a bucket fell in.
    timezoneOffsetMinutes: z.number().int().min(-840).max(840),
    ...volumeFloors,
  })
  .refine((c) => c.businessHourEnd > c.businessHourStart, {
    message: "businessHourEnd must be after businessHourStart.",
    path: ["businessHourEnd"],
  });

const modelAllowlistConfig = z.object({
  conditionType: z.literal("MODEL_ALLOWLIST"),
  windowHours,
  // Matched case-insensitively as a substring, so "claude-sonnet" covers
  // every dated release of that model.
  allowedModels: z.array(z.string().trim().min(1).max(200)).max(100),
  ...volumeFloors,
});

const fanOutConfig = z.object({
  conditionType: z.literal("FAN_OUT"),
  windowHours,
  dimension: z.enum(FAN_OUT_DIMENSIONS),
  maxDistinct: z.number().int().min(1).max(10_000),
});

export const keyUsageRuleConfigSchema = z.discriminatedUnion("conditionType", [
  volumeThresholdConfig,
  spikeMultiplierConfig,
  newKeyConfig,
  dormantReactivationConfig,
  offHoursConfig,
  modelAllowlistConfig,
  fanOutConfig,
]);

export type KeyUsageRuleConfig = z.infer<typeof keyUsageRuleConfigSchema>;

const scopeFields = {
  providers: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  apiKeyExternalIds: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
};

export const createKeyUsageRuleSchema = z
  .object({
    key: z
      .string()
      .regex(
        KEY_REGEX,
        "Key must start with a lowercase letter and contain only lowercase letters, digits, and underscores (3-40 chars)."
      ),
    label: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullish(),
    conditionType: z.enum([
      "VOLUME_THRESHOLD",
      "SPIKE_MULTIPLIER",
      "NEW_KEY",
      "DORMANT_REACTIVATION",
      "OFF_HOURS",
      "MODEL_ALLOWLIST",
      "FAN_OUT",
    ]),
    severity: z.enum(KEY_USAGE_SEVERITIES),
    config: keyUsageRuleConfigSchema,
    enabled: z.boolean().optional(),
    ...scopeFields,
  })
  .refine((rule) => rule.conditionType === rule.config.conditionType, {
    message: "config.conditionType must match the rule's conditionType.",
    path: ["config", "conditionType"],
  });

/**
 * `key` and `builtIn` are not editable: the key is the dedupe identity carried
 * on every Alert this rule has already raised, and builtIn is set by migrations.
 * `conditionType` is not editable either — changing it would invalidate the
 * stored config, so admins create a new rule instead.
 */
export const updateKeyUsageRuleSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullish(),
    severity: z.enum(KEY_USAGE_SEVERITIES).optional(),
    config: keyUsageRuleConfigSchema.optional(),
    enabled: z.boolean().optional(),
    ...scopeFields,
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field must be provided.",
  });

export const previewKeyUsageRuleSchema = z.object({
  conditionType: z.enum([
    "VOLUME_THRESHOLD",
    "SPIKE_MULTIPLIER",
    "NEW_KEY",
    "DORMANT_REACTIVATION",
    "OFF_HOURS",
    "MODEL_ALLOWLIST",
    "FAN_OUT",
  ]),
  config: keyUsageRuleConfigSchema,
  ...scopeFields,
});
