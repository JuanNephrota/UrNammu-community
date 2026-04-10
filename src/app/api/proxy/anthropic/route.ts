import { NextRequest } from "next/server";
import { handleAnthropicProxy } from "@/lib/anthropic-proxy";

/**
 * Root proxy route — handles POST /api/proxy/anthropic
 * (for clients that POST directly without /v1/messages path)
 */
export async function POST(req: NextRequest) {
  return handleAnthropicProxy(req, "/v1/messages");
}
