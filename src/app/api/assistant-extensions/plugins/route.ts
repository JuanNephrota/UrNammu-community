import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { fetchPluginContent, listPluginContent } from "@/lib/plugin-content";

// Marketplace fetches are a few GitHub calls per plugin; the handler stops at
// its time budget and reports `done: false` so the caller can run it again.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const FETCH_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];

/** GET /api/assistant-extensions/plugins — every plugin whose content has been fetched or attempted. */
export async function GET() {
  return withAuth(async () => NextResponse.json({ plugins: await listPluginContent() }));
}

const fetchSchema = z.object({
  plugins: z
    .array(z.object({ marketplace: z.string().min(1).max(200), plugin: z.string().min(1).max(200) }))
    .max(500)
    .optional(),
  force: z.boolean().optional(),
});

/**
 * POST /api/assistant-extensions/plugins — fetch (or refresh) plugin content
 * from the marketplaces' GitHub sources. With no body, every named plugin
 * the inventory has seen is fetched; plugins whose pinned commit has not
 * moved are reported as `unchanged` without re-reading their files.
 */
export async function POST(req: NextRequest) {
  return withRole(FETCH_ROLES, async (session) => {
    let raw: unknown = {};
    try {
      const text = await req.text();
      raw = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = fetchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }

    const result = await fetchPluginContent({ ...parsed.data, timeBudgetMs: 240_000 });

    await createAuditLog({
      userId: session.user.userId,
      action: "FETCH",
      entityType: "PluginContent",
      entityId: parsed.data.plugins?.length === 1 ? `${parsed.data.plugins[0].marketplace}/${parsed.data.plugins[0].plugin}` : "all",
      changes: {
        requested: parsed.data.plugins?.length ?? null,
        force: parsed.data.force ?? false,
        done: result.done,
        outcomes: result.outcomes.reduce<Record<string, number>>((acc, o) => {
          acc[o.status] = (acc[o.status] ?? 0) + 1;
          return acc;
        }, {}),
        skippedMarketplaces: result.skippedMarketplaces.map((s) => s.marketplace),
      },
    });

    return NextResponse.json(result);
  });
}
