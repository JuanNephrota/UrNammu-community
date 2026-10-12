import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";

const ruleSchema = z.object({
  /** MCP server name or glob; `*` any server, `-` only tools without a server. */
  server: z.string().trim().min(1).max(200).default("*"),
  tool: z.string().trim().min(1).max(200),
  access: z.enum(["read", "write", "admin"]),
  system: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(5000).optional(),
});

const include = { createdBy: { select: { name: true, email: true } } } as const;

/** GET /api/tool-classifications — every org-wide tool classification rule. */
export async function GET() {
  return withAuth(async () => {
    const rules = await prisma.toolClassification.findMany({ orderBy: [{ server: "asc" }, { tool: "asc" }], include });
    return NextResponse.json(rules);
  });
}

/**
 * POST /api/tool-classifications   Body: { server?, tool, access, system?, notes? }
 *
 * Creates or replaces the rule for (server, tool). Both proxies apply it to
 * every agent within their cache window (about a minute). Patterns use the
 * same glob grammar as the MCP allowlists; the most specific rule wins.
 */
export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const parsed = ruleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const { server, tool, access } = parsed.data;
    const data = {
      access,
      system: parsed.data.system || null,
      notes: parsed.data.notes || null,
      createdById: session.user.userId,
    };
    const rule = await prisma.toolClassification.upsert({
      where: { server_tool: { server, tool } },
      update: data,
      create: { server, tool, ...data },
      include,
    });
    await createAuditLog({
      userId: session.user.userId,
      action: "CLASSIFY",
      entityType: "ToolClassification",
      entityId: rule.id,
      changes: { server, tool, access, system: data.system },
    });
    return NextResponse.json(rule, { status: 201 });
  });
}
