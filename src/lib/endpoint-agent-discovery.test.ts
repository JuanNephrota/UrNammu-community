import test from "node:test";
import assert from "node:assert/strict";
import {
  alertedServerKeys,
  buildFrameworkDiscovery,
  buildMcpClientDiscovery,
  groupMcpServersByClient,
  isNewerObservation,
  mcpClientExternalId,
  newRiskyServers,
  summarizeMcpServer,
} from "./endpoint-agent-discovery";
import { matchMcpServer } from "./mcp-server-registry";
import { endpointMcpServerSchema, type EndpointMcpServer } from "./validations/endpoint-agent";

const device = {
  id: "dev_1",
  machineId: "MACHINE-0001-AAAA",
  hostname: "alice-mbp",
  userEmail: "alice@example.com",
};
const observedAt = new Date("2026-09-22T12:00:00Z");

function server(overrides: Partial<EndpointMcpServer> & Record<string, unknown>): EndpointMcpServer {
  return endpointMcpServerSchema.parse({
    client: "claude_desktop",
    name: "x",
    transport: "stdio",
    ...overrides,
  });
}

test("registry matches packages, prefixes and host subdomains", () => {
  assert.equal(matchMcpServer({ package: "@modelcontextprotocol/server-github" })?.id, "github");
  assert.equal(matchMcpServer({ package: "github/github-mcp-server" })?.id, "github");
  assert.equal(matchMcpServer({ package: "awslabs-aws-documentation-mcp-server" })?.id, "aws");
  assert.equal(matchMcpServer({ host: "api.githubcopilot.com" })?.id, "github");
  assert.equal(matchMcpServer({ host: "eu.mcp.atlassian.com" })?.id, "atlassian");
  assert.equal(matchMcpServer({ host: "mcp.atlassian.com.evil.example" }), null);
  assert.equal(matchMcpServer({ host: "notmcp.notion.com" }), null);
  assert.equal(matchMcpServer({ package: "totally-unknown-mcp" }), null);
});

test("server risk classification", () => {
  assert.equal(summarizeMcpServer(server({ launcher: "npx", package: "@playwright/mcp" })).risk, "known");
  assert.equal(summarizeMcpServer(server({ launcher: "npx", package: "@playwright/mcp" })).sensitive, true);
  assert.equal(summarizeMcpServer(server({ launcher: "npx", package: "some-random-mcp" })).risk, "unknown_package");
  assert.equal(summarizeMcpServer(server({ launcher: "npx", package: "mcp-remote" })).risk, "bridge");
  assert.equal(
    summarizeMcpServer(server({ transport: "http", host: "mcp.unknown-vendor.io" })).risk,
    "unknown_remote",
  );
  // A remote server whose host could not be reported is still an unknown remote.
  assert.equal(summarizeMcpServer(server({ transport: "sse" })).risk, "unknown_remote");
  assert.equal(summarizeMcpServer(server({ transport: "http", loopback: true })).risk, "unidentified_local");
  assert.equal(summarizeMcpServer(server({ launcher: "binary" })).risk, "unidentified_local");
});

