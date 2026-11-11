import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { markPluginContentReviewed } from "@/lib/plugin-content";

export const dynamic = "force-dynamic";

const REVIEW_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];

const bodySchema = z.object({
  note: z.string().max(2000).optional(),
});

/**
 * POST /api/assistant-extensions/plugins/[id]/review — record that the
 * currently fetched content was reviewed. The row remembers which content
 * hash was signed off, so a later change shows as needing review again.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRole(REVIEW_ROLES, async (session) => {
    const { id } = await params;
    let raw: unknown = {};
    try {
      const text = await req.text();
      raw = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }

    const reviewer = session.user.email ?? session.user.name ?? session.user.userId;
    const row = await markPluginContentReviewed(id, reviewer, parsed.data.note?.trim() || null);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await createAuditLog({
      userId: session.user.userId,
      action: "REVIEW",
      entityType: "PluginContent",
      entityId: id,
      changes: { marketplace: row.marketplace, plugin: row.plugin, commitSha: row.commitSha, note: parsed.data.note ?? null },
    });

    return NextResponse.json(row);
  });
}
