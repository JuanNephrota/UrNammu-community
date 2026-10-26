/**
 * General network proxy: URL block rules, target parsing and the SSRF guard
 * shared by the Vercel route (`/api/proxy/net/{host}/{*path}`) and the Azure
 * Functions handler of the same shape.
 *
 * MIRRORED FILE — `src/lib/network-rules.ts` and
 * `ai-proxy/src/lib/network-rules.ts` must stay byte-identical
 * (`npm run check:mirror-drift`). The Azure Functions project cannot import
 * from the Next.js app, so this module has no imports and no runtime
 * dependencies beyond Node globals.
 *
 * Rule pattern grammar (one per rule, scheme optional and ignored):
 *
 *   example.com            host and every subdomain, any path
 *   *.example.com          subdomains only (not the apex)
 *   example.com:8443       the given port only
 *   example.com/v1/files   path-segment prefix: /v1/files and /v1/files/…
 *   example.com/v1/file*   string prefix: /v1/file, /v1/files, /v1/filer…
 *   *                      every host (pair with ALLOW rules for default-deny)
 *
 * Evaluation order: an enabled ALLOW rule beats everything; otherwise the
 * first matching BLOCK rule denies; otherwise a Shadow AI discovery marked
 * BLOCKED denies by domain; otherwise the request is allowed.
 */

// ─── Mode ───────────────────────────────────────────────────────────────────

/** `network_proxy_mode` setting. Off refuses every request (404) — the default. */
export type NetworkProxyMode = "off" | "monitor" | "enforce";

export const NETWORK_PROXY_MODE_DEFAULT: NetworkProxyMode = "off";

export function parseNetworkProxyMode(value: string | null | undefined): NetworkProxyMode {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "monitor" || v === "enforce") return v;
  return NETWORK_PROXY_MODE_DEFAULT;
}

// ─── Rules ──────────────────────────────────────────────────────────────────

export type NetworkRuleAction = "BLOCK" | "ALLOW";

export type NetworkRule = {
  id: string;
  pattern: string;
  action: NetworkRuleAction;
  enabled?: boolean;
  reason?: string | null;
};

export type ParsedPattern = {
  /** Lowercased host without a leading `*.`; empty when `anyHost`. */
  host: string;
  /** `*.example.com` — match subdomains but not the apex. */
  subdomainsOnly: boolean;
  /** Bare `*` — every host. */
  anyHost: boolean;
  /** Required port, or null for any. */
  port: number | null;
  /** Leading-slash path prefix, or null for any path. */
  path: string | null;
  /** `segment`: `/a/b` matches `/a/b` and `/a/b/…`; `string`: plain prefix (trailing `*`). */
  pathMode: "segment" | "string";
};