test("one row per (device, client), deterministic and keyed on machineId", () => {
  const servers = [
    server({ client: "cursor", name: "b", launcher: "npx", package: "@upstash/context7-mcp" }),
    server({ client: "claude_desktop", name: "z", launcher: "npx", package: "@playwright/mcp" }),
    server({ client: "cursor", name: "a", transport: "http", host: "mcp.notion.com" }),
    server({ client: "cursor", name: "a", transport: "http", host: "mcp.notion.com" }), // duplicate
  ];
  const groups = groupMcpServersByClient(servers);
  assert.deepEqual(
    groups.map((g) => [g.client, g.servers.map((s) => s.name)]),
    [
      ["claude_desktop", ["z"]],
      ["cursor", ["a", "b"]],
    ],
  );
  const reversed = groupMcpServersByClient([...servers].reverse());
  assert.deepEqual(reversed, groups, "grouping does not depend on report order");

  const a = mcpClientExternalId(device.machineId, "cursor");
  assert.equal(a, mcpClientExternalId(device.machineId, "cursor"));
  assert.notEqual(a, mcpClientExternalId(device.machineId, "claude_desktop"));
  assert.notEqual(a, mcpClientExternalId("OTHER-MACHINE-0002", "cursor"));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("known-only configs score low and do not alert; unknown remote hosts do", () => {
  const known = buildMcpClientDiscovery({
    device,
    client: "claude_desktop",
    servers: [
      server({ name: "github", launcher: "docker", package: "github/github-mcp-server" }),
      server({ name: "notion", transport: "http", host: "mcp.notion.com" }),
    ],
    observedAt,
  });
  assert.equal(known.input.confidence, "low");
  assert.equal(known.input.suppressAlert, true);
  assert.equal(known.input.name, "Claude Desktop MCP config on alice-mbp");
  assert.equal(known.input.platform, "Claude Desktop");
  assert.deepEqual(known.input.mcpServers, ["github", "notion"]);
  assert.deepEqual(known.input.userEmails, ["alice@example.com"]);

  const risky = buildMcpClientDiscovery({
    device,
    client: "cursor",
    servers: [
      server({ client: "cursor", name: "internal", transport: "http", host: "mcp.shady-startup.io" }),
      server({ client: "cursor", name: "tool", launcher: "npx", package: "unvetted-mcp" }),
    ],
    observedAt,
  });
  assert.ok(risky.score >= 70, `score ${risky.score}`);
  assert.equal(risky.input.confidence, "high");
  assert.equal(risky.input.suppressAlert, false);
  const keys = risky.input.signals!.map((s) => s.key);
  assert.ok(keys.includes("unknown_remote_host"));
  assert.ok(keys.includes("unknown_package"));
  // Exact token match (not a substring test) so the host is named as itself.
  assert.ok(
    risky.input.signals!.some((s) => s.label.split(/[\s,()]+/).some((token) => token === "mcp.shady-startup.io")),
  );

  const meta = risky.input.metadata as Record<string, unknown>;
  assert.equal(meta.deviceId, "dev_1");
  assert.equal(meta.hostname, "alice-mbp");
  assert.equal(meta.client, "cursor");
  assert.equal(meta.serverCount, 2);
  assert.equal(meta.kind, "mcp_client");
});

test("drift: only risky servers the stored row did not list", () => {
  const first = buildMcpClientDiscovery({
    device,
    client: "cursor",
    servers: [server({ client: "cursor", name: "tool", launcher: "npx", package: "unvetted-mcp" })],
    observedAt,
  });
  const stored = first.input.metadata;

  const same = buildMcpClientDiscovery({
    device,
    client: "cursor",
    servers: [server({ client: "cursor", name: "tool", launcher: "npx", package: "unvetted-mcp" })],
    observedAt,
  });
  assert.deepEqual(newRiskyServers(stored, same.summaries), [], "a re-sent report is not drift");

  const added = buildMcpClientDiscovery({
    device,
    client: "cursor",
    servers: [
      server({ client: "cursor", name: "tool", launcher: "npx", package: "unvetted-mcp" }),
      server({ client: "cursor", name: "gh", launcher: "npx", package: "@modelcontextprotocol/server-github" }),
      server({ client: "cursor", name: "exfil", transport: "http", host: "collect.example.net" }),
    ],
    observedAt,
  });
  assert.deepEqual(
    newRiskyServers(stored, added.summaries).map((s) => s.name),
    ["exfil"],
    "the known GitHub server is not drift; the unknown remote is",
  );
  assert.equal(newRiskyServers(null, same.summaries).length, 1);
});

test("replayed older reports are recognised", () => {
  const meta = { observedAt: observedAt.toISOString() };
  assert.equal(isNewerObservation(meta, new Date("2026-09-22T12:15:00Z")), true);
  assert.equal(isNewerObservation(meta, observedAt), true);
  assert.equal(isNewerObservation(meta, new Date("2026-09-22T11:45:00Z")), false);
  assert.equal(isNewerObservation(null, observedAt), true);
  assert.equal(isNewerObservation({ observedAt: "garbage" }, observedAt), true);
});

test("framework row: one per device, low confidence, no alert, primary by priority", () => {
  assert.equal(buildFrameworkDiscovery({ device, frameworks: [], observedAt }), null);
  const row = buildFrameworkDiscovery({
    device,
    frameworks: [
      { framework: "langchain", ecosystem: "python", source: "user_site", count: 1 },
      { framework: "claude_agent_sdk", ecosystem: "node", source: "npm_global", count: 1 },
      { framework: "langchain", ecosystem: "python", source: "pipx", count: 2 },
    ],
    observedAt,
  })!;
  assert.equal(row.framework, "claude_agent_sdk");
  assert.equal(row.confidence, "low");
  assert.equal(row.suppressAlert, true);
  assert.ok((row.score ?? 0) < 50);
  assert.equal(row.name, "Agent frameworks on alice-mbp");
  const meta = row.metadata as { frameworks: unknown[]; kind: string };
  assert.equal(meta.kind, "agent_frameworks");
  assert.equal(meta.frameworks.length, 3);
});

test("drift: a risky server toggled off and back on alerts only once", () => {
  const exfil = server({ client: "cursor", name: "exfil", transport: "http", host: "collect.example.net" });
  const known = server({ client: "cursor", name: "gh", launcher: "npx", package: "@modelcontextprotocol/server-github" });
  const build = (servers: EndpointMcpServer[]) =>
    buildMcpClientDiscovery({ device, client: "cursor", servers, observedAt });

  // Row exists with only the known server; exfil is added -> drift, and the
  // cumulative set now records it.
  const base = build([known]).input.metadata;
  const withExfil = build([known, exfil]);
  assert.equal(newRiskyServers(base, withExfil.summaries).length, 1);
  const afterAdd = { ...withExfil.input.metadata, alertedServerKeys: alertedServerKeys(base, withExfil.summaries) };

  // Disabled (dropped from the report), then re-enabled.
  const disabled = build([known]);
  const afterDisable = { ...disabled.input.metadata, alertedServerKeys: alertedServerKeys(afterAdd, disabled.summaries) };
  assert.equal(newRiskyServers(afterDisable, withExfil.summaries).length, 0, "re-enabling must not re-alert");
});

test("a new config whose only risky server is a bridge still alerts on creation", () => {
  const bridge = buildMcpClientDiscovery({
    device,
    client: "claude_desktop",
    servers: [server({ name: "remote", launcher: "npx", package: "mcp-remote" })],
    observedAt,
  });
  assert.equal(bridge.input.suppressAlert, false);
  const knownOnly = buildMcpClientDiscovery({
    device,
    client: "claude_desktop",
    servers: [server({ name: "gh", launcher: "npx", package: "@modelcontextprotocol/server-github" })],
    observedAt,
  });
  assert.equal(knownOnly.input.suppressAlert, true);
});
