import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDomain,
  parseFormat,
  serializeBlocklist,
  type BlockedEntry,
} from "./shadow-blocklist";

const entry = (over: Partial<BlockedEntry> = {}): BlockedEntry => ({
  domain: "jasper.ai",
  label: "Jasper",
  vendor: "Jasper AI",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

describe("normalizeDomain", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeDomain("  Jasper.AI "), "jasper.ai");
  });

  it("strips scheme, path, and port", () => {
    assert.equal(normalizeDomain("https://jasper.ai/login"), "jasper.ai");
    assert.equal(normalizeDomain("jasper.ai:8443"), "jasper.ai");
  });

  it("strips leading wildcard and www and trailing dot", () => {
    assert.equal(normalizeDomain("*.jasper.ai"), "jasper.ai");
    assert.equal(normalizeDomain("www.jasper.ai"), "jasper.ai");
    assert.equal(normalizeDomain("jasper.ai."), "jasper.ai");
  });

  it("returns null for empty input", () => {
    assert.equal(normalizeDomain(null), null);
    assert.equal(normalizeDomain("   "), null);
  });
});

describe("parseFormat", () => {
  it("defaults to text", () => {
    assert.equal(parseFormat(null), "text");
    assert.equal(parseFormat("nonsense"), "text");
  });

  it("recognizes known formats case-insensitively", () => {
    assert.equal(parseFormat("HOSTS"), "hosts");
    assert.equal(parseFormat("json"), "json");
    assert.equal(parseFormat("Pac"), "pac");
  });
});

describe("serializeBlocklist", () => {
  const entries = [entry(), entry({ domain: "otter.ai", label: "Otter" })];

  it("text: one bare domain per line", () => {
    const { body, contentType } = serializeBlocklist(entries, "text");
    assert.equal(body, "jasper.ai\notter.ai\n");
    assert.match(contentType, /text\/plain/);
  });

  it("hosts: sinkholes to 0.0.0.0", () => {
    const { body } = serializeBlocklist(entries, "hosts");
    assert.equal(body, "0.0.0.0 jasper.ai\n0.0.0.0 otter.ai\n");
  });

  it("json: includes count and domains", () => {
    const { body, contentType } = serializeBlocklist(entries, "json");
    const parsed = JSON.parse(body);
    assert.equal(parsed.count, 2);
    assert.equal(parsed.domains.length, 2);
    assert.match(contentType, /application\/json/);
  });

  it("pac: embeds domains and returns a dead proxy", () => {
    const { body } = serializeBlocklist(entries, "pac");
    assert.match(body, /FindProxyForURL/);
    assert.match(body, /jasper\.ai/);
    assert.match(body, /PROXY 0\.0\.0\.0:0/);
  });

  it("handles an empty denylist", () => {
    assert.equal(serializeBlocklist([], "text").body, "\n");
    assert.equal(serializeBlocklist([], "hosts").body, "\n");
    assert.equal(JSON.parse(serializeBlocklist([], "json").body).count, 0);
  });
});
