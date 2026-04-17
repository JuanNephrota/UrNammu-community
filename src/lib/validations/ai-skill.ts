import { z } from "zod";

// Fields that are editable on the AISkill edit form and tracked in
// `localOverrides` so Forge sync can't clobber them on re-fetch.
// Clearing a field (empty string / empty array) removes it from
// overrides, letting the next sync repopulate from Forge.
export const AI_SKILL_OVERRIDE_FIELDS = [
  "name",
  "content",
  "status",
  "tags",
  "categoryName",
  "departmentName",
  "authorName",
  "appUrl",
] as const;

export type AISkillOverrideField = (typeof AI_SKILL_OVERRIDE_FIELDS)[number];

export const updateAISkillSchema = z.object({
  name: z.string().max(200).optional(),
  content: z.string().optional(),
  status: z.string().max(40).optional(),
  tags: z.array(z.string().max(80)).optional(),
  categoryName: z.string().max(200).optional(),
  departmentName: z.string().max(200).optional(),
  authorName: z.string().max(200).optional(),
  appUrl: z.string().url().max(2048).optional().or(z.literal("")),
  // Linkage is local-only (not a Forge field), so no override tracking.
  // Pass empty string to detach.
  linkedAgentId: z.string().optional().or(z.literal("")),
  linkedSystemId: z.string().optional().or(z.literal("")),
});

export type UpdateAISkillInput = z.infer<typeof updateAISkillSchema>;