const MAX_PATTERN_LENGTH = 512;
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Human-readable reason a pattern is invalid, or null when it parses. */
export function validatePattern(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "Pattern is required.";
  if (trimmed.length > MAX_PATTERN_LENGTH) return `Pattern is longer than ${MAX_PATTERN_LENGTH} characters.`;
  if (/\s/.test(trimmed)) return "Pattern must not contain whitespace.";
  if (/[?#]/.test(trimmed)) return "Query strings and fragments are not matched; remove `?` / `#`.";
  const parsed = parsePattern(trimmed);
  if (!parsed) return "Pattern must be a hostname (optionally `*.`, `:port`, `/path`) or `*`.";
  return null;
}

/** Parse a rule pattern. Returns null when the pattern is malformed. */
export function parsePattern(raw: string): ParsedPattern | null {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s || s.length > MAX_PATTERN_LENGTH || /[\s?#\\]/.test(s)) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip any scheme

  let path: string | null = null;
  let pathMode: ParsedPattern["pathMode"] = "segment";
  const slash = s.indexOf("/");
  if (slash >= 0) {
    path = s.slice(slash);
    s = s.slice(0, slash);
    if (path.endsWith("*")) {
      pathMode = "string";
      path = path.slice(0, -1);
    } else if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    if (path === "/" ) path = null;
    if (path !== null && (path.includes("//") || path.split("/").some((seg) => seg === "." || seg === ".."))) {
      return null;
    }
    if (path !== null && pathMode === "string" && path === "/") path = null;
  }

  let port: number | null = null;
  const colon = s.lastIndexOf(":");
  if (colon >= 0) {
    const portText = s.slice(colon + 1);
    if (!/^\d{1,5}$/.test(portText)) return null;
    port = Number(portText);
    if (port < 1 || port > 65535) return null;
    s = s.slice(0, colon);
  }

  if (s === "*") {
    return { host: "", subdomainsOnly: false, anyHost: true, port, path, pathMode };
  }

  let subdomainsOnly = false;
  if (s.startsWith("*.")) {
    subdomainsOnly = true;
    s = s.slice(2);
  }
  if (s.endsWith(".")) s = s.slice(0, -1);
  if (!s || s.length > 253) return null;
  if (!s.split(".").every((label) => HOST_LABEL.test(label))) return null;

  return { host: s, subdomainsOnly, anyHost: false, port, path, pathMode };
}

export type NetworkTarget = {
  /** Lowercased hostname (no port). */
  host: string;
  /** Explicit port, or null for the scheme default. */
  port: number | null;
  /** Leading-slash path, no query string. */
  path: string;
};

export function matchesPattern(pattern: ParsedPattern, target: NetworkTarget): boolean {
  if (!pattern.anyHost) {
    const host = target.host;
    if (pattern.subdomainsOnly) {
      if (!host.endsWith("." + pattern.host)) return false;
    } else if (host !== pattern.host && !host.endsWith("." + pattern.host)) {
      return false;
    }
  }
  if (pattern.port !== null && (target.port ?? 443) !== pattern.port) return false;
  if (pattern.path !== null) {
    const path = target.path || "/";
    if (pattern.pathMode === "string") {
      if (!path.startsWith(pattern.path)) return false;
    } else if (path !== pattern.path && !path.startsWith(pattern.path + "/")) {
      return false;
    }
  }
  return true;
}

export type NetworkVerdictSource = "rule" | "shadow_ai";

export type NetworkVerdict = {
  allowed: boolean;
  /** The deciding rule (ALLOW exception or BLOCK), when a rule decided. */
  rule: NetworkRule | null;
  /** What produced a denial: a rule, or a Shadow AI BLOCKED discovery. */
  source: NetworkVerdictSource | null;
  /** For Shadow AI denials, the blocked domain that matched. */
  shadowDomain: string | null;
};

const ALLOWED: NetworkVerdict = { allowed: true, rule: null, source: null, shadowDomain: null };

/**
 * Decide whether a target may be forwarded. `rules` may include disabled
 * rules (skipped) and rules whose pattern no longer parses (skipped).
 * `shadowDomains` are bare domains (see shadow-blocklist.ts) that deny the
 * domain and its subdomains on every path.
 */
export function evaluateNetworkTarget(
  target: NetworkTarget,
  rules: NetworkRule[],
  shadowDomains: string[] = []
): NetworkVerdict {
  let block: NetworkRule | null = null;
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const parsed = parsePattern(rule.pattern);
    if (!parsed || !matchesPattern(parsed, target)) continue;
    if (rule.action === "ALLOW") return { allowed: true, rule, source: "rule", shadowDomain: null };
    if (!block) block = rule;
  }
  if (block) return { allowed: false, rule: block, source: "rule", shadowDomain: null };
  for (const domain of shadowDomains) {
    const d = domain.trim().toLowerCase();
    if (!d) continue;
    if (target.host === d || target.host.endsWith("." + d)) {
      return { allowed: false, rule: null, source: "shadow_ai", shadowDomain: d };
    }
  }
  return ALLOWED;
}

/**
 * Reduce a Shadow AI `detectedDomain` to a bare hostname the evaluator can
 * compare against: lowercase, scheme/path/port stripped, leading `*.` and
 * `www.` removed. Same normalization as shadow-blocklist.ts. Null when
 * nothing usable remains.
 */
export function normalizeShadowDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z]+:\/\//, "");
  d = d.split("/")[0];
  d = d.split(":")[0];
  d = d.replace(/^\*\./, "").replace(/^www\./, "");
  d = d.replace(/\.$/, "");
  return d || null;
}

// ─── Target parsing (route → upstream URL) ──────────────────────────────────

