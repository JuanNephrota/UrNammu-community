import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { syncForgeSkills } from "@/lib/forge-skills-sync";
import { createAuditLog } from "@/lib/audit";

/**
 * Manual sync — admin-only. See /api/cron/forge-skills-sync for the
 * scheduled path (CRON_SECRET-guarded).
 */
export async function POST(req: Request) {
  return withRole(["ADMIN"], async (session) => {
    const body = await req.json().catch(() => ({}));
    const fullResync = body?.fullResync === true;

    const result = await syncForgeSkills({
      trigger: "manual",
      triggeredByUserId: session.user.userId,
      fullResync,
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "SYNC",
      entityType: "AISkill",
      entityId: result.runId,
    });

    return NextResponse.json(result, {
      status: result.status === "succeeded" ? 200 : 502,
    });
  });
}
