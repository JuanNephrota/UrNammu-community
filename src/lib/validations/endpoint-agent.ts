import { z } from "zod";

/**
 * Wire schemas for the endpoint agent (`ops/endpoint-agent`).
 *
 * Design rule: the agent may only ever send *identifiers and counts*. There is
 * no field here that can carry a prompt, a response, a URL path, a window
 * title or a file path, and adding one would break the promise the agent is
 * deployed on (docs/plans/endpoint-agent.md). Hostnames are bare — the
 * `hostname` schema rejects anything containing a slash, so a full URL cannot
 * be smuggled through a domain field even by a compromised agent.
 */

/** Bare hostname: no scheme, no path, no query, no credentials, no port. */
const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    "must be a bare hostname (no scheme, path, port or credentials)",
  );

/** Short free-text identifier — app name, publisher, model id. */
const label = z.string().trim().min(1).max(200);

/**
 * Timestamps come off a machine whose clock we do not control. They are
 * validated as parseable here and clamped to a sane window at ingest, so a
 * laptop with a wrong year cannot poison `firstSeenAt`/`lastSeenAt` ordering.
 */
const timestamp = z.string().datetime({ offset: true });

/** Machine identity. Opaque to us — we only require it to be stable. */
const machineId = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/, "must be an opaque identifier");

export const endpointPlatformSchema = z.enum(["darwin", "windows"]);
export type EndpointPlatform = z.infer<typeof endpointPlatformSchema>;

// ─── Enrollment ──────────────────────────────────────────

export const endpointEnrollSchema = z.object({
  machineId,
  hostname: z.string().trim().min(1).max(253),
  platform: endpointPlatformSchema,
  osVersion: label.nullish(),
  arch: label.nullish(),
  agentVersion: label.nullish(),
  /** Console user. Best-effort — shared and unjoined machines report null. */
  userEmail: z.string().trim().email().max(320).nullish(),
  userName: label.nullish(),
});
export type EndpointEnrollPayload = z.infer<typeof endpointEnrollSchema>;

// ─── Observations ────────────────────────────────────────

/** An installed or running AI application. */
export const endpointAppObservationSchema = z.object({
  /** Display name as the OS reports it. */
  name: label,
  /** macOS bundle id / Windows registry key or image name. */
  identifier: label.nullish(),
  publisher: label.nullish(),
  version: label.nullish(),
  /** Whether the app was running at collection time, not merely installed. */
  running: z.boolean().default(false),
  /** Launches or running-samples seen since the last report. */
  count: z.number().int().min(0).max(1_000_000).default(1),
  firstSeen: timestamp,
  lastSeen: timestamp,
});

/**
 * An allowlisted AI hostname seen in browser history. The agent filters
 * against the server-issued manifest before this leaves the machine, so a
 * hostname that matches no known AI tool is never transmitted.
 */
export const endpointBrowserObservationSchema = z.object({
  domain: hostname,
  /** "chrome" | "edge" | "brave" | "arc" | "firefox" | "safari" */
  browser: label,
  visits: z.number().int().min(0).max(1_000_000).default(1),
  firstSeen: timestamp,
  lastSeen: timestamp,
});

/** An allowlisted AI hostname seen in the DNS cache or an open connection. */
export const endpointNetworkObservationSchema = z.object({
  domain: hostname,
  count: z.number().int().min(0).max(1_000_000).default(1),
  firstSeen: timestamp,
  lastSeen: timestamp,
});

/** A local inference runtime listening on the loopback interface. */
export const endpointRuntimeObservationSchema = z.object({
  /** Manifest runtime id, e.g. "ollama", "lm_studio", "llama_cpp". */
  runtime: label,
  port: z.number().int().min(1).max(65535),
  /** Models the runtime reports as available locally. Names only. */
  models: z.array(label).max(200).default([]),
  firstSeen: timestamp,
  lastSeen: timestamp,
});

// ─── MCP servers and agent frameworks (the `agents` collector) ──────────
//
// These are the most secret-adjacent observations the agent makes: MCP client
// config files hold API keys in `env`, passwords in database URLs in `args`,
// bearer tokens in `headers` and in remote URL query strings. The agent keeps
// only the identifiers below (ops/endpoint-agent/internal/collect/agents.go),
// and these schemas enforce the same shapes independently — so a compromised
// or buggy agent still cannot use this channel to ship a URL, a path, an env
// entry or a token.

export const MCP_CLIENTS = [
  "claude_desktop",
  "claude_code",
  "cursor",
  "windsurf",
  "vscode",
  "cline",
  "roo_code",
  "zed",
  "continue",
  "gemini_cli",
  "codex",
] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];
export const mcpClientSchema = z.enum(MCP_CLIENTS);

