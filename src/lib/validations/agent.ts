import { z } from "zod";

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
  humanReviewTriggers: z.any().optional(),
  riskLevel: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"]).default("MEDIUM"),
  status: z.enum(["DRAFT", "UNDER_REVIEW", "APPROVED", "DEPLOYED", "DEPRECATED", "RETIRED"]).default("DRAFT"),
  department: z.string().optional(),
});

export const updateAgentSchema = createAgentSchema.partial();

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
