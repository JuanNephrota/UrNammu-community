import { NextRequest, NextResponse, after } from "next/server";
import { lookup } from "node:dns/promises";
import { prisma } from "./prisma";
import { getSetting } from "./settings";
import {
  authenticateProxyRequest,
  resolveProxyAttribution,
  runAgentRuntimeGate,
} from "./proxy-common";
import { loadNetworkRuleSet } from "./network-rules-loader";
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
} from "./network-rules";

/**
 * General network proxy (Vercel fallback for the Azure Functions handler of
 * the same shape). `/api/proxy/net/{host}/{*path}` forwards the request to
 * `https://{host}/{path}` after checking it against the URL block rules
 * (Settings → Proxy Setup) and the Shadow AI denylist, and writes one
 * `NetworkRequestLog` row per request. Unlike the provider proxies nothing
 * is parsed or priced — bodies stream through untouched.
 *
 * Modes (`network_proxy_mode`): `off` refuses everything (the default —
 * an authenticated open forwarder is only wanted once an admin turns it on),
 * `monitor` logs what would be blocked but forwards it, `enforce` returns 403.
 *
 * SSRF guard: only https upstreams on public names; loopback, link-local
 * (cloud metadata), RFC 1918 and other non-public ranges are refused both by
 * name and after resolving the name. Redirects are not followed — the
 * `Location` is rewritten back through the proxy so the next hop is
 * evaluated too. The resolve-then-connect check is best effort (DNS can
 * change between the two); `x-proxy-key` remains the primary control.
 */

const PROVIDER = "network";
const UPSTREAM_TIMEOUT_MS = 120_000;
const MAX_REQUEST_BODY_BYTES = 50 * 1024 * 1024;
const BODYLESS_STATUS = new Set([204, 205, 304]);

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

/** Never throws — telemetry must not fail the client's request. */
async function writeNetworkLog(base: LogBase, outcome: LogOutcome): Promise<void> {
  try {
    await prisma.networkRequestLog.create({
      data: {
        proxy: "vercel",
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
      },
    });
  } catch (err) {
    console.error("Failed to log network request:", err);
  }
}

function verdictLogFields(verdict: NetworkVerdict): Pick<LogOutcome, "ruleId" | "rulePattern" | "ruleSource" | "reason"> {
  return {
    ruleId: verdict.rule?.id ?? null,
    rulePattern: verdict.rule?.pattern ?? verdict.shadowDomain ?? null,
    ruleSource: verdict.source,
    reason: verdict.rule?.reason ?? (verdict.source === "shadow_ai" ? "Blocked AI tool (Shadow AI)" : null),
  };
}

function errorJson(status: number, type: string, message: string): NextResponse {
  return NextResponse.json({ error: { type, message } }, { status });
}

