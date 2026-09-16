import { app } from "@azure/functions";
import { createOpenAIProxyHandler } from "../lib/openai-handler";

/**
 * OpenAI proxy — path-based. Point the SDK's `baseURL` at
 * `https://<function-app>.azurewebsites.net/api/proxy/openai/v1`; any `/v1/*`
 * path is forwarded (chat completions, responses, embeddings, images, …).
 * The bare root still accepts a Chat Completions POST for older clients.
 */
const handler = createOpenAIProxyHandler("openai");

app.http("openai-proxy", {
  methods: ["GET", "POST", "DELETE"],
  authLevel: "anonymous",
  route: "proxy/openai/{*path}",
  handler,
});

app.http("openai-proxy-root", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "proxy/openai",
  handler,
});
