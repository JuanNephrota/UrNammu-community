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
  // Prefer the downloaded Forge content — that's the authoritative
  // description once we've pulled it. Fall back to a metadata blurb when
  // content isn't available yet (non-text files, large files, or a
  // content-fetch that hasn't run yet).
  if (skill.content && skill.content.trim().length > 0) {
    return skill.content;
  }
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
 * Map a Forge `author.name` to an existing User row (case-insensitive name
 * match). Returns null when there's no match — callers then fall back to
 * the Forge Sync Bot so we never create a row with a missing owner.
 */
async function resolveAuthorOwnerId(
  authorName: string | null | undefined
): Promise<string | null> {
  if (!authorName) return null;
  const trimmed = authorName.trim();
  if (!trimmed) return null;
  const match = await prisma.user.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true },
  });
  return match?.id ?? null;
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

  // Prefer the skill's author as the owner; fall back to the Forge Sync
  // Bot when we can't resolve them to a local User row.
  const authorOwnerId = await resolveAuthorOwnerId(skill.authorName);
  const ownerId = authorOwnerId ?? (await getForgeBotUserId());
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
