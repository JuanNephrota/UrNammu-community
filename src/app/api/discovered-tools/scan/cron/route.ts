import { NextRequest, NextResponse } from "next/server";
import { isGoogleWorkspaceConfigured } from "@/lib/google-workspace";
import { executeScan } from "@/lib/scan-executor";

export async function GET(req: NextRequest) {
  // Authenticate cron requests via Bearer token
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isGoogleWorkspaceConfigured())) {
    return NextResponse.json(
      { error: "Google Workspace not configured" },
      { status: 400 }
    );
  }

  const result = await executeScan("system");

  return NextResponse.json(result);
}
