import test from "node:test";
import assert from "node:assert/strict";
import {
  flattenOtlpMetrics,
  flattenOtlpLogs,
  otlpMetricsPayloadSchema,
  otlpLogsPayloadSchema,
  SENSITIVE_EVENT_KEYS,
} from "./claude-code-telemetry";

function kv(key: string, value: unknown) {
  if (typeof value === "string") return { key, value: { stringValue: value } };
  if (typeof value === "number") return { key, value: { doubleValue: value } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  return { key, value: { stringValue: String(value) } };
}

function metricsPayload(opts: {
  resourceAttrs?: ReturnType<typeof kv>[];
  pointAttrs?: ReturnType<typeof kv>[];
  timeUnixNano?: string;
  value?: number;
  name?: string;
  unit?: string;
} = {}) {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: opts.resourceAttrs ?? [
            kv("user.id", "u1"),
            kv("user.email", "dev@example.com"),
            kv("session.id", "sess-1"),
          ],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: opts.name ?? "claude_code.token.usage",
                unit: opts.unit ?? "tokens",
                sum: {
                  dataPoints: [
                    {
                      timeUnixNano: opts.timeUnixNano ?? "1700000000000000000",
                      asDouble: opts.value ?? 120,
                      attributes: opts.pointAttrs ?? [
                        kv("model", "claude-sonnet-4-6"),
                        kv("type", "input"),
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function flattenMetrics(payload: unknown) {
  return flattenOtlpMetrics(otlpMetricsPayloadSchema.parse(payload));
}

test("flattenOtlpMetrics lifts attributes and computes a 40-char dedupeKey", () => {
  const rows = flattenMetrics(metricsPayload());
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.userId, "u1");
  assert.equal(r.metricName, "claude_code.token.usage");
  assert.equal(r.value, 120);
  assert.equal(r.model, "claude-sonnet-4-6");
  assert.equal(r.tokenType, "input");
  assert.equal(r.timestamp.getTime(), 1_700_000_000_000);
  assert.match(r.dedupeKey, /^[0-9a-f]{40}$/);
});

test("metrics: same payload flattened twice → same dedupeKey (collector retry)", () => {
  const a = flattenMetrics(metricsPayload());
  const b = flattenMetrics(metricsPayload());
  assert.equal(a[0].dedupeKey, b[0].dedupeKey);
});

test("metrics: attribute order (resource and point) is irrelevant to the key", () => {
  const a = flattenMetrics(metricsPayload());
  const b = flattenMetrics(
    metricsPayload({
      resourceAttrs: [
        kv("session.id", "sess-1"),
        kv("user.email", "dev@example.com"),
        kv("user.id", "u1"),
      ],
      pointAttrs: [kv("type", "input"), kv("model", "claude-sonnet-4-6")],
    }),
  );
  assert.equal(a[0].dedupeKey, b[0].dedupeKey);
});

test("metrics: changing timestamp or value → different dedupeKey", () => {
  const base = flattenMetrics(metricsPayload())[0].dedupeKey;
  assert.notEqual(
    base,
    flattenMetrics(metricsPayload({ timeUnixNano: "1700000060000000000" }))[0]
      .dedupeKey,
  );
  assert.notEqual(
    base,
    flattenMetrics(metricsPayload({ value: 121 }))[0].dedupeKey,
  );
  assert.notEqual(
    base,
    flattenMetrics(metricsPayload({ name: "claude_code.cost.usage" }))[0]
      .dedupeKey,
  );
});

test("metrics: dedupeKeys are unique across distinct data points in one batch", () => {
  const payload = metricsPayload();
  payload.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints.push({
    timeUnixNano: "1700000000000000000",
    asDouble: 120,
    attributes: [kv("model", "claude-sonnet-4-6"), kv("type", "output")],
  });
  const rows = flattenMetrics(payload);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].dedupeKey, rows[1].dedupeKey);
});

function logsPayload(recordAttrs: ReturnType<typeof kv>[], timeUnixNano = "1700000000000000000") {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [kv("user.id", "u1"), kv("session.id", "sess-1")],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano,
                attributes: recordAttrs,
              },
            ],
          },
        ],
      },
    ],
  };
}

function flattenLogs(payload: unknown) {
  return flattenOtlpLogs(otlpLogsPayloadSchema.parse(payload));
}

test("events: sensitive keys are stripped before hashing, so a retry with/without `prompt` dedupes", () => {
  const common = [
    kv("event.name", "user_prompt"),
    kv("prompt.id", "p1"),
    kv("event.sequence", 1),
    kv("prompt_length", 42),
  ];
  // Direct post: prompt content still present.
  const withPrompt = flattenLogs(
    logsPayload([
      ...common,
      kv("prompt", "rm -rf / please"),
      kv("tool_input", "{...}"),
    ]),
  );
  // Same record after the gateway stripped content keys.
  const stripped = flattenLogs(logsPayload(common));

  assert.equal(withPrompt.length, 1);
  assert.equal(withPrompt[0].dedupeKey, stripped[0].dedupeKey);
  // Prompt still surfaces transiently for risk analysis, but never in the bag.
  assert.equal(withPrompt[0].promptText, "rm -rf / please");
  for (const k of SENSITIVE_EVENT_KEYS) {
    assert.equal(k in withPrompt[0].attributes, false);
  }
});

test("events: same record twice → same key; sequence/timestamp changes → different key", () => {
  const attrs = [
    kv("event.name", "tool_result"),
    kv("prompt.id", "p1"),
    kv("event.sequence", 2),
    kv("tool_name", "Bash"),
    kv("success", true),
  ];
  const a = flattenLogs(logsPayload(attrs))[0];
  const b = flattenLogs(logsPayload(attrs))[0];
  assert.equal(a.dedupeKey, b.dedupeKey);
  assert.equal(a.eventSequence, 2);

  const seq3 = flattenLogs(
    logsPayload([
      kv("event.name", "tool_result"),
      kv("prompt.id", "p1"),
      kv("event.sequence", 3),
      kv("tool_name", "Bash"),
      kv("success", true),
    ]),
  )[0];
  assert.notEqual(a.dedupeKey, seq3.dedupeKey);

  const later = flattenLogs(logsPayload(attrs, "1700000005000000000"))[0];
  assert.notEqual(a.dedupeKey, later.dedupeKey);
});

test("events: records without event.name are dropped", () => {
  const rows = flattenLogs(logsPayload([kv("foo", "bar")]));
  assert.equal(rows.length, 0);
});