export const MCP_TRANSPORTS = ["stdio", "http", "sse", "ws"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/**
 * Launcher category for stdio servers. The command itself is never sent:
 * "binary" stands for any direct executable, whose basename is often a path
 * into someone's home directory.
 */
export const MCP_LAUNCHERS = [
  "npx",
  "bunx",
  "pnpm",
  "yarn",
  "npm",
  "node",
  "bun",
  "deno",
  "uvx",
  "uv",
  "pipx",
  "python",
  "docker",
  "java",
  "dotnet",
  "go",
  "binary",
  "extension",
] as const;
export type McpLauncher = (typeof MCP_LAUNCHERS)[number];

/** Launchers whose package argument is reported. Every other arg is dropped. */
const NPM_LAUNCHERS = new Set<McpLauncher>(["npx", "bunx", "pnpm", "yarn"]);
const PYPI_LAUNCHERS = new Set<McpLauncher>(["uvx", "pipx"]);

const SECRET_PREFIXES = [
  "sk-", "sk_", "pk_", "rk_", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_",
  "glpat-", "xoxb-", "xoxp-", "xoxa-", "xoxs-", "akia", "asia", "aiza", "ya29.",
  "eyj", "shpat_", "ntn_", "secret_", "lin_api_", "dop_v1_", "hf_",
];

const SECRET_SEPARATOR = /[ \t._\-/:@=+,;]/;

/**
 * Whether `value` holds an alphanumeric run of `withDigit`+ characters with a
 * digit in it, or a pure-hex run of `pureHex`+ characters.
 */
function hasSecretRun(value: string, withDigit: number, pureHex: number): boolean {
  for (const run of value.split(/[^A-Za-z0-9]+/)) {
    if (run.length >= withDigit && /[0-9]/.test(run)) return true;
    if (run.length >= pureHex && /^[0-9a-fA-F]+$/.test(run)) return true;
  }
  return false;
}

/**
 * Credential-shaped strings. Mirrors `looksLikeSecret` in
 * ops/endpoint-agent/internal/collect/agents_secrets.go rule for rule:
 * - a known token prefix at the start or after a separator ("Bearer sk-…"),
 *   followed by 8+ characters that include a digit;
 * - an alphanumeric run of 20+ with a digit, or pure hex of 32+;
 * - a 32+ character mixed-case alphanumeric value with no spaces.
 */
export function looksLikeSecret(value: string): boolean {
  const lower = value.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    if (i > 0 && !SECRET_SEPARATOR.test(lower[i - 1])) continue;
    for (const prefix of SECRET_PREFIXES) {
      if (!lower.startsWith(prefix, i)) continue;
      const rest = lower.slice(i + prefix.length).split(/[ \t]/)[0];
      if (rest.length >= 8 && /[0-9]/.test(rest)) return true;
    }
  }
  if (hasSecretRun(value, 20, 32)) return true;
  return (
    value.length >= 32 &&
    !value.includes(" ") &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value)
  );
}

/** Tunnel services whose subdomains are per-user identifiers; the agent reports only the suffix. */
const TUNNEL_SUFFIXES = [
  "ngrok.io", "ngrok.app", "ngrok-free.app", "ngrok.dev", "ngrok-free.dev",
  "trycloudflare.com", "loca.lt", "localtunnel.me", "serveo.net",
  "pagekite.me", "devtunnels.ms", "tunnelmole.net", "localhost.run", "lhr.life",
];

/**
 * A remote MCP host must not carry a credential or identifier in a label, and
 * a tunnel host must be the bare service. The agent reduces such hosts before
 * sending; this rejects a host that was not reduced.
 */
export function mcpHostLooksSensitive(host: string): boolean {
  if (TUNNEL_SUFFIXES.some((suffix) => host !== suffix && host.endsWith(`.${suffix}`))) return true;
  return host.split(".").some((label) => looksLikeSecret(label) || hasSecretRun(label, 16, 16));
}

const notSecret = (value: string) => !looksLikeSecret(value);

/**
 * An MCP server's config key. Plain identifiers only — no slash, backslash,
 * colon, `=`, `@`, quote or query character — so a path, URL, KEY=value or
 * credential cannot ride in as a "name". The agent replaces anything else
 * with `redacted-<8 hex>`, which this also accepts.
 */
const mcpServerName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,63}$/, "must be a plain identifier")
  .refine(notSecret, "looks like a credential");

/**
 * Package or image id, version stripped. Lowercase; at most one slash, and
 * then only as an npm scope (`@scope/name`) or a docker namespace
 * (`namespace/name`) — which launcher may use which is checked below.
 */
