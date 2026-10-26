import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { lookup } from "dns/promises";
import { PassThrough, Readable } from "stream";
import { logNetworkRequest } from "../lib/db";
import { loadSetting } from "../lib/settings-loader";
import { loadNetworkRuleSet } from "../lib/network-loader";
import { authenticate, resolveAttribution, subpathOf } from "../lib/proxy-gate";
import {
  evaluateNetworkTarget,
  filterRequestHeaders,
  filterResponseHeaders,
  isForbiddenAddress,
  loggablePath,
  networkBlockedResponseBody,
  parseNetworkProxyMode,
  parseNetworkTarget,
  rewriteLocation,
  type NetworkLogAction,
  type NetworkVerdict,
} from "../lib/network-rules";

/**
 * General network proxy. `/api/proxy/net/{host}/{*path}` forwards to
 * `https://{host}/{path}` after checking the URL block rules (Settings →
 * Proxy Setup → Network Proxy) and the Shadow AI denylist, and writes one
 * `NetworkRequestLog` row per request. Bodies stream through untouched —
 * nothing is parsed or priced. Mirrors src/lib/network-proxy.ts in the app;
 * keep the two in step.
 *
 * Modes (`network_proxy_mode`, env `NETWORK_PROXY_MODE`): `off` refuses
 * everything (default), `monitor` logs would-be blocks and forwards,
 * `enforce` returns 403. Only https upstreams on public names are proxied;
 * non-public ranges are refused by name and after DNS resolution. Redirects
 * are rewritten back through the proxy rather than followed.
 */

const PROVIDER = "network";
const UPSTREAM_TIMEOUT_MS = 120_000;
const MAX_REQUEST_BODY_BYTES = 50 * 1024 * 1024;
const BODYLESS_STATUS = new Set([204, 205, 304]);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

type LogBase = {
  method: string;
  host: string;
  path: string;
  userEmail: string | null;
  department: string | null;
  aiSystemId: string | null;
  agentId: string | null;
  requestBytes: number;
  startedAt: number;
};

type LogOutcome = {
  action: NetworkLogAction;
  status?: number | null;
  ruleId?: string | null;
  rulePattern?: string | null;
  ruleSource?: string | null;
  reason?: string | null;
  responseBytes?: number | null;
};

function writeLog(base: LogBase, outcome: LogOutcome): Promise<void> {
  return logNetworkRequest({
    method: base.method,
    host: base.host,
    path: loggablePath(base.path),
    action: outcome.action,
    status: outcome.status ?? null,
    ruleId: outcome.ruleId ?? null,
    rulePattern: outcome.rulePattern ?? null,
    ruleSource: outcome.ruleSource ?? null,
    reason: outcome.reason ?? null,
    userEmail: base.userEmail,
    department: base.department,
    aiSystemId: base.aiSystemId,
    agentId: base.agentId,
    requestBytes: base.requestBytes,
    responseBytes: outcome.responseBytes ?? null,
    durationMs: Date.now() - base.startedAt,
  });
}

function verdictLogFields(verdict: NetworkVerdict): Pick<LogOutcome, "ruleId" | "rulePattern" | "ruleSource" | "reason"> {
  return {
    ruleId: verdict.rule?.id ?? null,
    rulePattern: verdict.rule?.pattern ?? verdict.shadowDomain ?? null,
    ruleSource: verdict.source,
    reason: verdict.rule?.reason ?? (verdict.source === "shadow_ai" ? "Blocked AI tool (Shadow AI)" : null),
  };
}

function errorJson(status: number, type: string, message: string): HttpResponseInit {
  return { status, jsonBody: { error: { type, message } } };
}

