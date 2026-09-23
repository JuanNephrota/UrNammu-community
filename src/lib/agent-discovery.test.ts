import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDiscoveredAgentUpdate,
  confidenceForScore,
  MAX_ARRAY_ITEMS,
  mergeList,
  type DiscoveredAgentInput,
} from "./agent-discovery";

const existing = {
  tools: ["search"],
  mcpServers: ["github"],
  models: [],
  userEmails: ["a@x.com"],
  firstSeenAt: new Date("2026-09-10T00:00:00Z"),
  lastSeenAt: new Date("2026-09-15T00:00:00Z"),
  requestCount: 10,
  metadata: { keep: 1 },
  linkedAgentId: null,
  status: "UNDER_REVIEW" as const,
};

const input: DiscoveredAgentInput = {
  source: "proxy_traffic",
  externalId: "x",
  name: "Agent",
};

test("mergeList unions in order, trims, drops blanks and caps", () => {
  assert.deepEqual(mergeList(["a", "b"], [" b ", "c", ""]), ["a", "b", "c"]);
  const many = Array.from({ length: 300 }, (_, i) => `t${i}`);
  assert.equal(mergeList([], many).length, MAX_ARRAY_ITEMS);
});

test("update widens timestamps and unions lists but never touches review status", () => {
  const data = buildDiscoveredAgentUpdate(existing, {
    ...input,
    tools: ["write_file"],
    firstSeenAt: new Date("2026-09-12T00:00:00Z"),
    lastSeenAt: new Date("2026-09-20T00:00:00Z"),
    metadata: { added: 2 },
  });
  assert.deepEqual(data.tools, ["search", "write_file"]);
  assert.deepEqual(data.firstSeenAt, existing.firstSeenAt);
  assert.deepEqual(data.lastSeenAt, new Date("2026-09-20T00:00:00Z"));
  assert.deepEqual(data.metadata, { keep: 1, added: 2 });
  assert.equal("status" in data, false);
  assert.equal("notes" in data, false);
  assert.equal("requestCount" in data, false);
});

test("a source-supplied link registers only an untouched row, and never replaces a link", () => {
  const discovered = buildDiscoveredAgentUpdate({ ...existing, status: "DISCOVERED" }, { ...input, linkedAgentId: "ag1" });
  assert.equal(discovered.status, "REGISTERED");
  assert.deepEqual(discovered.linkedAgent, { connect: { id: "ag1" } });

  const reviewing = buildDiscoveredAgentUpdate(existing, { ...input, linkedAgentId: "ag1" });
  assert.equal("status" in reviewing, false);

  const linked = buildDiscoveredAgentUpdate({ ...existing, linkedAgentId: "ag0" }, { ...input, linkedAgentId: "ag1" });
  assert.equal("linkedAgent" in linked, false);
});

test("confidence bands", () => {
  assert.equal(confidenceForScore(85), "high");
  assert.equal(confidenceForScore(55), "medium");
  assert.equal(confidenceForScore(40), "low");
});
