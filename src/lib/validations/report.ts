import { z } from "zod";

export const DATA_SOURCE_VALUES = [
  "AI_SYSTEMS",
  "AI_AGENTS",
  "RISK_ASSESSMENTS",
  "COMPLIANCE",
  "API_USAGE",
  "ALERTS",
  "SHADOW_AI",
  "AUDIT_LOG",
] as const;

export const REPORT_FORMAT_VALUES = ["PDF", "CSV", "JSON"] as const;

const filterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["eq", "ne", "contains", "gt", "gte", "lt", "lte", "in"]),
  value: z.union([z.string(), z.array(z.string())]),
});

const dateRangeSchema = z.object({
  preset: z.enum(["7d", "30d", "90d", "all", "custom"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const reportConfigSchema = z.object({
  columns: z.array(z.string()).default([]),
  filters: z.array(filterSchema).optional(),
  groupBy: z.string().optional(),
  dateRange: dateRangeSchema.optional(),
  sort: z
    .object({ field: z.string(), direction: z.enum(["asc", "desc"]) })
    .optional(),
  chartType: z.enum(["none", "bar", "line", "pie"]).optional(),
  rowLimit: z.number().int().positive().max(50000).optional(),
});

export const createReportSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().nullish(),
  dataSource: z.enum(DATA_SOURCE_VALUES),
  templateKey: z.string().nullish(),
  config: reportConfigSchema,
  visibility: z.enum(["PRIVATE", "SHARED"]).default("PRIVATE"),
});

export const updateReportSchema = createReportSchema.partial();

export const runReportSchema = z.object({
  format: z.enum(REPORT_FORMAT_VALUES),
  overrides: z
    .object({
      rowLimit: z.number().int().positive().max(50000).optional(),
      dateRange: dateRangeSchema.optional(),
    })
    .optional(),
});

export const createScheduleSchema = z.object({
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  hourUtc: z.number().int().min(0).max(23).default(8),
  dayOfWeek: z.number().int().min(0).max(6).nullish(),
  dayOfMonth: z.number().int().min(1).max(28).nullish(),
  format: z.enum(REPORT_FORMAT_VALUES).default("PDF"),
  recipients: z.array(z.string().email()).default([]),
  enabled: z.boolean().default(true),
});

export const updateScheduleSchema = createScheduleSchema.partial();

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UpdateReportInput = z.infer<typeof updateReportSchema>;
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
