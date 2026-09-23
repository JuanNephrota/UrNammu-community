/**
 * Well-known MCP servers, for scoring what the endpoint agent's `agents`
 * collector finds in MCP client configs.
 *
 * The agent reports a server's package id (npx/uvx/docker launchers) or its
 * bare remote hostname — never its args, env or URL. This table turns those
 * identifiers into "this is GitHub's official server" versus "an unrecognized
 * package" or "a remote MCP host nobody has heard of", which is what decides
 * how loudly a configuration surfaces in Agents → Discovered.
 *
 * Deliberately small and conservative: an entry means "a reviewer would
 * recognize this", not "this is safe". Capabilities flag servers that reach
 * the file system, a shell, a database, a browser, money or a cloud control
 * plane, which raise the score even when the server itself is well known.
 */

export type McpCapability =
  | "filesystem"
  | "shell"
  | "database"
  | "browser"
  | "code_host"
  | "saas"
  | "search"
  | "memory"
  | "utility"
  | "cloud"
  | "payments"
  | "docs";

export interface KnownMcpServer {
  id: string;
  label: string;
  vendor: string;
  /** Exact package / image ids (version stripped, lowercase). */
  packages?: string[];
  /** Package id prefixes, e.g. an npm scope or a PyPI namespace. */
  packagePrefixes?: string[];
  /** Remote hosts; a host matches itself and any subdomain. */
  hosts?: string[];
  capabilities: McpCapability[];
}

/** Capabilities that raise the score even for a recognized server. */
export const SENSITIVE_MCP_CAPABILITIES: ReadonlySet<McpCapability> = new Set([
  "filesystem",
  "shell",
  "database",
  "browser",
  "payments",
  "cloud",
]);

/**
 * Local bridges that connect a stdio client to a *remote* MCP server whose
 * URL is in the args — which the agent deliberately does not read. The
 * remote end is therefore unknown, and scored that way.
 */
export const MCP_BRIDGE_PACKAGES: ReadonlySet<string> = new Set([
  "mcp-remote",
  "supergateway",
  "mcp-proxy",
  "@modelcontextprotocol/inspector",
]);