export async function handleNetworkProxy(
  req: NextRequest,
  hostSegment: string,
  pathSegments: string[]
): Promise<NextResponse> {
  const startedAt = Date.now();
  const authError = await authenticateProxyRequest(req);
  if (authError) return authError;

  const mode = parseNetworkProxyMode(await getSetting("network_proxy_mode"));
  if (mode === "off") {
    return errorJson(
      404,
      "network_proxy_disabled",
      "The network proxy is turned off. Enable it in Settings → Proxy Setup → Network Proxy."
    );
  }

  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const parsed = parseNetworkTarget(hostSegment, "/" + pathSegments.map(decodeSegment).join("/"), url.search);
  const attribution = await resolveProxyAttribution(req);
  const base: LogBase = {
    method,
    host: parsed.ok ? parsed.target.host : hostSegment.toLowerCase().slice(0, 253),
    path: parsed.ok ? parsed.target.path : "/" + pathSegments.join("/"),
    userEmail: attribution.userEmail,
    department: attribution.department,
    aiSystemId: attribution.aiSystemId,
    agentId: attribution.agent?.id ?? null,
    requestBytes: 0,
    startedAt,
  };

  if (parsed.ok === false) {
    if (parsed.status === 403) {
      await writeNetworkLog(base, { action: "blocked", ruleSource: "private_address", reason: parsed.error });
    }
    return errorJson(parsed.status, parsed.status === 403 ? "network_blocked" : "invalid_target", parsed.error);
  }
  const target = parsed.target;

  const killSwitch = await runAgentRuntimeGate({
    agent: attribution.agent,
    provider: PROVIDER,
    aiSystemId: attribution.aiSystemId,
    userEmail: attribution.userEmail,
    department: attribution.department,
  });
  if (killSwitch) return killSwitch;

  let ruleSet: { rules: Parameters<typeof evaluateNetworkTarget>[1]; shadowDomains: string[] };
  try {
    ruleSet = await loadNetworkRuleSet();
  } catch (err) {
    if (mode === "enforce") {
      console.error("Network rules unavailable — failing closed:", err);
      await writeNetworkLog(base, { action: "error", ruleSource: "proxy", reason: "Rules unavailable (failed closed)" });
      return errorJson(503, "rules_unavailable", "Network block rules could not be loaded; request refused. Retry shortly.");
    }
    console.error("Network rules unavailable — monitor mode, forwarding unevaluated:", err);
    ruleSet = { rules: [], shadowDomains: [] };
  }

  const verdict = evaluateNetworkTarget(target, ruleSet.rules, ruleSet.shadowDomains);
  if (!verdict.allowed && mode === "enforce") {
    await writeNetworkLog(base, { action: "blocked", ...verdictLogFields(verdict) });
    return NextResponse.json(networkBlockedResponseBody(verdict, target), {
      status: 403,
      headers: { "x-urnammu-network-policy": "blocked" },
    });
  }
  const monitored = !verdict.allowed;

  // Resolve before connecting: a public name may point at a private range.
  // Rules ran first so a blocked host is reported as blocked even when it
  // does not resolve.
  try {
    const addresses = await lookup(target.host, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((a) => isForbiddenAddress(a.address))) {
      await writeNetworkLog(base, {
        action: "blocked",
        ruleSource: "private_address",
        reason: "Host resolves to a non-public address",
      });
      return errorJson(403, "network_blocked", `${target.host} resolves to a non-public address and is not proxied.`);
    }
  } catch (err) {
    await writeNetworkLog(base, { action: "error", ruleSource: "proxy", reason: "DNS resolution failed" });
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
    await writeNetworkLog(base, { action: "error", ruleSource: "upstream", reason: message.slice(0, 500) });
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
    await writeNetworkLog(base, { ...outcome, responseBytes: 0 });
    return new NextResponse(null, { status: upstream.status, headers: responseHeaders });
  }

  // Stream through, counting bytes; the log row is written once the body has
  // been fully relayed, or after the upstream timeout if the client went away
  // first (TransformStream has no portable cancel hook).
  let responseBytes = 0;
  let settle: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const counted = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        responseBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      flush() {
        settle();
      },
    })
  );
  after(async () => {
    await Promise.race([done, new Promise<void>((r) => setTimeout(r, UPSTREAM_TIMEOUT_MS))]);
    await writeNetworkLog(base, { ...outcome, responseBytes });
  });

  return new NextResponse(counted, { status: upstream.status, headers: responseHeaders });
}

/** Route segments arrive percent-decoded by Next.js; re-encode reserved characters for the upstream path. */
function decodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ":").replace(/%40/gi, "@").replace(/%2B/gi, "+").replace(/%2C/gi, ",").replace(/%3D/gi, "=").replace(/%26/gi, "&").replace(/%24/gi, "$").replace(/%3B/gi, ";").replace(/%21/gi, "!").replace(/%27/gi, "'").replace(/%28/gi, "(").replace(/%29/gi, ")").replace(/%2A/gi, "*").replace(/%7E/gi, "~");
}
