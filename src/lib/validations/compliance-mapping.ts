import { z } from "zod";

export const complianceStatusSchema = z.enum([
  "COMPLIANT",
  "PARTIALLY_COMPLIANT",
  "NON_COMPLIANT",
  "NOT_ASSESSED",
]);

/** Body for PUT /api/ai-systems/[id]/control-mappings — one control per call. */
export const upsertControlMappingSchema = z.object({
  controlId: z.string().min(1),
  status: complianceStatusSchema,
  evidence: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

export type UpsertControlMappingInput = z.infer<typeof upsertControlMappingSchema>;

export const catalogFrameworkSchema = z.enum(["EU_AI_ACT", "NIST_AI_RMF", "ISO_42001", "SOC2"]);