async function networkProxy(req: HttpRequest): Promise<HttpResponseInit> {
  const startedAt = Date.now();
  const authError = authenticate(req);
  if (authError) return authError;

  const mode = parseNetworkProxyMode(await loadSetting("network_proxy_mode", "NETWORK_PROXY_MODE"));
  if (mode === "off") {
    return errorJson(404, "network_proxy_disabled", "The network proxy is turned off. Enable it in Settings → Proxy Setup → Network Proxy.");
  }

  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const hostSegment = req.params?.host ?? "";
  const subpath = subpathOf(req, "/");
  const parsed = parseNetworkTarget(hostSegment, subpath, url.search);

  const { attribution, response: attributionResponse } = await resolveAttribution(req, PROVIDER);
  const base: LogBase = {
    method,
    host: parsed.ok ? parsed.target.host : hostSegment.toLowerCase().slice(0, 253),
    path: parsed.ok ? parsed.target.path : subpath,
    userEmail: attribution.userEmail,
    department: attribution.department,
    aiSystemId: attribution.aiSystemId,
    agentId: attribution.agent?.id ?? null,
    requestBytes: 0,
    startedAt,
  };

  if (parsed.ok === false) {
    if (parsed.status === 403) {
      await writeLog(base, { action: "blocked", ruleSource: "private_address", reason: parsed.error });
    }
    return errorJson(parsed.status, parsed.status === 403 ? "network_blocked" : "invalid_target", parsed.error);
  }
  const target = parsed.target;
  if (attributionResponse) return attributionResponse; // agent kill switch

  let ruleSet: { rules: Parameters<typeof evaluateNetworkTarget>[1]; shadowDomains: string[] };
  try {
    ruleSet = await loadNetworkRuleSet();
  } catch (err) {
    if (mode === "enforce") {
      console.error("Network rules unavailable — failing closed:", err);
      await writeLog(base, { action: "error", ruleSource: "proxy", reason: "Rules unavailable (failed closed)" });
      return errorJson(503, "rules_unavailable", "Network block rules could not be loaded; request refused. Retry shortly.");
    }
    console.error("Network rules unavailable — monitor mode, forwarding unevaluated:", err);
    ruleSet = { rules: [], shadowDomains: [] };
  }

  const verdict = evaluateNetworkTarget(target, ruleSet.rules, ruleSet.shadowDomains);
  if (!verdict.allowed && mode === "enforce") {
    await writeLog(base, { action: "blocked", ...verdictLogFields(verdict) });
    return {
      status: 403,
      headers: { "x-urnammu-network-policy": "blocked" },
      jsonBody: networkBlockedResponseBody(verdict, target),
    };
  }
  const monitored = !verdict.allowed;

  // Resolve before connecting: a public name may point at a private range.
  // Rules ran first so a blocked host is reported as blocked even when it
  // does not resolve.
  try {
    const addresses = await lookup(target.host, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((a) => isForbiddenAddress(a.address))) {
      await writeLog(base, { action: "blocked", ruleSource: "private_address", reason: "Host resolves to a non-public address" });
      return errorJson(403, "network_blocked", `${target.host} resolves to a non-public address and is not proxied.`);
    }
  } catch (err) {
    await writeLog(base, { action: "error", ruleSource: "proxy", reason: "DNS resolution failed" });
    return errorJson(502, "upstream_unresolvable", `Could not resolve ${target.host}: ${err instanceof Error ? err.message : "lookup failed"}`);
  }

  // ── Forward ──
  const headers = new Headers();
  for (const [name, value] of filterRequestHeaders(req.headers)) headers.append(name, value);

  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await req.arrayBuffer();
    base.requestBytes = body.byteLength;
    if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
      return errorJson(413, "request_too_large", `Request bodies over ${MAX_REQUEST_BODY_BYTES} bytes are not proxied.`);
    }
    if (body.byteLength === 0) body = undefined;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.url, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    await writeLog(base, { action: "error", ruleSource: "upstream", reason: message.slice(0, 500) });
    return errorJson(502, "upstream_unreachable", `Upstream request to ${target.host} failed: ${message}`);
  }

  const proxyBase = `${url.origin}/api/proxy/net`;
  const responseHeaders = new Headers();
  for (const [name, value] of filterResponseHeaders(upstream.headers)) {
    responseHeaders.append(name, name === "location" ? rewriteLocation(value, proxyBase) : value);
  }
  responseHeaders.set("x-urnammu-network-policy", monitored ? "monitored" : "allowed");

  const outcome: LogOutcome = {
    action: monitored ? "monitored" : "forwarded",
    status: upstream.status,
    ...(monitored ? verdictLogFields(verdict) : {}),
  };

  if (method === "HEAD" || BODYLESS_STATUS.has(upstream.status) || !upstream.body) {
    await writeLog(base, { ...outcome, responseBytes: 0 });
    return { status: upstream.status, headers: responseHeaders };
  }

  // Stream through, counting bytes; the log row is written once the body has
  // been fully relayed. Azure Functions has no `waitUntil`, so the write is
  // fire-and-forget with its own error handler (see anthropic-proxy.ts).
  let responseBytes = 0;
  const pass = new PassThrough();
  pass.on("data", (chunk: Buffer) => {
    responseBytes += chunk.length;
  });
  const finished = new Promise<void>((resolve) => {
    pass.once("end", () => resolve());
    pass.once("close", () => resolve());
    pass.once("error", () => resolve());
  });
  void finished.then(() => writeLog(base, { ...outcome, responseBytes })).catch((err: unknown) => {
    console.error("network log write failed:", err);
  });
  Readable.fromWeb(upstream.body as unknown as import("stream/web").ReadableStream<Uint8Array>).pipe(pass);

  return { status: upstream.status, headers: responseHeaders, body: pass };
}

app.http("network-proxy", {
  methods: [...METHODS],
  authLevel: "anonymous",
  route: "proxy/net/{host}/{*path}",
  handler: networkProxy,
});

app.http("network-proxy-root", {
  methods: [...METHODS],
  authLevel: "anonymous",
  route: "proxy/net/{host}",
  handler: networkProxy,
});
