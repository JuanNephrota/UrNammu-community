import { NextRequest } from "next/server";
import { handleOpenAIProxy } from "@/lib/openai-proxy";

export const maxDuration = 300;

/**
 * Root proxy route — POST /api/proxy/openai is Chat Completions, for clients
 * that POST the proxy root directly. Every other path (`/v1/responses`,
 * `/v1/embeddings`, …) is served by the `[...path]` catch-all.
 */
export async function POST(req: NextRequest) {
  return handleOpenAIProxy(req, "/v1/chat/completions", "openai");
}
