import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";

const bodySchema = z
  .object({
    serverName: z.string().trim().min(1).max(200).nullable().optional(),
    toolName: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .refine((b) => b.serverName || b.toolName, { message: "serverName or toolName is required" });

/**
 * POST /api/agents/[id]/mcp-allowlist
 * Body: { serverName?, toolName? }
 *
 * Adds an observed server and/or tool to the agent's allowlists. A tool with
 * a server becomes `server/tool`; a bare tool is allowed on any server. The
 * matching AgentToolProfile rows are flipped to approved so the card and the
 * oversight page reflect the decision immediately.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const agent = await prisma.aIAgent.findUnique({
      where: { id },
      select: { id: true, mcpServerAllowlist: true, mcpToolAllowlist: true },
    });
    if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { serverName, toolName } = parsed.data;
    const servers = new Set(agent.mcpServerAllowlist);
    const tools = new Set(agent.mcpToolAllowlist);
    const added: string[] = [];

    if (serverName && !servers.has(serverName)) {
      servers.add(serverName);
      added.push(`server:${serverName}`);
    }
    if (toolName) {
      const entry = serverName ? `${serverName}/${toolName}` : toolName;
      if (!tools.has(entry)) {
        tools.add(entry);
        added.push(`tool:${entry}`);
      }
    }

    const updated = await prisma.aIAgent.update({
      where: { id },
      data: { mcpServerAllowlist: Array.from(servers), mcpToolAllowlist: Array.from(tools) },
      select: { id: true, mcpServerAllowlist: true, mcpToolAllowlist: true },
    });

    await prisma.agentToolProfile.updateMany({
      where: {
        agentId: id,
        ...(toolName
          ? { toolName, ...(serverName ? { serverKey: serverName } : {}) }
          : { serverKey: serverName ?? undefined, toolName: "*" }),
      },
      data: { approved: true },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "AIAgent",
      entityId: id,
      agentId: id,
      changes: { mcpAllowlistAdded: added },
    });

    return NextResponse.json(updated);
  });
}
