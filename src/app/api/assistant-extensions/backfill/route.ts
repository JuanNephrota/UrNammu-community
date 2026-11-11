import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { backfillAssistantExtensions } from "@/lib/assistant-extensions";

// A full history walk can take minutes; the handler stops at the time budget
// and returns a resume cursor, so a long backfill is several calls.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  client: z.enum(["claude_code", "cursor"]).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  resume: z
    .object({
      client: z.enum(["claude_code", "cursor"]),
      timestamp: z.coerce.date(),
      id: z.string(),
    })
    .nullable()
    .optional(),
  pageSize: z.number().int().min(100).max(5000).optional(),
});

/**
 * POST /api/assistant-extensions/backfill
 *
 * Rebuilds the extension inventory from stored ClaudeCodeEvent and CursorSpan
 * history. Observation counts are additive, so run it once per window (or
 * truncate AssistantExtension first). Returns `{ done, resume }`; call again
 * with `resume` until `done` is true.
 */
export async function POST(req: NextRequest) {
  return withRole(["ADMIN"], async (session) => {
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

    const result = await backfillAssistantExtensions({
      ...parsed.data,
      resume: parsed.data.resume ?? null,
      timeBudgetMs: 240_000,
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "BACKFILL",
      entityType: "AssistantExtension",
      entityId: parsed.data.client ?? "all",
      changes: {
        since: parsed.data.since?.toISOString() ?? null,
        until: parsed.data.until?.toISOString() ?? null,
        scanned: result.scanned,
        rows: result.rows,
        done: result.done,
      },
    });

    return NextResponse.json(result);
  });
}
