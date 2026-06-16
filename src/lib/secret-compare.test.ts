import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bearerTokenMatches, secretsMatch } from "./secret-compare";

describe("secretsMatch", () => {
  it("matches identical secrets", () => {
    assert.equal(secretsMatch("s3cret-value", "s3cret-value"), true);
  });

  it("rejects mismatched secrets", () => {
    assert.equal(secretsMatch("s3cret-value", "other-value"), false);
  });

  it("rejects different-length secrets", () => {
    assert.equal(secretsMatch("short", "short-but-longer"), false);
  });

  it("rejects empty or missing values on either side", () => {
    assert.equal(secretsMatch("", "expected"), false);
    assert.equal(secretsMatch(null, "expected"), false);
    assert.equal(secretsMatch(undefined, "expected"), false);
    assert.equal(secretsMatch("provided", ""), false);
    assert.equal(secretsMatch("provided", null), false);
    assert.equal(secretsMatch("provided", undefined), false);
    // Two empties must still not match — no secret configured means no access.
    assert.equal(secretsMatch("", ""), false);
  });
});

describe("bearerTokenMatches", () => {
  it("matches a well-formed bearer header", () => {
    assert.equal(bearerTokenMatches("Bearer tok-123", "tok-123"), true);
  });

  it("rejects wrong token, wrong scheme, and missing header", () => {
    assert.equal(bearerTokenMatches("Bearer wrong", "tok-123"), false);
    assert.equal(bearerTokenMatches("Basic tok-123", "tok-123"), false);
    assert.equal(bearerTokenMatches("tok-123", "tok-123"), false);
    assert.equal(bearerTokenMatches(null, "tok-123"), false);
    assert.equal(bearerTokenMatches(undefined, "tok-123"), false);
  });

  it("rejects when no secret is configured", () => {
    assert.equal(bearerTokenMatches("Bearer tok-123", null), false);
    assert.equal(bearerTokenMatches("Bearer ", ""), false);
  });
});
