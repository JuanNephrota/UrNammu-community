import test from "node:test";
import assert from "node:assert/strict";
import { clientKey, createRateLimiter } from "./rate-limit";

test("allows up to the limit then blocks within the window", () => {
  const allow = createRateLimiter(3, 1000);
  assert.deepEqual([1, 2, 3, 4].map(() => allow("a", 0)), [true, true, true, false]);
  assert.equal(allow("b", 0), true);
});

test("window resets", () => {
  const allow = createRateLimiter(1, 1000);
  assert.equal(allow("a", 0), true);
  assert.equal(allow("a", 500), false);
  assert.equal(allow("a", 1001), true);
});

test("clientKey takes the first forwarded hop", () => {
  assert.equal(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
  assert.equal(clientKey(new Headers()), "unknown");
});
