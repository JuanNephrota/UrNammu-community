import { NextRequest, NextResponse } from "next/server";
import { runScheduledMaintenance } from "@/lib/background-jobs";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runScheduledMaintenance();
  return NextResponse.json(result);
}
