import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";
import { ingestDiscoveredToolEntries, type LogEntry } from "@/lib/discovered-tools-ingest";

async function requireNetskopeAuth(req: NextRequest): Promise<boolean> {
  const proxySecret = (await getSetting("proxy_secret")) ?? process.env.PROXY_SECRET;
  if (!proxySecret) return false;

  const proxyKey = req.headers.get("x-proxy-key");
  if (proxyKey === proxySecret) return true;

  // Netskope log shipper uses Authorization: Bearer <token>
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ") && authHeader.slice(7) === proxySecret) return true;

  return false;
}

// Fields the Netskope log shipper may include in page/application/alert events.
type NetskopeEvent = {
  // Domain — in priority order
  hostname?: string;
  dstdomain?: string;
  dst_hostname?: string;
  url?: string;
  // User
  user?: string;
  userkey?: string;
  // Department / org unit
  organization_unit?: string;
  // Hit count for this event record
  count?: number;
};

function parseNetskopeBody(body: unknown): NetskopeEvent[] {
  if (Array.isArray(body)) return body as NetskopeEvent[];

  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    // Standard Netskope log shipper envelope: { "data": [...] }
    if (Array.isArray(obj.data)) return obj.data as NetskopeEvent[];
    // Single event object
    return [obj as NetskopeEvent];
  }

  return [];
}

function extractDomain(event: NetskopeEvent): string | null {
  const raw = event.hostname ?? event.dstdomain ?? event.dst_hostname;
  if (raw) return raw.trim().toLowerCase().replace(/\.$/, "") || null;

  if (event.url) {
    try {
      return new URL(event.url).hostname.toLowerCase();
    } catch {
      const stripped = event.url.trim().toLowerCase().replace(/\.$/, "");
      return stripped || null;
    }
  }

  return null;
}

function toLogEntries(events: NetskopeEvent[]): LogEntry[] {
  const entries: LogEntry[] = [];

  for (const event of events) {
    const domain = extractDomain(event);
    if (!domain) continue;

    entries.push({
      domain,
      user: event.user?.trim() || event.userkey?.trim() || undefined,
      department: event.organization_unit?.trim() || undefined,
      count: typeof event.count === "number" && event.count > 0 ? event.count : 1,
    });
  }

  return entries;
}

export async function POST(req: NextRequest) {
  if (!(await requireNetskopeAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const events = parseNetskopeBody(body);
  const entries = toLogEntries(events);

  if (entries.length === 0) {
    return NextResponse.json(
      { error: "No parseable log events found in payload" },
      { status: 400 }
    );
  }

  const result = await ingestDiscoveredToolEntries({
    source: "netskope",
    entries,
    inputType: "json",
    triggeredByUserId: null,
  });

  return NextResponse.json(result);
}