const mcpPackageId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^(@?[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/,
    "must be a bare package id (no path, URL, version or spaces)",
  )
  .refine(notSecret, "looks like a credential");

export const endpointMcpServerSchema = z
  .object({
    client: mcpClientSchema,
    name: mcpServerName,
    transport: z.enum(MCP_TRANSPORTS),
    /** Remote servers: the bare hostname. Never a URL, never a secret-bearing label. */
    host: hostname.refine((h) => !mcpHostLooksSensitive(h), "host label looks like a credential or identifier").nullish(),
    /** Remote server on localhost / 127.0.0.1 / ::1. */
    loopback: z.boolean().default(false),
    launcher: z.enum(MCP_LAUNCHERS).nullish(),
    package: mcpPackageId.nullish(),
  })
  .superRefine((server, ctx) => {
    const remote = server.transport !== "stdio";
    if (remote && (server.launcher || server.package)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "remote servers carry no launcher or package" });
    }
    if (!remote && (server.host || server.loopback)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stdio servers carry no host" });
    }
    if (server.package) {
      const launcher = server.launcher ?? null;
      const scoped = server.package.startsWith("@");
      const slashed = server.package.includes("/");
      const ok =
        launcher !== null &&
        ((NPM_LAUNCHERS.has(launcher) && (!slashed || scoped)) ||
          (PYPI_LAUNCHERS.has(launcher) && !slashed) ||
          (launcher === "docker" && !scoped));
      if (!ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "package id does not fit the launcher",
          path: ["package"],
        });
      }
    }
  });

/** Framework id — an open set, so a newer agent never fails a whole report. */
const frameworkId = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/, "must be a framework id");

export const endpointAgentFrameworkSchema = z.object({
  framework: frameworkId,
  ecosystem: z.enum(["python", "node"]),
  /** Kind of location, never a path. */
  source: z.enum(["user_site", "system_site", "pipx", "uv_tool", "conda", "npm_global"]),
  /** Environments of that kind with the framework installed. */
  count: z.number().int().min(1).max(10_000).default(1),
});

/**
 * Per-collector outcome, so the console can distinguish "no AI found" from
 * "this collector could not run" (Safari without Full Disk Access is the
 * common case). Keyed by collector name.
 */
export const endpointCollectorStatusSchema = z.record(
  z.string().trim().min(1).max(64),
  z.object({
    ok: z.boolean(),
    /** Short machine-readable reason, e.g. "no_access", "not_installed". */
    reason: label.nullish(),
    itemsScanned: z.number().int().min(0).max(10_000_000).nullish(),
  }),
);

export const endpointReportSchema = z.object({
  /** UUID per report. Re-sending a spooled report is a no-op. */
  reportId: z.string().trim().uuid(),
  machineId,
  agentVersion: label.nullish(),
  osVersion: label.nullish(),
  hostname: z.string().trim().min(1).max(253).nullish(),
  userEmail: z.string().trim().email().max(320).nullish(),
  userName: label.nullish(),
  collectedAt: timestamp,
  apps: z.array(endpointAppObservationSchema).max(2000).default([]),
  browser: z.array(endpointBrowserObservationSchema).max(5000).default([]),
  network: z.array(endpointNetworkObservationSchema).max(5000).default([]),
  runtimes: z.array(endpointRuntimeObservationSchema).max(100).default([]),
  /**
   * Absent from agents older than the `agents` collector. Validated per item
   * (see below) so a newer agent's unknown client, transport or launcher
   * drops that item instead of failing — and permanently discarding — the
   * whole report.
   */
  mcpServers: z.array(z.unknown()).max(256).default([]),
  agentFrameworks: z.array(z.unknown()).max(100).default([]),
  collectors: endpointCollectorStatusSchema.default({}),
}).transform((report) => {
  const mcpServers = keepValid(report.mcpServers, endpointMcpServerSchema);
  const agentFrameworks = keepValid(report.agentFrameworks, endpointAgentFrameworkSchema);
  const dropped = report.mcpServers.length - mcpServers.length + (report.agentFrameworks.length - agentFrameworks.length);
  const collectors = { ...report.collectors };
  // A report missing items is not a complete picture of the machine, so it
  // must not clear stored state: any reason marks the scan partial at ingest.
  if (dropped > 0 && collectors.agents && !collectors.agents.reason) {
    collectors.agents = { ...collectors.agents, reason: "dropped_invalid_items" };
  }
  return { ...report, mcpServers, agentFrameworks, collectors, droppedAgentItems: dropped };
});

function keepValid<T extends z.ZodTypeAny>(items: unknown[], schema: T): z.infer<T>[] {
  const out: z.infer<T>[] = [];
  for (const item of items) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export type EndpointReportPayload = z.infer<typeof endpointReportSchema>;
export type EndpointAppObservation = z.infer<typeof endpointAppObservationSchema>;
export type EndpointBrowserObservation = z.infer<typeof endpointBrowserObservationSchema>;
export type EndpointNetworkObservation = z.infer<typeof endpointNetworkObservationSchema>;
export type EndpointRuntimeObservation = z.infer<typeof endpointRuntimeObservationSchema>;
export type EndpointMcpServer = z.infer<typeof endpointMcpServerSchema>;
export type EndpointAgentFramework = z.infer<typeof endpointAgentFrameworkSchema>;

/** Total observation rows in a report, used for the payload ceiling. */
export function countReportObservations(report: EndpointReportPayload): number {
  return (
    report.apps.length +
    report.browser.length +
    report.network.length +
    report.runtimes.length +
    report.mcpServers.length +
    report.agentFrameworks.length
  );
}
