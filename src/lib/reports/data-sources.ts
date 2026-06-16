import { subDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import type {
  ColumnType,
  FilterOperator,
  ReportDataSourceKey,
  ReportDateRange,
  ReportFilter,
} from "./types";

// ── Column + source definitions ───────────────────────────────────────────

export interface SourceColumn {
  key: string;
  label: string;
  type: ColumnType;
  // Scalar DB field name. Present when the column is a real column on the
  // model (required for filtering / grouping / sorting). Omit for derived /
  // relation-path columns.
  field?: string;
  // Dot-path used to read a value from an included relation, e.g. "owner.name".
  // When absent, `field` (or `key`) is used as a top-level property.
  path?: string;
  // Enum option values, surfaced to the builder UI for filter dropdowns.
  enumOptions?: string[];
  // How this numeric column rolls up in grouped (groupBy) reports.
  aggregate?: "sum" | "avg";
}

export interface DataSourceDef {
  key: ReportDataSourceKey;
  label: string;
  description: string;
  model: string; // prisma delegate property name
  dateField: string; // column used for date-range filtering + default sort
  include?: Record<string, unknown>; // relations to hydrate in detail mode
  columns: SourceColumn[];
  defaultColumns: string[]; // used when a config has no columns
}

const RISK_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"];
const SYSTEM_STATUSES = [
  "DRAFT",
  "UNDER_REVIEW",
  "APPROVED",
  "DEPLOYED",
  "DEPRECATED",
  "RETIRED",
];

export const DATA_SOURCES: Record<ReportDataSourceKey, DataSourceDef> = {
  AI_SYSTEMS: {
    key: "AI_SYSTEMS",
    label: "AI Systems",
    description: "Registered AI systems with risk, status, and ownership.",
    model: "aISystem",
    dateField: "createdAt",
    include: { owner: { select: { name: true, email: true } } },
    columns: [
      { key: "name", label: "Name", type: "string", field: "name" },
      { key: "department", label: "Department", type: "string", field: "department" },
      { key: "status", label: "Status", type: "enum", field: "status", enumOptions: SYSTEM_STATUSES },
      { key: "riskLevel", label: "Risk Level", type: "enum", field: "riskLevel", enumOptions: RISK_LEVELS },
      {
        key: "dataSensitivity",
        label: "Data Sensitivity",
        type: "enum",
        field: "dataSensitivity",
        enumOptions: ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"],
      },
      { key: "vendor", label: "Vendor", type: "string", field: "vendor" },
      { key: "version", label: "Version", type: "string", field: "version" },
      { key: "modelType", label: "Model Type", type: "string", field: "modelType" },
      { key: "ownerName", label: "Owner", type: "string", path: "owner.name" },
      { key: "ownerEmail", label: "Owner Email", type: "string", path: "owner.email" },
      { key: "nextReviewDate", label: "Next Review", type: "date", field: "nextReviewDate" },
      { key: "createdAt", label: "Created", type: "date", field: "createdAt" },
      { key: "updatedAt", label: "Updated", type: "date", field: "updatedAt" },
    ],
    defaultColumns: ["name", "department", "status", "riskLevel", "ownerName", "createdAt"],
  },

  AI_AGENTS: {
    key: "AI_AGENTS",
    label: "AI Agents",
    description: "Autonomous and assisted AI agents and their oversight posture.",
    model: "aIAgent",
    dateField: "createdAt",
    include: {
      owner: { select: { name: true, email: true } },
      aiSystem: { select: { name: true } },
    },
    columns: [
      { key: "name", label: "Name", type: "string", field: "name" },
      { key: "department", label: "Department", type: "string", field: "department" },
      { key: "status", label: "Status", type: "enum", field: "status", enumOptions: SYSTEM_STATUSES },
      { key: "riskLevel", label: "Risk Level", type: "enum", field: "riskLevel", enumOptions: RISK_LEVELS },
      {
        key: "autonomyLevel",
        label: "Autonomy",
        type: "enum",
        field: "autonomyLevel",
        enumOptions: [
          "FULL_AUTONOMY",
          "SUPERVISED",
          "HUMAN_IN_THE_LOOP",
          "HUMAN_ON_THE_LOOP",
          "MANUAL",
        ],
      },
      { key: "accessLevel", label: "Access Level", type: "string", field: "accessLevel" },
      { key: "ownerName", label: "Owner", type: "string", path: "owner.name" },
      { key: "systemName", label: "AI System", type: "string", path: "aiSystem.name" },
      { key: "createdAt", label: "Created", type: "date", field: "createdAt" },
    ],
    defaultColumns: ["name", "department", "autonomyLevel", "riskLevel", "ownerName", "createdAt"],
  },

  RISK_ASSESSMENTS: {
    key: "RISK_ASSESSMENTS",
    label: "Risk Assessments",
    description: "Per-dimension and overall risk scores for AI systems.",
    model: "riskAssessment",
    dateField: "createdAt",
    include: { aiSystem: { select: { name: true, department: true } } },
    columns: [
      { key: "systemName", label: "AI System", type: "string", path: "aiSystem.name" },
      { key: "department", label: "Department", type: "string", path: "aiSystem.department" },
      { key: "overallScore", label: "Overall", type: "number", field: "overallScore", aggregate: "avg" },
      { key: "biasScore", label: "Bias", type: "number", field: "biasScore", aggregate: "avg" },
      { key: "securityScore", label: "Security", type: "number", field: "securityScore", aggregate: "avg" },
      { key: "privacyScore", label: "Privacy", type: "number", field: "privacyScore", aggregate: "avg" },
      { key: "fairnessScore", label: "Fairness", type: "number", field: "fairnessScore", aggregate: "avg" },
      { key: "performanceScore", label: "Performance", type: "number", field: "performanceScore", aggregate: "avg" },
      { key: "transparencyScore", label: "Transparency", type: "number", field: "transparencyScore", aggregate: "avg" },
      { key: "assessedBy", label: "Assessed By", type: "string", field: "assessedBy" },
      { key: "createdAt", label: "Assessed", type: "date", field: "createdAt" },
    ],
    defaultColumns: ["systemName", "overallScore", "securityScore", "privacyScore", "assessedBy", "createdAt"],
  },

  COMPLIANCE: {
    key: "COMPLIANCE",
    label: "Compliance",
    description: "Policy-to-system assignments and their compliance status.",
    model: "policyAssignment",
    dateField: "createdAt",
    include: {
      policy: { select: { name: true, framework: true } },
      aiSystem: { select: { name: true, department: true } },
    },
    columns: [
      { key: "policyName", label: "Policy", type: "string", path: "policy.name" },
      { key: "framework", label: "Framework", type: "string", path: "policy.framework" },
      { key: "systemName", label: "AI System", type: "string", path: "aiSystem.name" },
      { key: "department", label: "Department", type: "string", path: "aiSystem.department" },
      {
        key: "complianceStatus",
        label: "Status",
        type: "enum",
        field: "complianceStatus",
        enumOptions: ["COMPLIANT", "PARTIALLY_COMPLIANT", "NON_COMPLIANT", "NOT_ASSESSED"],
      },
      { key: "assessedAt", label: "Assessed", type: "date", field: "assessedAt" },
      { key: "nextReviewDate", label: "Next Review", type: "date", field: "nextReviewDate" },
      { key: "createdAt", label: "Created", type: "date", field: "createdAt" },
    ],
    defaultColumns: ["policyName", "systemName", "complianceStatus", "assessedAt", "nextReviewDate"],
  },

  API_USAGE: {
    key: "API_USAGE",
    label: "API Usage & Cost",
    description: "Per-request token and cost telemetry across providers.",
    model: "aPIUsageLog",
    dateField: "createdAt",
    include: { user: { select: { name: true, email: true } } },
    columns: [
      { key: "provider", label: "Provider", type: "string", field: "provider" },
      { key: "model", label: "Model", type: "string", field: "model" },
      { key: "department", label: "Department", type: "string", field: "department" },
      { key: "promptTokens", label: "Prompt Tokens", type: "number", field: "promptTokens", aggregate: "sum" },
      { key: "completionTokens", label: "Completion Tokens", type: "number", field: "completionTokens", aggregate: "sum" },
      { key: "totalTokens", label: "Total Tokens", type: "number", field: "totalTokens", aggregate: "sum" },
      { key: "cost", label: "Cost", type: "currency", field: "cost", aggregate: "sum" },
      { key: "flagged", label: "Flagged", type: "boolean", field: "flagged" },
      { key: "flagCategory", label: "Flag Category", type: "string", field: "flagCategory" },
      { key: "userEmail", label: "User", type: "string", path: "user.email" },
      { key: "createdAt", label: "Timestamp", type: "date", field: "createdAt" },
    ],
    defaultColumns: ["provider", "model", "department", "totalTokens", "cost", "createdAt"],
  },

  ALERTS: {
    key: "ALERTS",
    label: "Alerts",
    description: "Governance and security alerts and their lifecycle status.",
    model: "alert",
    dateField: "createdAt",
    include: { aiSystem: { select: { name: true } } },
    columns: [
      { key: "title", label: "Title", type: "string", field: "title" },
      {
        key: "severity",
        label: "Severity",
        type: "enum",
        field: "severity",
        enumOptions: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"],
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        field: "status",
        enumOptions: ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"],
      },
      { key: "source", label: "Source", type: "string", field: "source" },
      { key: "systemName", label: "AI System", type: "string", path: "aiSystem.name" },
      { key: "falsePositive", label: "False Positive", type: "boolean", field: "falsePositive" },
      { key: "createdAt", label: "Raised", type: "date", field: "createdAt" },
    ],
    defaultColumns: ["title", "severity", "status", "source", "createdAt"],
  },

  SHADOW_AI: {
    key: "SHADOW_AI",
    label: "Shadow AI",
    description: "Discovered (unsanctioned) AI tools and their triage status.",
    model: "discoveredAITool",
    dateField: "detectedAt",
    columns: [
      { key: "toolName", label: "Tool", type: "string", field: "toolName" },
      { key: "vendor", label: "Vendor", type: "string", field: "vendor" },
      { key: "detectedDomain", label: "Domain", type: "string", field: "detectedDomain" },
      { key: "detectionSource", label: "Detection Source", type: "string", field: "detectionSource" },
      {
        key: "status",
        label: "Status",
        type: "enum",
        field: "status",
        enumOptions: ["DISCOVERED", "UNDER_REVIEW", "REGISTERED", "BLOCKED", "APPROVED"],
      },
      { key: "department", label: "Department", type: "string", field: "department" },
      { key: "userCount", label: "Users", type: "number", field: "userCount", aggregate: "sum" },
      { key: "matchConfidence", label: "Match Confidence", type: "string", field: "matchConfidence" },
      { key: "detectedAt", label: "Detected", type: "date", field: "detectedAt" },
    ],
    defaultColumns: ["toolName", "vendor", "status", "department", "userCount", "detectedAt"],
  },

  AUDIT_LOG: {
    key: "AUDIT_LOG",
    label: "Audit Log",
    description: "Immutable trail of mutations across the platform.",
    model: "auditLog",
    dateField: "createdAt",
    include: { user: { select: { name: true, email: true } } },
    columns: [
      { key: "action", label: "Action", type: "string", field: "action" },
      { key: "entityType", label: "Entity Type", type: "string", field: "entityType" },
      { key: "entityId", label: "Entity ID", type: "string", field: "entityId" },
      { key: "userName", label: "User", type: "string", path: "user.name" },
      { key: "userEmail", label: "User Email", type: "string", path: "user.email" },
      { key: "createdAt", label: "Timestamp", type: "date", field: "createdAt" },
    ],
    defaultColumns: ["action", "entityType", "userName", "createdAt"],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

export function getDataSource(key: ReportDataSourceKey): DataSourceDef {
  const source = DATA_SOURCES[key];
  if (!source) throw new Error(`Unknown report data source: ${key}`);
  return source;
}

export function getColumn(
  source: DataSourceDef,
  key: string
): SourceColumn | undefined {
  return source.columns.find((c) => c.key === key);
}

// Resolve a config's column keys to definitions, falling back to defaults.
export function resolveColumns(
  source: DataSourceDef,
  keys: string[] | undefined
): SourceColumn[] {
  const requested = (keys && keys.length ? keys : source.defaultColumns)
    .map((k) => getColumn(source, k))
    .filter((c): c is SourceColumn => Boolean(c));
  return requested.length ? requested : source.columns.slice(0, 5);
}

// Scalar columns are the only ones that can be filtered, grouped, or sorted
// directly by Prisma.
export function scalarColumns(source: DataSourceDef): SourceColumn[] {
  return source.columns.filter((c) => Boolean(c.field));
}

// Read a (possibly nested) value off a hydrated row and normalize it into a
// JSON-serializable primitive. Dates become ISO strings.
export function getCellValue(
  row: Record<string, unknown>,
  column: SourceColumn
): string | number | boolean | null {
  let value: unknown = row;
  const path = column.path ?? column.field ?? column.key;
  for (const part of path.split(".")) {
    if (value == null) break;
    value = (value as Record<string, unknown>)[part];
  }
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function coerce(type: ColumnType, raw: string): string | number | boolean | Date {
  if (type === "number" || type === "currency") return Number(raw);
  if (type === "boolean") return raw === "true";
  if (type === "date") return new Date(raw);
  return raw;
}

// Build a Prisma `where` clause from validated filters + date range.
// Field names come exclusively from the registry (never raw user input),
// so no Prisma operator keys can be smuggled in; user input is only ever a
// value, never a key.
export function buildWhere(
  source: DataSourceDef,
  filters: ReportFilter[] | undefined,
  dateRange: ReportDateRange | undefined
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  for (const filter of filters ?? []) {
    const column = getColumn(source, filter.field);
    if (!column?.field) continue; // ignore non-scalar / unknown fields
    const f = column.field;
    const op: FilterOperator = filter.operator;

    if (op === "in" && Array.isArray(filter.value)) {
      where[f] = { in: filter.value };
      continue;
    }
    const raw = Array.isArray(filter.value) ? filter.value[0] ?? "" : filter.value;

    switch (op) {
      case "eq":
        where[f] = coerce(column.type, raw);
        break;
      case "ne":
        where[f] = { not: coerce(column.type, raw) };
        break;
      case "contains":
        where[f] = { contains: raw, mode: "insensitive" };
        break;
      case "gt":
        where[f] = { gt: coerce(column.type, raw) };
        break;
      case "gte":
        where[f] = { gte: coerce(column.type, raw) };
        break;
      case "lt":
        where[f] = { lt: coerce(column.type, raw) };
        break;
      case "lte":
        where[f] = { lte: coerce(column.type, raw) };
        break;
    }
  }

  const range = resolveDateRange(dateRange);
  if (range) {
    where[source.dateField] = { gte: range.from, lte: range.to };
  }

  return where;
}

export function resolveDateRange(
  dateRange: ReportDateRange | undefined
): { from: Date; to: Date } | null {
  if (!dateRange || !dateRange.preset || dateRange.preset === "all") return null;
  const to = new Date();
  if (dateRange.preset === "custom") {
    if (!dateRange.from || !dateRange.to) return null;
    return { from: new Date(dateRange.from), to: new Date(dateRange.to) };
  }
  const days = dateRange.preset === "7d" ? 7 : dateRange.preset === "90d" ? 90 : 30;
  return { from: subDays(to, days), to };
}

export function dateRangeLabel(dateRange: ReportDateRange | undefined): string | null {
  const range = resolveDateRange(dateRange);
  if (!range) return null;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `${fmt(range.from)} → ${fmt(range.to)}`;
}

// Expose the registry to the builder UI in a serializable shape (no functions).
export function serializeRegistry() {
  return Object.values(DATA_SOURCES).map((source) => ({
    key: source.key,
    label: source.label,
    description: source.description,
    dateField: source.dateField,
    columns: source.columns.map((c) => ({
      key: c.key,
      label: c.label,
      type: c.type,
      filterable: Boolean(c.field),
      groupable: Boolean(c.field) && c.type !== "date",
      enumOptions: c.enumOptions ?? null,
    })),
    defaultColumns: source.defaultColumns,
  }));
}

// Resolve the Prisma delegate for a data source.
export function delegateFor(source: DataSourceDef) {
  const client = prisma as unknown as Record<string, unknown>;
  const delegate = client[source.model];
  if (!delegate) throw new Error(`No Prisma delegate for ${source.model}`);
  return delegate as {
    findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
    count: (args: unknown) => Promise<number>;
    groupBy: (args: unknown) => Promise<Record<string, unknown>[]>;
  };
}