export const KNOWN_MCP_SERVERS: KnownMcpServer[] = [
  // ── Reference servers (modelcontextprotocol/servers) ──
  {
    id: "mcp_filesystem",
    label: "Filesystem (reference)",
    vendor: "Model Context Protocol",
    packages: ["@modelcontextprotocol/server-filesystem", "mcp/filesystem"],
    capabilities: ["filesystem"],
  },
  {
    id: "mcp_fetch",
    label: "Fetch (reference)",
    vendor: "Model Context Protocol",
    packages: ["mcp-server-fetch", "mcp/fetch"],
    capabilities: ["utility"],
  },
  {
    id: "mcp_git",
    label: "Git (reference)",
    vendor: "Model Context Protocol",
    packages: ["mcp-server-git", "mcp/git"],
    capabilities: ["filesystem", "code_host"],
  },
  {
    id: "mcp_memory",
    label: "Memory (reference)",
    vendor: "Model Context Protocol",
    packages: ["@modelcontextprotocol/server-memory", "mcp/memory"],
    capabilities: ["memory"],
  },
  {
    id: "mcp_time",
    label: "Time (reference)",
    vendor: "Model Context Protocol",
    packages: ["mcp-server-time", "mcp/time"],
    capabilities: ["utility"],
  },
  {
    id: "mcp_sequential_thinking",
    label: "Sequential Thinking (reference)",
    vendor: "Model Context Protocol",
    packages: ["@modelcontextprotocol/server-sequential-thinking", "mcp/sequentialthinking"],
    capabilities: ["utility"],
  },
  {
    id: "mcp_everything",
    label: "Everything (reference test server)",
    vendor: "Model Context Protocol",
    packages: ["@modelcontextprotocol/server-everything"],
    capabilities: ["utility"],
  },
  {
    // Archived reference servers — still widely configured.
    id: "mcp_postgres",
    label: "PostgreSQL (reference)",
    vendor: "Model Context Protocol",
    packages: ["@modelcontextprotocol/server-postgres", "mcp/postgres"],
    capabilities: ["database"],
  },
  {
    id: "mcp_sqlite",
    label: "SQLite (reference)",
    vendor: "Model Context Protocol",
    packages: ["@modelcontextprotocol/server-sqlite", "mcp-server-sqlite", "mcp/sqlite"],
    capabilities: ["database"],
  },
  {
    id: "mcp_puppeteer",
    label: "Puppeteer (reference)",
    vendor: "Model Context Protocol",
    packages: ["@modelcontextprotocol/server-puppeteer", "mcp/puppeteer"],
    capabilities: ["browser"],
  },
  {
    id: "mcp_slack",
    label: "Slack (reference)",
    vendor: "Model Context Protocol",
    packages: ["@modelcontextprotocol/server-slack", "mcp/slack"],
    capabilities: ["saas"],
  },
  {
    id: "mcp_brave_search",
    label: "Brave Search",
    vendor: "Brave",
    packages: ["@modelcontextprotocol/server-brave-search", "@brave/brave-search-mcp-server", "mcp/brave-search"],
    capabilities: ["search"],
  },
  {
    id: "mcp_gdrive",
    label: "Google Drive (reference)",
    vendor: "Model Context Protocol",
    packages: ["@modelcontextprotocol/server-gdrive"],
    capabilities: ["saas"],
  },
  {
    id: "mcp_google_maps",
    label: "Google Maps (reference)",
    vendor: "Model Context Protocol",
    packages: ["@modelcontextprotocol/server-google-maps"],
    capabilities: ["search"],
  },
  {
    id: "mcp_redis",
    label: "Redis (reference)",
    vendor: "Model Context Protocol",
    packages: ["@modelcontextprotocol/server-redis"],
    capabilities: ["database"],
  },
  // ── Vendor servers ──
  {
    id: "github",
    label: "GitHub",
    vendor: "GitHub",
    packages: ["@modelcontextprotocol/server-github", "github/github-mcp-server", "mcp/github"],
    hosts: ["api.githubcopilot.com"],
    capabilities: ["code_host"],
  },
  {
    id: "gitlab",
    label: "GitLab",
    vendor: "GitLab",
    packages: ["@modelcontextprotocol/server-gitlab"],
    capabilities: ["code_host"],
  },
  {
    id: "playwright",
    label: "Playwright",
    vendor: "Microsoft",
    packages: ["@playwright/mcp", "@microsoft/mcp-server-playwright", "mcp/playwright"],
    capabilities: ["browser"],
  },
  {
    id: "context7",
    label: "Context7",
    vendor: "Upstash",
    packages: ["@upstash/context7-mcp"],
    hosts: ["mcp.context7.com"],
    capabilities: ["docs"],
  },
  {
    id: "notion",
    label: "Notion",
    vendor: "Notion",
    packages: ["@notionhq/notion-mcp-server"],
    hosts: ["mcp.notion.com"],
    capabilities: ["saas"],
  },
  {
    id: "atlassian",
    label: "Atlassian (Jira, Confluence)",
    vendor: "Atlassian",
    hosts: ["mcp.atlassian.com"],
    capabilities: ["saas"],
  },
  { id: "linear", label: "Linear", vendor: "Linear", hosts: ["mcp.linear.app"], capabilities: ["saas"] },
  { id: "asana", label: "Asana", vendor: "Asana", hosts: ["mcp.asana.com"], capabilities: ["saas"] },
  {
    id: "sentry",
    label: "Sentry",
    vendor: "Sentry",
    packages: ["@sentry/mcp-server"],
    hosts: ["mcp.sentry.dev"],
    capabilities: ["saas"],
  },
  {
    id: "stripe",
    label: "Stripe",
    vendor: "Stripe",
    packages: ["@stripe/mcp"],
    hosts: ["mcp.stripe.com"],
    capabilities: ["payments"],
  },
  { id: "paypal", label: "PayPal", vendor: "PayPal", hosts: ["mcp.paypal.com"], capabilities: ["payments"] },
  { id: "square", label: "Square", vendor: "Block", hosts: ["mcp.squareup.com"], capabilities: ["payments"] },
  {
    id: "supabase",
    label: "Supabase",
    vendor: "Supabase",
    packages: ["@supabase/mcp-server-supabase"],
    hosts: ["mcp.supabase.com"],
    capabilities: ["database", "cloud"],
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    vendor: "Cloudflare",
    packages: ["@cloudflare/mcp-server-cloudflare"],
    hosts: ["mcp.cloudflare.com"],
    capabilities: ["cloud"],
  },
  { id: "vercel", label: "Vercel", vendor: "Vercel", hosts: ["mcp.vercel.com"], capabilities: ["cloud"] },
  {
    id: "aws",
    label: "AWS Labs",
    vendor: "Amazon Web Services",
    // PyPI names are normalised to hyphens before matching, so "awslabs." can never match.
    packagePrefixes: ["awslabs-"],
    capabilities: ["cloud"],
  },
  {
    id: "azure",
    label: "Azure",
    vendor: "Microsoft",
    packages: ["@azure/mcp"],
    capabilities: ["cloud"],
  },
  {
    id: "heroku",
    label: "Heroku",
    vendor: "Salesforce",
    packages: ["@heroku/mcp-server"],
    capabilities: ["cloud"],
  },
  { id: "zapier", label: "Zapier", vendor: "Zapier", hosts: ["mcp.zapier.com"], capabilities: ["saas"] },
  { id: "hubspot", label: "HubSpot", vendor: "HubSpot", hosts: ["mcp.hubspot.com"], capabilities: ["saas"] },
  { id: "intercom", label: "Intercom", vendor: "Intercom", hosts: ["mcp.intercom.com"], capabilities: ["saas"] },
  { id: "figma", label: "Figma", vendor: "Figma", hosts: ["mcp.figma.com"], capabilities: ["saas"] },
  { id: "canva", label: "Canva", vendor: "Canva", hosts: ["mcp.canva.com"], capabilities: ["saas"] },
  { id: "datadog", label: "Datadog", vendor: "Datadog", hosts: ["mcp.datadoghq.com"], capabilities: ["saas"] },
  { id: "vanta", label: "Vanta", vendor: "Vanta", hosts: ["mcp.vanta.com"], capabilities: ["saas"] },
  { id: "deepwiki", label: "DeepWiki", vendor: "Cognition", hosts: ["mcp.deepwiki.com"], capabilities: ["docs"] },
  {
    id: "firecrawl",
    label: "Firecrawl",
    vendor: "Firecrawl",
    packages: ["firecrawl-mcp"],
    hosts: ["mcp.firecrawl.dev"],
    capabilities: ["browser"],
  },
  {
    id: "browserbase",
    label: "Browserbase",
    vendor: "Browserbase",
    packages: ["@browserbasehq/mcp", "@browserbasehq/mcp-server-browserbase"],
    capabilities: ["browser"],
  },
  { id: "remotion", label: "Remotion docs", vendor: "Remotion", packages: ["@remotion/mcp"], capabilities: ["docs"] },
  { id: "aikido", label: "Aikido", vendor: "Aikido Security", packages: ["@aikidosec/mcp"], capabilities: ["saas"] },
];

