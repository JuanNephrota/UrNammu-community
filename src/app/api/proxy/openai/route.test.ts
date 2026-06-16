import test from "node:test";
import assert from "node:assert/strict";
import {
  readOpenAIUpstreamPayload,
  sanitizeOpenAIUpstreamError,
} from "./route";

test("readOpenAIUpstreamPayload preserves SSE responses as streams", async () => {
  const response = new Response("data: {\"id\":\"evt_1\"}\n\n", {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });

  const payload = await readOpenAIUpstreamPayload(response);
  assert.equal(payload.kind, "stream");
  assert.equal(payload.contentType, "text/event-stream; charset=utf-8");
});

test("readOpenAIUpstreamPayload reads non-JSON errors as text", async () => {
  const response = new Response("upstream exploded", {
    status: 502,
    headers: {
      "Content-Type": "text/plain",
    },
  });

  const payload = await readOpenAIUpstreamPayload(response);
  assert.equal(payload.kind, "text");
  assert.equal(payload.body, "upstream exploded");
});

test("sanitizeOpenAIUpstreamError only exposes safe JSON fields", () => {
  const sanitized = sanitizeOpenAIUpstreamError(429, {
    kind: "json",
    contentType: "application/json",
    body: {
      error: {
        message: "sensitive details",
        code: "rate_limit_exceeded",
        type: "rate_limit_error",
      },
    },
  });

  assert.deepEqual(sanitized, {
    error: "upstream_error",
    status: 429,
    code: "rate_limit_exceeded",
    type: "rate_limit_error",
  });
});
