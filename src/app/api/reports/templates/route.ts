import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { REPORT_TEMPLATES } from "@/lib/reports/templates";

export const dynamic = "force-dynamic";

// GET /api/reports/templates — prebuilt report templates for the gallery.
export async function GET() {
  return withAuth(async () => {
    return NextResponse.json({ templates: REPORT_TEMPLATES });
  });
}
