import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { getDirectorySyncStatuses } from "@/lib/background-jobs";
import {
  getDirectoryPeopleCounts,
  isDirectorySourceConfigured,
  runDirectorySync,
} from "@/lib/directory-sync";
import { DIRECTORY_SYNC_SOURCES, isDirectorySyncSource } from "@/lib/provider-sync-schedule";

// A manual sync walks the whole directory; match the cron budget.
export const maxDuration = 300;

/**
 * GET /api/directory-sync — schedule, last run, and people counts per
 * identity source, for the Users & Identity settings cards.
 */
export async function GET() {
  return withRole(["ADMIN"], async () => {
    const [statuses, counts] = await Promise.all([
      getDirectorySyncStatuses(),
      getDirectoryPeopleCounts(),
    ]);
    return NextResponse.json({
      sources: statuses.map((status) => ({ ...status, people: counts[status.source] })),
    });
  });
}

/**
 * POST /api/directory-sync { source } — run one source's directory sync now,
 * ignoring the enabled flag and interval (the manual button). Requires the
 * source's credentials to be configured.
 */
export async function POST(req: NextRequest) {
  return withRole(["ADMIN"], async (session) => {
    let source: string | undefined;
    try {
      const body = (await req.json()) as { source?: string };
      source = body.source;
    } catch {
      source = undefined;
    }

    if (!source || !isDirectorySyncSource(source)) {
      return NextResponse.json(
        { error: `Provide "source" as one of: ${DIRECTORY_SYNC_SOURCES.join(", ")}.` },
        { status: 400 }
      );
    }

    if (!(await isDirectorySourceConfigured(source))) {
      return NextResponse.json(
        {
          error: `${source === "google_workspace" ? "Google Workspace" : "Microsoft 365"} is not configured`,
          details:
            source === "google_workspace"
              ? "Add the service account key and admin email under Settings > Shadow AI, and grant the admin.directory.user.readonly scope to the service account."
              : "Add the tenant ID, client ID, and client secret under Settings > Shadow AI, and grant the Graph application permission User.Read.All.",
        },
        { status: 400 }
      );
    }

    const [status] = await getDirectorySyncStatuses([source]);
    if (status.running) {
      return NextResponse.json(
        { error: `A ${status.label} sync is already running.` },
        { status: 409 }
      );
    }

    const result = await runDirectorySync(source, session.user.userId);

    await createAuditLog({
      userId: session.user.userId,
      action: "SYNC",
      entityType: "Directory",
      entityId: result.syncRunId ?? source,
      changes: JSON.parse(JSON.stringify(result)),
    });

    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  });
}
