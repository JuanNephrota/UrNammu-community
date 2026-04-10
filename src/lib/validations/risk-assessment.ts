import { z } from "zod";

export const createRiskAssessmentSchema = z.object({
  aiSystemId: z.string().min(1, "AI System is required"),
  biasScore: z.number().min(0).max(100).default(0),
  securityScore: z.number().min(0).max(100).default(0),
  privacyScore: z.number().min(0).max(100).default(0),
  fairnessScore: z.number().min(0).max(100).default(0),
  performanceScore: z.number().min(0).max(100).default(0),
  transparencyScore: z.number().min(0).max(100).default(0),
  justifications: z.object({
    biasScore: z.string().optional(),
    securityScore: z.string().optional(),
    privacyScore: z.string().optional(),
    fairnessScore: z.string().optional(),
    performanceScore: z.string().optional(),
    transparencyScore: z.string().optional(),
  }).optional(),
  notes: z.string().optional(),
});

export type CreateRiskAssessmentInput = z.infer<typeof createRiskAssessmentSchema>;