export type ParsedTarget = NetworkTarget & {
  /** Full upstream URL including query string. Always https. */
  url: string;
  /** `host` or `host:port` as the upstream `Host` header. */
  authority: string;
};

export type TargetParseResult =
  | { ok: true; target: ParsedTarget }
  | { ok: false; status: 400 | 403; error: string };

const ENCODED_TRAVERSAL = /%2e%2e|%2f|%5c|%00/i;

/**
 * Build the upstream URL from the `{host}` route segment and the `{*path}`
 * remainder. Only https upstreams are supported. Refuses loopback,
 * link-local, private and otherwise non-public hosts by name here; the
 * caller must still resolve the name and run `isForbiddenAddress` on every
 * address (DNS can point a public name at a private range).
 */
export function parseNetworkTarget(hostSegment: string, subpath: string, search: string): TargetParseResult {
  let authority = (hostSegment ?? "").trim().toLowerCase();
  try {
    authority = decodeURIComponent(authority);
  } catch {
    return { ok: false, status: 400, error: "Invalid host segment." };
  }
  if (!authority || /[\s/\\@?#]/.test(authority)) {
    return { ok: false, status: 400, error: "Invalid host segment." };
  }

  let host = authority;
  let port: number | null = null;
  const colon = authority.lastIndexOf(":");
  if (colon >= 0 && !authority.startsWith("[")) {
    const portText = authority.slice(colon + 1);
    if (!/^\d{1,5}$/.test(portText)) return { ok: false, status: 400, error: "Invalid port." };
    port = Number(portText);
    if (port < 1 || port > 65535) return { ok: false, status: 400, error: "Invalid port." };
    host = authority.slice(0, colon);
  }
  if (host.startsWith("[")) {
    return { ok: false, status: 403, error: "IPv6 literal hosts are not proxied." };
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!host || host.length > 253 || !host.split(".").every((label) => HOST_LABEL.test(label))) {
    return { ok: false, status: 400, error: "Invalid hostname." };
  }
  if (isForbiddenHostname(host)) {
    return { ok: false, status: 403, error: "Host is not a public address." };
  }

  let path = (subpath ?? "").trim();
  if (path && !path.startsWith("/")) path = "/" + path;
  if (!path) path = "/";
  if (
    ENCODED_TRAVERSAL.test(path) ||
    /[\u0000-\u001f\u007f\\?#]/.test(path) ||
    path.split("/").some((seg) => seg === "." || seg === "..")
  ) {
    return { ok: false, status: 400, error: "Invalid path." };
  }

  const query = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  const upstreamAuthority = port === null || port === 443 ? host : `${host}:${port}`;
  return {
    ok: true,
    target: {
      host,
      port: port === 443 ? null : port,
      path,
      authority: upstreamAuthority,
      url: `https://${upstreamAuthority}${path}${query}`,
    },
  };
}

/** Names that are never public, whatever DNS says. */
export function isForbiddenHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localdomain") || h.endsWith(".home.arpa")) return true;
  if (h === "metadata.google.internal" || h === "metadata" || h === "instance-data") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return isForbiddenAddress(h);
  return false;
}

/**
 * True for IPv4/IPv6 addresses the proxy must never connect to: loopback,
 * link-local (cloud metadata lives at 169.254.169.254), RFC 1918 private,
 * CGNAT, multicast, reserved, unspecified and IPv4-mapped forms of those.
 */
export function isForbiddenAddress(address: string): boolean {
  const ip = address.trim().toLowerCase();
  if (!ip) return true;
  if (ip.includes(":")) {
    const mapped = /^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip) ?? /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(ip);
    if (mapped) {
      if (mapped[2] !== undefined) {
        const hi = parseInt(mapped[1], 16);
        const lo = parseInt(mapped[2], 16);
        return isForbiddenIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return isForbiddenIPv4(mapped[1]);
    }
    const compact = ip.replace(/^\[|\]$/g, "").split("%")[0];
    if (compact === "::" || compact === "::1" || /^(0+:){7}0*1?$/.test(compact)) return true;
    const first = compact.split(":")[0];
    if (first === "") return true; // other ::-prefixed (IPv4-compatible, etc.)
    const firstWord = parseInt(first, 16);
    if (Number.isNaN(firstWord)) return true;
    if ((firstWord & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((firstWord & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstWord & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (firstWord === 0x2001 && compact.split(":")[1] === "db8") return true; // documentation
    if (firstWord === 0x64 && compact.split(":")[1] === "ff9b") return true; // NAT64 well-known
    return false;
  }
  return isForbiddenIPv4(ip);
}

function isForbiddenIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (octets.some((o) => Number.isNaN(o) || o > 255)) return true;
  const [a, b] = octets;
  if (a === 0) return true; // "this" network
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && octets[2] === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && octets[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

// ─── Header handling ────────────────────────────────────────────────────────

/** Hop-by-hop headers (RFC 7230 §6.1) plus the proxy's own control headers. */
const DROPPED_REQUEST_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "expect",
  "accept-encoding", // fetch negotiates its own and transparently decodes
  "x-proxy-key",
  "x-user-email",
  "x-department",
  "x-ai-system-id",
  "x-agent-id",
]);

const DROPPED_REQUEST_PREFIXES = ["x-forwarded-", "x-vercel-", "x-azure-", "x-arr-", "x-waws-", "x-real-ip", "x-ms-", "cf-", "forwarded"];

/** Request headers to forward upstream, as `[name, value]` pairs. */
export function filterRequestHeaders(headers: Iterable<[string, string]>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [rawName, value] of headers) {
    const name = rawName.toLowerCase();
    if (DROPPED_REQUEST_HEADERS.has(name)) continue;
    if (DROPPED_REQUEST_PREFIXES.some((p) => name.startsWith(p))) continue;
    out.push([name, value]);
  }
  return out;
}

const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  // fetch already decoded the body, so the encoding/length no longer apply.
  "content-encoding",
  "content-length",
  // The proxy must not let the upstream pin a different origin's policies on
  // the proxy origin.
  "strict-transport-security",
  "public-key-pins",
  "alt-svc",
]);

/** Response headers to relay to the client, as `[name, value]` pairs. */
export function filterResponseHeaders(headers: Iterable<[string, string]>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [rawName, value] of headers) {
    const name = rawName.toLowerCase();
    if (DROPPED_RESPONSE_HEADERS.has(name)) continue;
    out.push([name, value]);
  }
  return out;
}

