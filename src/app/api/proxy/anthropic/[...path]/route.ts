import { NextRequest } from "next/server";
import { handleAnthropicProxy } from "@/lib/anthropic-proxy";

/**
 * Catch-all route for Anthropic API proxy.
 * Handles all paths under /api/proxy/anthropic/*, e.g.:
 *   - /api/proxy/anthropic/v1/messages
 *   - /api/proxy/anthropic/v1/messages/count_tokens
 *   - /api/proxy/anthropic/v1/messages/batches
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const subpath = "/" + path.join("/");
  return handleAnthropicProxy(req, subpath);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const subpath = "/" + path.join("/");
  return handleAnthropicProxy(req, subpath);
}
