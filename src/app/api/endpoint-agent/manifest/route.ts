import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice, buildDetectionManifest, touchDevice } from "@/lib/endpoint-agent";

/**
 * GET /api/endpoint-agent/manifest
 *
 * The detection filter the agent applies locally: AI hostnames, app-name
 * substrings, local-runtime ports, and the report cadence. Compiled from
 * `ai-tools-registry`, so growing the registry improves every deployed agent
 * without an agent release.
 *
 * Device-authenticated. The manifest is not secret in any strong sense — it is
 * derived from a public tools list — but gating it on a device token keeps the
 * org's collector configuration off the open internet and gives revocation a
 * second place to bite.
 *
 * Supports `If-None-Match`: the agent sends the version it holds and gets 304
 * when nothing changed, which is the common case on an hourly poll.
 */
export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const device = await authenticateDevice(token);
  if (!device) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await touchDevice(device.id);

  const manifest = await buildDetectionManifest();
  const etag = `"${manifest.version}"`;

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return NextResponse.json(manifest, {
    status: 200,
    headers: { ETag: etag, "Cache-Control": "no-cache" },
  });
}
