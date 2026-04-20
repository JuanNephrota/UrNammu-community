/**
 * Auto-promotion of Forge AI Skills into the governed registries:
 *
 *   content_type = "agent"                      → AIAgent
 *   content_type = "app" | "agent-system"       → AISystem
 *   anything else                               → stays catalog-only
 *
 * One-way sync with a narrow exception for descriptions: once a skill is
 * linked we never overwrite the governed row's fields, so operators can
 * edit freely without Forge clobbering them on the next sync. The one
 * exception is `description` — if the governed row's description still
 * starts with the auto-generated fallback marker, we refresh it on every
 * sync so late-arriving content (e.g. content fetched after the initial
 * promotion) replaces the boilerplate. Any manual edit removes the
 * marker and re-locks the row against further description updates.
 *
 * Ownership: all auto-created rows are attributed to a synthetic
 * "Forge Sync Bot" User. Looked up (or created) lazily on first need,
 * cached per process. The bot has role=VIEWER — it owns records but
 * can't do anything else in the app.
 */

import type { AISkill } from "@prisma/client";
import { prisma } from "./prisma";

// Prefix on every metadata-fallback description. Used both as the first
// line in buildDescription() and as the sentinel we look for when
// deciding whether a linked row's description is still auto-generated
// (and therefore safe to refresh). Do not translate or reword without
// updating the refresh check below.
const FALLBACK_DESCRIPTION_PREFIX = "Auto-created from CertifID Forge skill";

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
  // Priority order:
  //   1. Forge's `description` blurb — short, authoritative summary that
  //      every skill has (even zip bundles and external apps with no
  //      downloadable text body).
  //   2. Downloaded file content — the full body for text-type skills.
  //      Useful when the description is absent or empty.
  //   3. Metadata fallback — last-resort blurb for skills with neither.
  if (skill.description && skill.description.trim().length > 0) {
    return skill.description;
  }
  if (skill.content && skill.content.trim().length > 0) {
    return skill.content;
  }
  const lines = [
    `${FALLBACK_DESCRIPTION_PREFIX} "${skill.name}".`,
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
 * Refresh the governed row's description from the current skill state.
 * The skill's own `localOverrides` is the operator's lock: if "description"
 * is in that list, the skill record itself has been edited, and we should
 * not propagate Forge changes to the linked Agent/System. Otherwise we
 * keep the linked description in sync with Forge — including when the
 * upstream description changes, which the old "only refresh while the
 * auto-generated marker is present" rule failed to do.
 */
async function refreshLinkedDescriptionIfUntouched(
  target: "agent" | "system",
  linkedId: string,
  skill: AISkill
): Promise<void> {
  if (skill.localOverrides.includes("description")) return;

  const current =
    target === "agent"
      ? await prisma.aIAgent.findUnique({
          where: { id: linkedId },
          select: { description: true },
        })
      : await prisma.aISystem.findUnique({
          where: { id: linkedId },
          select: { description: true },
        });
  const currentDescription = current?.description ?? "";
  const next = buildDescription(skill);
  if (next === currentDescription) return;

  if (target === "agent") {
    await prisma.aIAgent.update({
      where: { id: linkedId },
      data: { description: next },
    });
  } else {
    await prisma.aISystem.update({
      where: { id: linkedId },
      data: { description: next },
    });
  }
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
    await refreshLinkedDescriptionIfUntouched("agent", skill.linkedAgentId, skill);
    return { action: "skipped", reason: "already linked to an agent" };
  }
  if (target === "system" && skill.linkedSystemId) {
    await refreshLinkedDescriptionIfUntouched("system", skill.linkedSystemId, skill);
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
