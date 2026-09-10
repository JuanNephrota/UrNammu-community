import { NextRequest, NextResponse } from "next/server";
import { bearerTokenMatches } from "@/lib/secret-compare";
import { getSetting } from "@/lib/settings";
import { blockedDomains, parseFormat, serializeBlocklist } from "@/lib/shadow-blocklist";

/**
 * Denylist feed for external network controls (DNS sinkhole, proxy ACL,
 * firewall URL-list, CASB). Emits every BLOCKED discovery's domain so the
 * control can poll this endpoint and actually enforce the block — UrNammu
 * itself is not in the traffic path.
 *
 * Guarded by a Bearer token (the `shadow_ai_blocklist_token` setting, set in
 * Settings > Shadow AI, with `SHADOW_AI_BLOCKLIST_TOKEN` env fallback), matching
 * the Bearer-token pattern used by the cron routes. The feed exposes which AI
 * tools the org blocks, so it is not public.
 *
 * Formats (via `?format=`): `text` (default, bare domains), `hosts`
 * (`0.0.0.0 domain`), `json` (with metadata), `pac` (proxy auto-config).
 */
export async function GET(req: NextRequest) {
  const token = await getSetting("shadow_ai_blocklist_token");
  if (!token) {
    // Fail closed: without a configured token the feed would be unauthenticated.
    return NextResponse.json(
      { error: "Blocklist feed is not configured. Set a feed token in Settings > Shadow AI." },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!bearerTokenMatches(authHeader, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const format = parseFormat(new URL(req.url).searchParams.get("format"));
  const entries = await blockedDomains();
  const { body, contentType } = serializeBlocklist(entries, format);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      // Denylist contents change rarely; let pollers cache briefly but always
      // revalidate so an unblock propagates within the window.
      "cache-control": "public, max-age=60, must-revalidate",
      "x-blocklist-count": String(entries.length),
    },
  });
}