const BY_PACKAGE = new Map<string, KnownMcpServer>();
const BY_HOST = new Map<string, KnownMcpServer>();
for (const server of KNOWN_MCP_SERVERS) {
  for (const pkg of server.packages ?? []) BY_PACKAGE.set(pkg, server);
  for (const host of server.hosts ?? []) BY_HOST.set(host, server);
}

/** Match a reported package id or remote host against the table. */
export function matchMcpServer(input: {
  package?: string | null;
  host?: string | null;
}): KnownMcpServer | null {
  const pkg = input.package?.toLowerCase();
  if (pkg) {
    const exact = BY_PACKAGE.get(pkg);
    if (exact) return exact;
    for (const server of KNOWN_MCP_SERVERS) {
      if (server.packagePrefixes?.some((prefix) => pkg.startsWith(prefix))) return server;
    }
  }
  const host = input.host?.toLowerCase();
  if (host) {
    // Walk up the labels so `eu.mcp.example.com` matches `mcp.example.com`.
    const labels = host.split(".");
    for (let i = 0; i < labels.length - 1; i++) {
      const candidate = BY_HOST.get(labels.slice(i).join("."));
      if (candidate) return candidate;
    }
  }
  return null;
}

export function isMcpBridgePackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && MCP_BRIDGE_PACKAGES.has(pkg.toLowerCase()));
}
