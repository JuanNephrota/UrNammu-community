import type { ReportConfig, ReportDataSourceKey } from "./types";

// Prebuilt report templates. "Use template" creates a ReportDefinition
// pre-filled with this dataSource + config, which the user can then run,
// export, schedule, or further customize in the builder.
export interface ReportTemplate {
  key: string;
  name: string;
  description: string;
  // lucide-react icon name, resolved client-side (Server→Client components
  // cannot pass component references per the project's Next.js 16 rules).
  icon: string;
  dataSource: ReportDataSourceKey;
  config: ReportConfig;
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    key: "risk-posture",
    name: "Risk Posture",
    description:
      "Latest risk assessments with overall and per-dimension scores, newest first.",
    icon: "ShieldAlert",
    dataSource: "RISK_ASSESSMENTS",
    config: {
      columns: ["systemName", "overallScore", "securityScore", "privacyScore", "biasScore", "assessedBy", "createdAt"],
      sort: { field: "createdAt", direction: "desc" },
      dateRange: { preset: "90d" },
      chartType: "none",
    },
  },
  {
    key: "compliance-status",
    name: "Compliance Status",
    description: "Policy assignments grouped by compliance status across all systems.",
    icon: "FileCheck",
    dataSource: "COMPLIANCE",
    config: {
      columns: ["complianceStatus"],
      groupBy: "complianceStatus",
      chartType: "pie",
    },
  },
  {
    key: "usage-cost",
    name: "Usage & Cost",
    description: "API spend and token consumption by provider over the last 30 days.",
    icon: "DollarSign",
    dataSource: "API_USAGE",
    config: {
      columns: ["provider", "totalTokens", "cost"],
      groupBy: "provider",
      dateRange: { preset: "30d" },
      chartType: "bar",
    },
  },
  {
    key: "shadow-ai-inventory",
    name: "Shadow AI Inventory",
    description: "All discovered (unsanctioned) AI tools and their triage status.",
    icon: "Search",
    dataSource: "SHADOW_AI",
    config: {
      columns: ["toolName", "vendor", "status", "department", "userCount", "detectedAt"],
      sort: { field: "userCount", direction: "desc" },
      chartType: "none",
    },
  },
  {
    key: "system-inventory",
    name: "AI System Inventory",
    description: "Complete registry of AI systems with ownership and risk level.",
    icon: "Database",
    dataSource: "AI_SYSTEMS",
    config: {
      columns: ["name", "department", "status", "riskLevel", "dataSensitivity", "vendor", "ownerName", "createdAt"],
      sort: { field: "name", direction: "asc" },
      chartType: "none",
    },
  },
  {
    key: "executive-summary",
    name: "Executive Summary",
    description: "AI systems grouped by risk level — board-ready posture snapshot.",
    icon: "Presentation",
    dataSource: "AI_SYSTEMS",
    config: {
      columns: ["riskLevel"],
      groupBy: "riskLevel",
      chartType: "pie",
    },
  },
  {
    key: "alerts-activity",
    name: "Alerts Activity",
    description: "Open and recent alerts by severity over the last 30 days.",
    icon: "Bell",
    dataSource: "ALERTS",
    config: {
      columns: ["title", "severity", "status", "source", "createdAt"],
      dateRange: { preset: "30d" },
      sort: { field: "createdAt", direction: "desc" },
      chartType: "none",
    },
  },
  {
    key: "audit-trail",
    name: "Audit Trail",
    description: "Chronological record of platform mutations over the last 30 days.",
    icon: "ScrollText",
    dataSource: "AUDIT_LOG",
    config: {
      columns: ["action", "entityType", "userName", "createdAt"],
      dateRange: { preset: "30d" },
      sort: { field: "createdAt", direction: "desc" },
      chartType: "none",
    },
  },
];

export function getTemplate(key: string): ReportTemplate | undefined {
  return REPORT_TEMPLATES.find((t) => t.key === key);
}
