import { z } from "zod";
import { validatePattern } from "../network-rules";

const patternSchema = z
  .string()
  .trim()
  .min(1, "Pattern is required")
  .max(512)
  .superRefine((value, ctx) => {
    const problem = validatePattern(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export const createNetworkRuleSchema = z.object({
  pattern: patternSchema,
  action: z.enum(["BLOCK", "ALLOW"]).default("BLOCK"),
  enabled: z.boolean().default(true),
  reason: z.string().trim().max(500).nullish(),
});

export const updateNetworkRuleSchema = z
  .object({
    pattern: patternSchema,
    action: z.enum(["BLOCK", "ALLOW"]),
    enabled: z.boolean(),
    reason: z.string().trim().max(500).nullish(),
  })
  .partial();

export type CreateNetworkRuleInput = z.infer<typeof createNetworkRuleSchema>;
