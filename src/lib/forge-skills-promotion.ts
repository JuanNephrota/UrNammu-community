/**
 * Auto-promotion of Forge AI Skills into the governed registries:
 *
 *   content_type = "agent"                      → AIAgent
 *   content_type = "app" | "agent-system"       → AISystem
 *   anything else                               → stays catalog-only
 *
 * One-way sync: if a skill is already linked (linkedAgentId or
 * linkedSystemId set), we never overwrite the governed row. That lets
 * operators edit the promoted system/agent after the fact without
 * worrying about Forge clobbering their changes on the next sync.
 *
 * Ownership: all auto-created rows are attributed to a synthetic
 * "Forge Sync Bot" User. Looked up (or created) lazily on first need,
 * cached per process. The bot has role=VIEWER — it owns records but
 * can't do anything else in the app.
 */

import type { AISkill } from "@prisma/client";
import { prisma } from "./prisma";

const FORGE_BOT_EMAIL = "forge-sync@urnammu.internal";
const FORGE_BOT_NAME = "Forge Sync Bot";

let cachedBotId: string | null = null;

async function getForgeBotUserId(): Promise<string> {
  if (cachedBotId) return cachedBotId;
  const existing = await prisma.user.findUnique({
    where: { email: FORGE_BOT_EMAIL },
    select: { id: true },
  });
  if (existing) {
    cachedBotId = existing.id;
    return existing.id;
  }
  const created = await prisma.user.create({
    data: {
      email: FORGE_BOT_EMAIL,
      name: FORGE_BOT_NAME,
      role: "VIEWER",
      department: "Forge",
    },
    select: { id: true },
  });
  cachedBotId = created.id;
  return created.id;
}

function normalizeType(contentType: string): "agent" | "system" | null {
  const lower = contentType.toLowerCase().trim();
  if (lower === "agent") return "agent";
  // Forge uses `agent_system` (underscore); accept the hyphen form too in
  // case the API wording evolves.
  if (lower === "app" || lower === "agent_system" || lower === "agent-system") {
    return "system";
  }
  return null;
}

function buildDescription(skill: AISkill): string {
  const lines = [
    `Auto-created from CertifID Forge skill "${skill.name}".`,
    `Forge ID: ${skill.forgeId}`,
  ];
  if (skill.authorName) lines.push(`Author: ${skill.authorName}`);
  if (skill.departmentName) lines.push(`Department: ${skill.departmentName}`);
  if (skill.categoryName) lines.push(`Category: ${skill.categoryName}`);
  if (skill.tags.length) lines.push(`Tags: ${skill.tags.join(", ")}`);
  if (skill.appUrl) lines.push(`App URL: ${skill.appUrl}`);
  return lines.join("\n");
}

/**
 * Ensure the skill has the right governance row linked. No-op if already
 * linked or if the skill's contentType doesn't promote.
 */
export async function promoteSkill(skill: AISkill): Promise<
  | { action: "skipped"; reason: string }
  | { action: "linked_agent"; agentId: string }
  | { action: "linked_system"; systemId: string }
> {
  const target = normalizeType(skill.contentType);
  if (!target) {
    return { action: "skipped", reason: `contentType "${skill.contentType}" is not promotable` };
  }
  if (target === "agent" && skill.linkedAgentId) {
    return { action: "skipped", reason: "already linked to an agent" };
  }
  if (target === "system" && skill.linkedSystemId) {
    return { action: "skipped", reason: "already linked to a system" };
  }

  const ownerId = await getForgeBotUserId();
  const department = skill.departmentName ?? "Forge";

  if (target === "agent") {
    const agent = await prisma.aIAgent.create({
      data: {
        name: skill.name,
        description: buildDescription(skill),
        ownerId,
        department,
        // AIAgent.capabilities is Json defaulting to "[]"; include tags as
        // a capability-hint array so downstream filters can lean on them.
        capabilities: skill.tags.length ? skill.tags : [],
        autonomyLevel: "HUMAN_IN_THE_LOOP",
        status: "DRAFT",
        riskLevel: "MEDIUM",
        humanReviewRequired: true,
      },
      select: { id: true },
    });
    await prisma.aISkill.update({
      where: { id: skill.id },
      data: { linkedAgentId: agent.id },
    });
    return { action: "linked_agent", agentId: agent.id };
  }

  // target === "system"
  const system = await prisma.aISystem.create({
    data: {
      name: skill.name,
      description: buildDescription(skill),
      ownerId,
      department,
      vendor: "CertifID Forge",
      modelType: skill.contentType, // "app" | "agent-system"
      dataSensitivity: "INTERNAL",
      riskLevel: "MEDIUM",
      status: "DRAFT",
      reviewIntervalDays: 365,
    },
    select: { id: true },
  });
  await prisma.aISkill.update({
    where: { id: skill.id },
    data: { linkedSystemId: system.id },
  });
  return { action: "linked_system", systemId: system.id };
}
