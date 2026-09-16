import { NextRequest } from "next/server";
import { handleOpenAIProxy } from "@/lib/openai-proxy";

// Allow longer execution for streaming responses
export const maxDuration = 300;

/**
 * Catch-all OpenAI proxy: /api/proxy/openai/{*path} forwards any `/v1/*`
 * path to api.openai.com. Point the SDK's `baseURL` at
 * `/api/proxy/openai/v1` (or the proxy root — a missing `/v1` is added).
 * Usage is read for chat/completions, completions, responses and embeddings;
 * everything else passes through with a 0-token row.
 */
type Params = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, { params }: Params) {
  const { path } = await params;
  return handleOpenAIProxy(req, "/" + path.join("/"), "openai");
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
