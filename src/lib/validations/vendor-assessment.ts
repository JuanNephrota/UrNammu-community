import { z } from "zod";

const answerSchema = z.object({
  value: z.enum(["yes", "partial", "no", "unknown", "na"]),
  note: z.string().trim().max(2000).optional(),
});

export const startVendorAssessmentSchema = z.object({
  vendorProfileId: z.string().min(1),
});

/** Answers from one questionnaire section, merged into the stored answers. */
export const saveVendorAssessmentAnswersSchema = z.object({
  answers: z.record(z.string().max(100), answerSchema),
});

export const completeVendorAssessmentSchema = z.object({
  decision: z.enum(["APPROVED", "CONDITIONAL", "REJECTED"]),
  decisionNotes: z.string().trim().max(5000).nullish(),
});
