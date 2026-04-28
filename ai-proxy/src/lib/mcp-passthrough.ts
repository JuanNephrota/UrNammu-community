/**
 * MCP passthrough for the Azure Functions Anthropic proxy.
 *
 * Mirror of `src/lib/mcp-passthrough.ts` in the main app — kept in sync by
 * convention. See that file for full rationale.
 */

export type McpPassthroughResult = {
  detected: boolean;
  forwarded: string[];
  mcpServerCount: number;
};

export function applyMcpPassthrough(
  forwardHeaders: Record<string, string>,
  requestHeaders: Headers,
  bodyJson: Record<string, unknown> | null
): McpPassthroughResult {
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
