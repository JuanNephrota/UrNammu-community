import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";
import { getSession } from "@/lib/auth-guard";
import { ingestDiscoveredToolEntries, type LogEntry } from "@/lib/discovered-tools-ingest";
import { prisma } from "@/lib/prisma";
import { secretsMatch } from "@/lib/secret-compare";

async function requireIngestAuth(req: NextRequest) {
  const proxyKey = req.headers.get("x-proxy-key");
  const proxySecret =
    (await getSetting("proxy_secret")) ?? process.env.PROXY_SECRET;

  if (secretsMatch(proxyKey, proxySecret)) return { triggeredByUserId: null };

  const session = await getSession();
  if (!session || !["ADMIN", "COMPLIANCE_OFFICER"].includes(session.user.role)) {
    return null;
  }

  return { triggeredByUserId: session.user.userId };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["ADMIN", "COMPLIANCE_OFFICER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const take = Math.min(Math.max(Number.parseInt(req.nextUrl.searchParams.get("take") ?? "20", 10) || 20, 1), 100);
  const runs = await prisma.ingestionRun.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: { triggeredByUser: { select: { name: true, email: true } } },
  });

  return NextResponse.json(runs);
}

export async function POST(req: NextRequest) {
  const auth = await requireIngestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const source = body.source ?? "dns_proxy";

  let entries: LogEntry[];
  if (body.domains && Array.isArray(body.domains)) {
    entries = body.domains.map((domain: string) => ({ domain }));
  } else if (body.entries && Array.isArray(body.entries)) {
    entries = body.entries;
  } else {
    return NextResponse.json(
      { error: "Request must include 'domains' (string[]) or 'entries' (object[])" },
      { status: 400 }
    );
  }

  const result = await ingestDiscoveredToolEntries({
    source,
    entries,
    inputType: "json",
    triggeredByUserId: auth.triggeredByUserId,
  });

  return NextResponse.json(result);
}
