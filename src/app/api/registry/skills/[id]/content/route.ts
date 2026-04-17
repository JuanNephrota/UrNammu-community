import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";
import {
  getForgeSkillContent,
  loadForgeConfig,
} from "@/lib/forge-skills-client";

/**
 * Proxy to the Forge /skills/{id}/content endpoint. Returns the short-
 * lived signed URL + metadata; the client fetches the bytes directly
 * (the signed URL needs no auth header).
 *
 * We intentionally do NOT stream file bytes through this server — that
 * would break the 15-minute-TTL contract and push storage cost onto us.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    const { id } = await params;

    const skill = await prisma.aISkill.findUnique({
      where: { id },
      select: { forgeId: true },
    });
    if (!skill) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const config = await loadForgeConfig();
    if (!config) {
      return NextResponse.json(
        { error: "Forge integration is not configured" },
        { status: 400 }
      );
    }

    try {
      const content = await getForgeSkillContent(config, skill.forgeId);
      return NextResponse.json(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  });
}
