import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";

const entrySchema = z.object({
  server: z.string().trim().min(1).max(200),
  tools: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
  label: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(5000).optional(),
});

const include = { approvedBy: { select: { name: true, email: true } } } as const;

/** GET /api/mcp-catalog — active org-approved MCP servers. */
export async function GET() {
  return withAuth(async () => {
    const entries = await prisma.mcpCatalogEntry.findMany({
      where: { active: true },
      orderBy: { server: "asc" },
      include,
    });
    return NextResponse.json(entries);
  });
}

/**
 * POST /api/mcp-catalog   Body: { server, tools?, label?, notes? }
 *
 * Approves a server (and optionally specific tools) for every agent that
 * inherits the catalog. Re-adding a server that was removed reactivates it
 * with the new details.
 */
export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const parsed = entrySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const data = {
      tools: parsed.data.tools,
      label: parsed.data.label || null,
      notes: parsed.data.notes || null,
      active: true,
      approvedById: session.user.userId,
    };
    const entry = await prisma.mcpCatalogEntry.upsert({
      where: { server: parsed.data.server },
      update: data,
      create: { server: parsed.data.server, ...data },
      include,
    });
    await createAuditLog({
      userId: session.user.userId,
      action: "APPROVE",
      entityType: "McpCatalogEntry",
      entityId: entry.id,
      changes: { server: entry.server, tools: entry.tools },
    });
    return NextResponse.json(entry, { status: 201 });
  });
}
