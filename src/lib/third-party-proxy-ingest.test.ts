import test from "node:test";
import assert from "node:assert/strict";
import { parseThirdPartyProxyTelemetryPayload } from "./third-party-proxy-ingest";

test("parseThirdPartyProxyTelemetryPayload supports bare arrays", () => {
  const parsed = parseThirdPartyProxyTelemetryPayload([
    {
      provider: "portkey",
      bucketStart: "2026-04-21T00:00:00Z",
      inputTokens: 10,
      outputTokens: 5,
      amount: 0.25,
    },
  ]);

  assert.equal(parsed.source, "third_party_proxy");
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0]?.provider, "portkey");
});

test("parseThirdPartyProxyTelemetryPayload supports wrapped entries with defaults", () => {
  const parsed = parseThirdPartyProxyTelemetryPayload({
    source: "custom_gateway",
    entries: [
      {
        provider: "custom-proxy",
        bucketStart: "2026-04-21T12:00:00Z",
        inputTokens: 20,
        outputTokens: 30,
      },
    ],
  });

  assert.equal(parsed.source, "custom_gateway");
  assert.equal(parsed.entries[0]?.currency, "usd");
  assert.equal(parsed.entries[0]?.granularity, "day");
});
