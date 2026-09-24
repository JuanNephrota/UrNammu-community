import { z } from "zod";

// Transform empty strings to undefined so optional fields pass validation
const optionalString = z.string().optional().transform((v) => v?.trim() || undefined);

// For updates: a missing key leaves the column alone, while an explicit empty
// string clears it (null). Without this, a field could never be cleared.
const clearableString = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v.trim() || null));

const riskLevel = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"]);
const status = z.enum(["DRAFT", "UNDER_REVIEW", "APPROVED", "DEPLOYED", "DEPRECATED", "RETIRED"]);
const dataSensitivity = z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);
const reviewIntervalDays = z.coerce.number().int().min(1).max(730);

export const createAISystemSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: optionalString,
  version: optionalString,
  department: z.string().min(1, "Department is required"),
  riskLevel: riskLevel.default("MEDIUM"),
  status: status.default("DRAFT"),
  useCase: optionalString,
  dataSensitivity: dataSensitivity.default("INTERNAL"),
  vendor: optionalString,
  modelType: optionalString,
  dataInputs: optionalString,
  dataOutputs: optionalString,
  reviewIntervalDays: reviewIntervalDays.default(365),
  nextReviewDate: optionalString,
  requireOwnerApproval: z.boolean().default(true),
  requireSecurityApproval: z.boolean().default(true),
  requireLegalApproval: z.boolean().default(false),
  requireComplianceApproval: z.boolean().default(true),
});

// Deliberately not `createAISystemSchema.partial()`: Zod 4 still applies
// `.default()` inside `.optional()`, so a partial update carrying only
// `{ vendor }` would silently reset risk level, status and approval stages.
export const updateAISystemSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    description: clearableString,
    version: clearableString,
    department: z.string().trim().min(1, "Department is required"),
    riskLevel,
    status,
    useCase: clearableString,
    dataSensitivity,
    vendor: clearableString,
    modelType: clearableString,
    dataInputs: clearableString,
    dataOutputs: clearableString,
    reviewIntervalDays,
    nextReviewDate: optionalString,
    requireOwnerApproval: z.boolean(),
    requireSecurityApproval: z.boolean(),
    requireLegalApproval: z.boolean(),
    requireComplianceApproval: z.boolean(),
  })
  .partial();

export type CreateAISystemInput = z.infer<typeof createAISystemSchema>;
export type UpdateAISystemInput = z.infer<typeof updateAISystemSchema>;
