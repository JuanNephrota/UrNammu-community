import { z } from "zod";

export const createPolicySchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().optional(),
  framework: z.enum(["EU_AI_ACT", "NIST_AI_RMF", "ISO_42001", "SOC2", "CUSTOM"]),
  version: z.string().default("1.0"),
  content: z.string().min(1, "Policy content is required"),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
});

export const updatePolicySchema = createPolicySchema.partial();

export const assignPolicySchema = z.object({
  policyId: z.string().min(1),
  aiSystemId: z.string().min(1),
  complianceStatus: z.enum(["COMPLIANT", "PARTIALLY_COMPLIANT", "NON_COMPLIANT", "NOT_ASSESSED"]).default("NOT_ASSESSED"),
  evidence: z.string().optional(),
  nextReviewDate: z.string().optional(),
});
