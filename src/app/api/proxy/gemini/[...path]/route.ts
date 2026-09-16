import { NextRequest } from "next/server";
import { handleGeminiProxy } from "@/lib/gemini-proxy";

export const maxDuration = 300;

/**
 * Gemini proxy: /api/proxy/gemini/{*path} forwards to
 * generativelanguage.googleapis.com, e.g.
 *   POST /api/proxy/gemini/v1beta/models/gemini-2.5-pro:generateContent
 *   POST /api/proxy/gemini/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse
 * Point the SDK's base URL at `/api/proxy/gemini` and keep `x-goog-api-key`.
 */
type Params = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, { params }: Params) {
  const { path } = await params;
  return handleGeminiProxy(req, "/" + path.join("/"));
}

export const POST = handle;
export const GET = handle;
