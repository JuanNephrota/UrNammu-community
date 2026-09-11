import { z } from "zod";

const idList = z.array(z.string().min(1).max(64)).max(20).default([]);

export const euAiActAnswersSchema = z.object({
  role: z.enum(["PROVIDER", "DEPLOYER", "PROVIDER_AND_DEPLOYER"]),
  prohibitedPractices: idList,
  annexIProduct: z.boolean(),
  annexIIICategories: idList,
  derogationGrounds: idList,
  profiling: z.boolean().nullable().default(null),
  transparencyTriggers: idList,
  usesGpai: z.boolean(),
  providesGpai: z.boolean().nullable().default(false),
  friaTriggers: idList,
});

/** Body for POST /api/ai-systems/[id]/eu-ai-act. The server re-derives the tier. */
export const saveEuAiActClassificationSchema = z.object({
  answers: euAiActAnswersSchema,
  notes: z.string().trim().max(5000).optional().nullable(),
  reviewDueAt: z.string().datetime().optional().nullable(),
});

export type SaveEuAiActClassificationInput = z.infer<typeof saveEuAiActClassificationSchema>;
