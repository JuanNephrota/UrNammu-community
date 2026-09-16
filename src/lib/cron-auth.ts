import { NextResponse } from "next/server";
import { bearerTokenMatches } from "./secret-compare";

/**
 * Shared guard for the `/api/cron/**` routes. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is rejected. Returns the
 * 401 response to send, or null when the request is authorized.
 */
export function unauthorizedCronResponse(req: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !bearerTokenMatches(req.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
