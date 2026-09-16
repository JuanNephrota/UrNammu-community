import { app } from "@azure/functions";
import { createOpenAIProxyHandler } from "../lib/openai-handler";

/**
 * Azure OpenAI proxy. Point the SDK's `endpoint` at
 * `https://<function-app>.azurewebsites.net/api/proxy/azure-openai`; the
 * deployment path and `api-version` query are forwarded to the resource
 * endpoint configured in Settings → Proxy Setup (`azure_openai_endpoint`,
 * or `AZURE_OPENAI_ENDPOINT` on the function app), with the client's
 * `api-key`. Deployment names price through `azure_openai_deployments`.
 */
app.http("azure-openai-proxy", {
  methods: ["GET", "POST", "DELETE"],
  authLevel: "anonymous",
  route: "proxy/azure-openai/{*path}",
  handler: createOpenAIProxyHandler("azure"),
});
