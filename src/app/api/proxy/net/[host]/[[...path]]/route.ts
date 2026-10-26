import { NextRequest } from "next/server";
import { handleNetworkProxy } from "@/lib/network-proxy";

// Allow long-lived upstreams (downloads, slow APIs).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * General network proxy: /api/proxy/net/{host}/{*path} forwards to
 * https://{host}/{path} after evaluating the URL block rules. Point an
 * HTTP client's base URL at `/api/proxy/net/<host>` and send the usual
 * `x-proxy-key` (plus optional attribution headers). See lib/network-proxy.ts.
 */
type Params = { params: Promise<{ host: string; path?: string[] }> };

async function handle(req: NextRequest, { params }: Params) {
  const { host, path } = await params;
  return handleNetworkProxy(req, host, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
