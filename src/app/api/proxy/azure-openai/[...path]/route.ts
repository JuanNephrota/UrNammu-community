import { NextRequest } from "next/server";
import { handleOpenAIProxy } from "@/lib/openai-proxy";

export const maxDuration = 300;

/**
 * Azure OpenAI proxy: /api/proxy/azure-openai/{*path} forwards
 * `/openai/deployments/{deployment}/…?api-version=…` (and `/openai/v1/…`) to
 * the configured resource endpoint (`azure_openai_endpoint` setting, or the
 * `x-azure-openai-resource` header) with the client's `api-key`. Point the
 * SDK's `endpoint` / `baseURL` at `/api/proxy/azure-openai`. Deployment names
 * map to model ids via the `azure_openai_deployments` setting for pricing.
 */
type Params = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, { params }: Params) {
  const { path } = await params;
  return handleOpenAIProxy(req, "/" + path.join("/"), "azure");
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