/**
 * Rewrite an upstream `Location` so redirects keep flowing through the
 * proxy (and therefore through the rules). `proxyBase` is the client-facing
 * prefix up to and including `/proxy/net` (no trailing slash). Relative
 * locations and non-https absolutes are returned unchanged.
 */
export function rewriteLocation(location: string, proxyBase: string): string {
  const value = (location ?? "").trim();
  if (!/^https:\/\//i.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  const authority = url.port && url.port !== "443" ? `${url.hostname}:${url.port}` : url.hostname;
  return `${proxyBase}/${authority}${url.pathname}${url.search}`;
}

// ─── Logging helpers ────────────────────────────────────────────────────────

export const NETWORK_LOG_PATH_MAX = 512;

/** Path for the request log: query stripped (may hold credentials), truncated. */
export function loggablePath(path: string): string {
  const p = (path ?? "").split("?")[0] || "/";
  return p.length > NETWORK_LOG_PATH_MAX ? p.slice(0, NETWORK_LOG_PATH_MAX) : p;
}

export type NetworkLogAction = "forwarded" | "blocked" | "monitored" | "error";

/** JSON body returned to the client when a request is blocked in enforce mode. */
export function networkBlockedResponseBody(verdict: NetworkVerdict, target: NetworkTarget): Record<string, unknown> {
  const detail =
    verdict.source === "shadow_ai"
      ? `"${verdict.shadowDomain}" is a blocked AI tool (Shadow AI).`
      : `Rule "${verdict.rule?.pattern ?? "?"}"${verdict.rule?.reason ? `: ${verdict.rule.reason}` : ""}`;
  return {
    error: {
      type: "network_blocked",
      message: `Request to ${target.host}${target.path} was blocked by UrNammu network policy. ${detail}`,
      host: target.host,
      path: target.path,
      source: verdict.source,
      rule: verdict.rule ? { id: verdict.rule.id, pattern: verdict.rule.pattern, reason: verdict.rule.reason ?? null } : null,
    },
  };
}
