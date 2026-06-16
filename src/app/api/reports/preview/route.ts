import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { runReportQuery } from "@/lib/reports/query";
import { reportConfigSchema, DATA_SOURCE_VALUES } from "@/lib/validations/report";
import { z } from "zod";
import type { ReportDataSourceKey } from "@/lib/reports/types";

export const dynamic = "force-dynamic";

const PREVIEW_ROW_CAP = 200;

const previewSchema = z.object({
  dataSource: z.enum(DATA_SOURCE_VALUES),
  config: reportConfigSchema,
});

// POST /api/reports/preview — run a (possibly unsaved) report config and
// return a capped JSON result. Powers the builder's live preview and the
// saved-report detail view.
export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json().catch(() => ({}));
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    try {
      const result = await runReportQuery(
        parsed.data.dataSource as ReportDataSourceKey,
        parsed.data.config,
        { rowLimit: PREVIEW_ROW_CAP }
      );
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
