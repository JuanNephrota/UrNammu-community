import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { DiscoveredAgentNotFoundError, registerDiscoveredAgent } from "@/lib/agent-discovery";

const registerSchema = z.object({
  /** Link to an agent already in the registry instead of creating one. */
  existingAgentId: z.string().min(1).nullish(),
});

// POST /api/discovered-agents/[id]/register — promote into the Agent Registry
// as a DRAFT agent (or link an existing one) and mark the discovery REGISTERED.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = registerSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    try {
      const result = await registerDiscoveredAgent({
        discoveredAgentId: id,
        userId: session.user.userId,
        existingAgentId: parsed.data.existingAgentId,
      });
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    } catch (err) {
      if (err instanceof DiscoveredAgentNotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      throw err;
    }
  });
}
