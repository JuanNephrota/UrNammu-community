/**
 * MCP passthrough for the Anthropic proxy.
 *
 * Anthropic's Messages API supports remote MCP servers via the
 * `mcp_servers` request-body field, the `anthropic-beta: mcp-client-*` header,
 * and various `mcp-*` headers (and OAuth-style `Authorization` bearers when an
 * MCP server gateway is in front of the model).
 *
 * The proxy's default header allow-list strips all of those, which breaks
 * MCP authentication. This helper detects MCP-bearing requests and copies
 * the relevant client headers through verbatim. The proxy's own
 * authentication (`x-proxy-key`) is unaffected; the client's `Authorization`
 * header is independent and only carries MCP credentials.
 *
 * The body is forwarded as-is by the proxy, so `mcp_servers[].authorization_token`
 * inside the body survives without any further work here.
 */

export type McpPassthroughResult = {
  /** True iff the request looks like it involves MCP. */
  detected: boolean;
  /** Names (preserved-case) of the request headers that were forwarded. */
  forwarded: string[];
  /** Number of `mcp_servers` declared in the body, or 0. */
  mcpServerCount: number;
};

export function applyMcpPassthrough(
  forwardHeaders: Record<string, string>,
  requestHeaders: Headers,
  bodyJson: Record<string, unknown> | null
): McpPassthroughResult {
  // --- Detection ---
  const mcpServers = Array.isArray(bodyJson?.mcp_servers)
    ? (bodyJson!.mcp_servers as unknown[])
    : [];
  const mcpServerCount = mcpServers.length;

  const betaHeader = requestHeaders.get("anthropic-beta") ?? "";
  const betaMentionsMcp = /\bmcp-client[-\w.]*/i.test(betaHeader);

  let hasMcpHeader = false;
  requestHeaders.forEach((_value, name) => {
    if (name.toLowerCase().startsWith("mcp-")) hasMcpHeader = true;
  });

  const detected = mcpServerCount > 0 || betaMentionsMcp || hasMcpHeader;
  if (!detected) {
    return { detected: false, forwarded: [], mcpServerCount: 0 };
  }

  // --- Passthrough ---
  // Copy every mcp-* header (case-insensitive match, preserve client casing).
  // Copy Authorization verbatim when present — this is the client's MCP
  // bearer, not the proxy's own auth header (`x-proxy-key`).
  const forwarded: string[] = [];
  requestHeaders.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("mcp-")) {
      forwardHeaders[name] = value;
      forwarded.push(name);
      return;
    }
    if (lower === "authorization") {
      forwardHeaders[name] = value;
      forwarded.push(name);
    }
  });

  return { detected: true, forwarded, mcpServerCount };
}
