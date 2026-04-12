import { z } from "zod";

// Transform empty strings to undefined so optional fields pass validation
const optionalString = z.string().optional().transform((v) => v?.trim() || undefined);

export const createAISystemSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: optionalString,
  version: optionalString,
  department: z.string().min(1, "Department is required"),
  riskLevel: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"]).default("MEDIUM"),
  status: z.enum(["DRAFT", "UNDER_REVIEW", "APPROVED", "DEPLOYED", "DEPRECATED", "RETIRED"]).default("DRAFT"),
  useCase: optionalString,
  dataSensitivity: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]).default("INTERNAL"),
  vendor: optionalString,
  modelType: optionalString,
  dataInputs: optionalString,
  dataOutputs: optionalString,
  reviewIntervalDays: z.coerce.number().int().min(1).max(730).default(365),
  nextReviewDate: optionalString,
  requireOwnerApproval: z.boolean().default(true),
  requireSecurityApproval: z.boolean().default(true),
  requireLegalApproval: z.boolean().default(false),
  requireComplianceApproval: z.boolean().default(true),
});

export const updateAISystemSchema = createAISystemSchema.partial();

export type CreateAISystemInput = z.infer<typeof createAISystemSchema>;
export type UpdateAISystemInput = z.infer<typeof updateAISystemSchema>;
