import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getPluginContent } from "@/lib/plugin-content";

export const dynamic = "force-dynamic";

/** GET /api/assistant-extensions/plugins/[id] — one plugin's manifest and files. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await params;
    const content = await getPluginContent(id);
    if (!content) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(content);
  });
}
