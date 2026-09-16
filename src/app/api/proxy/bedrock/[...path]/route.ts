import { NextRequest } from "next/server";
import { handleBedrockProxy } from "@/lib/bedrock-proxy";

export const maxDuration = 300;

/**
 * Amazon Bedrock proxy (log only, v1): /api/proxy/bedrock/{*path} forwards
 *   POST /model/{modelId}/invoke
 *   POST /model/{modelId}/invoke-with-response-stream
 * to bedrock-runtime.{region}.amazonaws.com with the client's own
 * credentials (Bearer API key or SigV4). Point the SDK's `endpoint` at
 * `/api/proxy/bedrock` and send `x-aws-region`.
 */
type Params = { params: Promise<{ path: string[] }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { path } = await params;
  return handleBedrockProxy(req, "/" + path.join("/"));
}
