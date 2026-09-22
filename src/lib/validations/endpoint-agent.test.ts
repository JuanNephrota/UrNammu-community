import test from "node:test";
import assert from "node:assert/strict";
import {
  countReportObservations,
  endpointEnrollSchema,
  endpointReportSchema,
} from "./endpoint-agent";

const now = new Date().toISOString();

function report(overrides: Record<string, unknown> = {}) {
  return {
    reportId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    machineId: "TEST-MACHINE-UUID-0001",
    collectedAt: now,
    ...overrides,
  };
}

test("a minimal report parses and defaults every collector to empty", () => {
  const parsed = endpointReportSchema.parse(report());
  assert.deepEqual(parsed.apps, []);
  assert.deepEqual(parsed.browser, []);
  assert.deepEqual(parsed.network, []);
  assert.deepEqual(parsed.runtimes, []);
  assert.equal(countReportObservations(parsed), 0);
});

// The wire contract's whole point: nothing resembling content may be
// expressible. A hostname field that accepted a URL would be a hole straight
// through the agent's privacy story, so it is checked explicitly.
test("domain fields reject anything that is not a bare hostname", () => {
  const rejected = [
    "https://chatgpt.com/c/secret-conversation",
    "chatgpt.com/c/secret",
    "chatgpt.com?q=my+prompt",
    "user:pass@claude.ai",
    "claude.ai:443",
    "localhost",
    "not a host",
    "",
  ];

  for (const domain of rejected) {
    const result = endpointReportSchema.safeParse(
      report({ network: [{ domain, count: 1, firstSeen: now, lastSeen: now }] }),
    );
    assert.equal(result.success, false, `expected ${JSON.stringify(domain)} to be rejected`);
  }
});

test("domain fields accept and normalize real hostnames", () => {
  const parsed = endpointReportSchema.parse(
    report({
      network: [
        { domain: "API.OpenAI.com", count: 3, firstSeen: now, lastSeen: now },
      ],
    }),
  );
  assert.equal(parsed.network[0].domain, "api.openai.com");
});

test("browser observations carry a host and a count, never a URL", () => {
  const parsed = endpointReportSchema.parse(
    report({
      browser: [
        { domain: "claude.ai", browser: "chrome", visits: 12, firstSeen: now, lastSeen: now },
      ],
    }),
  );
  assert.equal(parsed.browser[0].domain, "claude.ai");
  assert.equal(parsed.browser[0].visits, 12);
  // There is no field on the parsed shape that could hold a path or a title.
  assert.deepEqual(Object.keys(parsed.browser[0]).sort(), [
    "browser",
    "domain",
    "firstSeen",
    "lastSeen",
    "visits",
  ]);
});

test("a null collector array is rejected rather than silently defaulted", () => {
  // Go marshals a nil slice as `null` and Zod defaults only fire on
  // `undefined`. This asserts the strict behaviour the agent is written
  // against, so the two halves cannot drift apart unnoticed.
  const result = endpointReportSchema.safeParse(report({ runtimes: null }));
  assert.equal(result.success, false);
});

test("runtime observations require a plausible port", () => {
  for (const port of [0, -1, 70000]) {
    const result = endpointReportSchema.safeParse(
      report({ runtimes: [{ runtime: "ollama", port, firstSeen: now, lastSeen: now }] }),
    );
    assert.equal(result.success, false, `expected port ${port} to be rejected`);
  }

  const ok = endpointReportSchema.parse(
    report({
      runtimes: [
        { runtime: "ollama", port: 11434, models: ["llama3.1:8b"], firstSeen: now, lastSeen: now },
      ],
    }),
  );
  assert.deepEqual(ok.runtimes[0].models, ["llama3.1:8b"]);
});

test("countReportObservations totals every collector", () => {
  const parsed = endpointReportSchema.parse(
    report({
      apps: [{ name: "Ollama", firstSeen: now, lastSeen: now }],
      browser: [
        { domain: "claude.ai", browser: "chrome", visits: 1, firstSeen: now, lastSeen: now },
      ],
      network: [{ domain: "api.openai.com", count: 1, firstSeen: now, lastSeen: now }],
      runtimes: [{ runtime: "ollama", port: 11434, firstSeen: now, lastSeen: now }],
    }),
  );
  assert.equal(countReportObservations(parsed), 4);
});

test("enrollment requires a stable machine id and a known platform", () => {
  assert.equal(
    endpointEnrollSchema.safeParse({
      machineId: "short",
      hostname: "x",
      platform: "darwin",
    }).success,
    false,
  );

  assert.equal(
    endpointEnrollSchema.safeParse({
      machineId: "878AE90D-0000-0000-0000-000000000000",
      hostname: "laptop",
      platform: "linux",
    }).success,
    false,
    "linux is not a supported platform",
  );

  const ok = endpointEnrollSchema.parse({
    machineId: "878AE90D-0000-0000-0000-000000000000",
    hostname: "laptop",
    platform: "darwin",
    userEmail: "person@example.com",
  });
  assert.equal(ok.platform, "darwin");
});
