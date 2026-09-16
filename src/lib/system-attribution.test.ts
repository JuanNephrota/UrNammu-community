import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemResolver,
  collectReferencedSystemIds,
  parseProviderKeySystemMap,
  serializeProviderKeySystemMap,
} from "./system-attribution";

test("parseProviderKeySystemMap tolerates null, garbage, and malformed entries", () => {
  assert.deepEqual(parseProviderKeySystemMap(null), {});
  assert.deepEqual(parseProviderKeySystemMap(""), {});
  assert.deepEqual(parseProviderKeySystemMap("not json"), {});
  assert.deepEqual(parseProviderKeySystemMap("[1,2]"), {});
  assert.deepEqual(
    parseProviderKeySystemMap(
      JSON.stringify({
        anthropic: { apikey_1: "sys_a", apikey_2: 42, "": "sys_b", apikey_3: "" },
        openai: "nope",
        litellm: {},
      })
    ),
    { anthropic: { apikey_1: "sys_a" } }
  );
});

test("serializeProviderKeySystemMap round-trips and collapses empty maps to null", () => {
  assert.equal(serializeProviderKeySystemMap({}), null);
  assert.equal(serializeProviderKeySystemMap({ openai: {} }), null);
  const raw = serializeProviderKeySystemMap({ openai: { key_1: "sys_x" } });
  assert.deepEqual(parseProviderKeySystemMap(raw), { openai: { key_1: "sys_x" } });
});

test("collectReferencedSystemIds dedupes defaults and mapped systems", () => {
  const ids = collectReferencedSystemIds(
    { anthropic: { k1: "sys_a", k2: "sys_b" }, openai: { k3: "sys_a" } },
    ["sys_c", null, "sys_a"]
  );
  assert.deepEqual([...ids].sort(), ["sys_a", "sys_b", "sys_c"]);
});

test("buildSystemResolver: key mapping wins over provider default, unknown keys fall back", () => {
  const resolver = buildSystemResolver({
    provider: "anthropic",
    defaultSystemId: "sys_default",
    keyMap: { anthropic: { apikey_1: "sys_a" }, openai: { apikey_1: "sys_wrong_provider" } },
    validSystemIds: ["sys_default", "sys_a", "sys_wrong_provider"],
  });
  assert.equal(resolver.defaultSystemId, "sys_default");
  assert.equal(resolver.forKey("apikey_1"), "sys_a");
  assert.equal(resolver.forKey("apikey_unknown"), "sys_default");
  assert.equal(resolver.forKey(null), "sys_default");
});

test("buildSystemResolver ignores mappings that point at deleted systems", () => {
  const resolver = buildSystemResolver({
    provider: "openai",
    defaultSystemId: "sys_gone",
    keyMap: { openai: { k1: "sys_gone_too", k2: "sys_ok" } },
    validSystemIds: ["sys_ok"],
  });
  assert.equal(resolver.defaultSystemId, null);
  assert.equal(resolver.forKey("k1"), null);
  assert.equal(resolver.forKey("k2"), "sys_ok");
});

test("buildSystemResolver.forKeys returns the single agreed system, else the default", () => {
  const resolver = buildSystemResolver({
    provider: "anthropic",
    defaultSystemId: "sys_default",
    keyMap: { anthropic: { k1: "sys_a", k2: "sys_a", k3: "sys_b" } },
    validSystemIds: ["sys_default", "sys_a", "sys_b"],
  });
  assert.equal(resolver.forKeys(["k1", "k2"]), "sys_a");
  assert.equal(resolver.forKeys(["k1", "k3"]), "sys_default");
  assert.equal(resolver.forKeys(["unmapped", null]), "sys_default");
  assert.equal(resolver.forKeys([]), "sys_default");
});
