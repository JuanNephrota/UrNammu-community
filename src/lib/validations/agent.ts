import { z } from "zod";
import { normalizeHumanReviewTriggers } from "@/lib/human-review-triggers";

export const createAgentSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().optional(),
  aiSystemId: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  accessLevel: z.string().default("read-only"),
  autonomyLevel: z.enum([
    "FULL_AUTONOMY",
    "SUPERVISED",
    "HUMAN_IN_THE_LOOP",
    "HUMAN_ON_THE_LOOP",
    "MANUAL",
  ]).default("HUMAN_IN_THE_LOOP"),
  connectedSystems: z.array(z.string()).default([]),
  humanReviewRequired: z.boolean().default(true),
  // Any shape is accepted (legacy free text included) and normalised into the
  // structured trigger list both proxies evaluate. See human-review-triggers.ts.
  humanReviewTriggers: z
    .any()
    .optional()
    .transform((value) => (value === undefined ? undefined : normalizeHumanReviewTriggers(value))),
  humanReviewEnforcement: z.enum(["monitor", "enforce"]).default("monitor"),
  riskLevel: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"]).default("MEDIUM"),
  status: z.enum(["DRAFT", "UNDER_REVIEW", "APPROVED", "DEPLOYED", "DEPRECATED", "RETIRED"]).default("DRAFT"),
  department: z.string().optional(),
  // Charter (docs/plans/agentic-governance-playbook.md §2). Text fields are
  // nullish so the form can clear them; empty strings are normalised to null
  // in the API routes.
  purpose: z.string().max(5000).nullish(),
  inScopeActions: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  outOfScopeActions: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  decisionBoundaries: z.string().max(5000).nullish(),
  successCriteria: z.string().max(5000).nullish(),
  // Accountability
  technicalOwnerId: z.string().max(100).nullish(),
  riskOwnerId: z.string().max(100).nullish(),
  escalationContact: z.string().max(300).nullish(),
  // Approval gate
  requireOwnerApproval: z.boolean().default(true),
  requireSecurityApproval: z.boolean().default(true),
  requireLegalApproval: z.boolean().default(false),
  requireComplianceApproval: z.boolean().default(true),
  reviewIntervalDays: z.coerce.number().int().min(1).max(730).default(365),
  // MCP tool governance
  mcpServerAllowlist: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
  mcpToolAllowlist: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  mcpEnforcement: z.enum(["monitor", "enforce"]).default("monitor"),
  // New agents inherit the org catalog; existing rows keep their stored value.
  inheritMcpCatalog: z.boolean().default(true),
});

export const updateAgentSchema = createAgentSchema.partial();

const CHARTER_TEXT_FIELDS = [
  "purpose",
  "decisionBoundaries",
  "successCriteria",
  "description",
  "escalationContact",
  "technicalOwnerId",
  "riskOwnerId",
] as const;

/** Empty strings from form fields become null so "cleared" is distinguishable from "unchanged". */
export function normalizeAgentText<T extends Partial<Record<(typeof CHARTER_TEXT_FIELDS)[number], string | null | undefined>>>(
  data: T
): T {
  const out = { ...data };
  for (const key of CHARTER_TEXT_FIELDS) {
    if (key in out && typeof out[key] === "string" && !(out[key] as string).trim()) {
      (out as Record<string, unknown>)[key] = null;
    }
  }
  return out;
}

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
