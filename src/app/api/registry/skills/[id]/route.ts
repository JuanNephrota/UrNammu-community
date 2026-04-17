import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import {
  AI_SKILL_OVERRIDE_FIELDS,
  type AISkillOverrideField,
  updateAISkillSchema,
} from "@/lib/validations/ai-skill";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    const { id } = await params;
    const skill = await prisma.aISkill.findUnique({
      where: { id },
      include: {
        linkedSystem: { select: { id: true, name: true } },
        linkedAgent: { select: { id: true, name: true } },
      },
    });
    if (!skill) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(skill);
  });
}

// "Blank" means the user is handing the field back to Forge: next sync
// can repopulate it. Empty string, null, and empty array all count.
function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function stringEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    v == null ? "" : typeof v === "string" ? v : String(v);
  return norm(a) === norm(b);
}

function stringArrayEqual(a: unknown, b: unknown): boolean {
  const arrA = Array.isArray(a) ? a.map(String) : [];
  const arrB = Array.isArray(b) ? b.map(String) : [];
  if (arrA.length !== arrB.length) return false;
  return arrA.every((v, i) => v === arrB[i]);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateAISkillSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.aISkill.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Recompute localOverrides: every tracked field the user submitted
    // with a non-blank value becomes locked; any field they blanked out
    // gets handed back to Forge. Untouched fields keep their prior state.
    const overrides = new Set<AISkillOverrideField>(
      existing.localOverrides.filter((f): f is AISkillOverrideField =>
        (AI_SKILL_OVERRIDE_FIELDS as readonly string[]).includes(f)
      )
    );

    const updateData: Record<string, unknown> = {};

    for (const field of AI_SKILL_OVERRIDE_FIELDS) {
      if (!(field in parsed.data)) continue;
      const value = parsed.data[field];
      const currentValue = existing[field];

      if (isBlank(value)) {
        // Hand the field back to Forge on next sync.
        overrides.delete(field);
        updateData[field] = field === "tags" ? [] : null;
        continue;
      }

      const unchanged =
        field === "tags"
          ? stringArrayEqual(value, currentValue)
          : stringEqual(value, currentValue);

      if (unchanged) {
        // Idempotent re-save of the same value — don't promote the field
        // to a local override. Fields that were already overridden stay
        // overridden (we don't touch `overrides`).
        continue;
      }

      // Real user edit — lock the field.
      overrides.add(field);
      updateData[field] = value;
    }

    // Linkage (not Forge-synced, no override tracking).
    if ("linkedAgentId" in parsed.data) {
      updateData.linkedAgentId = parsed.data.linkedAgentId?.trim()
        ? parsed.data.linkedAgentId
        : null;
    }
    if ("linkedSystemId" in parsed.data) {
      updateData.linkedSystemId = parsed.data.linkedSystemId?.trim()
        ? parsed.data.linkedSystemId
        : null;
    }

    updateData.localOverrides = Array.from(overrides);

    const updated = await prisma.aISkill.update({
      where: { id },
      data: updateData,
      include: {
        linkedSystem: { select: { id: true, name: true } },
        linkedAgent: { select: { id: true, name: true } },
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "AISkill",
      entityId: updated.id,
      changes: JSON.parse(JSON.stringify({ before: existing, after: updated })),
    });

    return NextResponse.json(updated);
  });
}
