import { z } from "zod";

export const createAISystemSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().optional(),
  version: z.string().optional(),
  department: z.string().min(1, "Department is required"),
  riskLevel: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"]).default("MEDIUM"),
  status: z.enum(["DRAFT", "UNDER_REVIEW", "APPROVED", "DEPLOYED", "DEPRECATED", "RETIRED"]).default("DRAFT"),
  useCase: z.string().optional(),
  dataSensitivity: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]).default("INTERNAL"),
  vendor: z.string().optional(),
  modelType: z.string().optional(),
  dataInputs: z.string().optional(),
  dataOutputs: z.string().optional(),
});

export const updateAISystemSchema = createAISystemSchema.partial();

export type CreateAISystemInput = z.infer<typeof createAISystemSchema>;
export type UpdateAISystemInput = z.infer<typeof updateAISystemSchema>;
