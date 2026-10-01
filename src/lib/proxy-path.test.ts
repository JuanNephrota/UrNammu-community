import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedAnthropicPath, isCanonicalProxyPath } from "./proxy-providers";

test("canonical paths pass", () => {
  for (const p of ["/", "/v1/messages", "/v1/chat/completions/", "/model/anthropic.claude-v2%3A1/invoke"]) {
    assert.equal(isCanonicalProxyPath(p), true, p);
  }
});

test("traversal and ambiguity are rejected", () => {
  for (const p of [
    "/v1/messages/../messages", "/v1/./messages", "//v1/messages", "/v1//messages",
    "/v1/messages/%2e%2e/messages", "/v1%2fmessages", "/v1\\messages", "/v1/messages?x=1",
    "/v1/mes\nsages", "v1/messages",
  ]) {
    assert.equal(isCanonicalProxyPath(p), false, JSON.stringify(p));
  }
});

test("Anthropic is allowlisted", () => {
  for (const p of ["/v1/messages", "/v1/messages/count_tokens", "/v1/messages/batches", "/v1/messages/batches/msgbatch_01/results", "/v1/models", "/v1/models/claude-x"]) {
    assert.equal(isAllowedAnthropicPath(p), true, p);
  }
  for (const p of ["/v1/files", "/v1/messages/", "/v1/messages/../files", "/v1/organizations/users", "/v1/messages/batches/x/y/z"]) {
    assert.equal(isAllowedAnthropicPath(p), false, p);
  }
});
