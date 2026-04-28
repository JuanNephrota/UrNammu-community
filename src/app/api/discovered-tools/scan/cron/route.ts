import { NextRequest, NextResponse } from "next/server";
import { runScheduledMaintenance } from "@/lib/background-jobs";

export async function GET(req: NextRequest) {
  // Authenticate cron requests via Bearer token
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runScheduledMaintenance();
  return NextResponse.json(result);
}
