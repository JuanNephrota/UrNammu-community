import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSession } from "@/lib/auth-guard";
import { getSetting } from "@/lib/settings";
import {
  ingestThirdPartyProxyTelemetry,
  parseThirdPartyProxyTelemetryPayload,
} from "@/lib/third-party-proxy-ingest";

async function requireIngestAuth(req: NextRequest) {
  const proxyKey = req.headers.get("x-proxy-key");
  const proxySecret =
    (await getSetting("proxy_secret")) ?? process.env.PROXY_SECRET;

  const hasProxyKey = proxySecret && proxyKey === proxySecret;
  if (hasProxyKey) return { triggeredByUserId: null };

  const session = await getSession();
  if (!session || !["ADMIN", "COMPLIANCE_OFFICER"].includes(session.user.role)) {
    return null;
  }

  return { triggeredByUserId: session.user.userId };
}

export async function POST(req: NextRequest) {
  const auth = await requireIngestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const payload = parseThirdPartyProxyTelemetryPayload(body);
    const result = await ingestThirdPartyProxyTelemetry({
      source: payload.source,
      entries: payload.entries,
      triggeredByUserId: auth.triggeredByUserId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid proxy telemetry payload",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to ingest proxy telemetry",
      },
      { status: 500 },
    );
  }
}
