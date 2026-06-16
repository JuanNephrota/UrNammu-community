import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { serializeRegistry } from "@/lib/reports/data-sources";

export const dynamic = "force-dynamic";

// GET /api/reports/schema — the data-source registry (sources, columns,
// filter/group capability, enum options) consumed by the builder UI.
export async function GET() {
  return withAuth(async () => {
    return NextResponse.json({ sources: serializeRegistry() });
  });
}
