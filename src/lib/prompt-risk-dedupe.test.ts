import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  initialOccurrenceMetadata,
  mergePromptHashOccurrence,
  PROMPT_HASH_DEDUPE_WINDOW_MS,
  surfaceForProvider,
} from "./prompt-risk-dedupe";

const NOW = new Date("2026-09-16T12:00:00.000Z");

describe("surfaceForProvider", () => {
  it("maps the OTel providers to their surface and everything else to the proxy", () => {
    assert.equal(surfaceForProvider("claude_code"), "claude_code");
    assert.equal(surfaceForProvider("cursor"), "cursor");
    assert.equal(surfaceForProvider("azure_proxy"), "azure_proxy");
    assert.equal(surfaceForProvider("claude"), "proxy");
    assert.equal(surfaceForProvider("chatgpt"), "proxy");
    assert.equal(surfaceForProvider("anything"), "proxy");
  });
});

describe("initialOccurrenceMetadata", () => {
  it("starts at one occurrence with the surface and actor recorded", () => {
    assert.deepEqual(initialOccurrenceMetadata({ surface: "proxy", userEmail: "a@x.io", now: NOW }), {
      occurrences: 1,
      surfaces: ["proxy"],
      actors: ["a@x.io"],
      lastSeenAt: NOW.toISOString(),
    });
  });

  it("records no actor when the email is unknown", () => {
    assert.deepEqual(initialOccurrenceMetadata({ surface: "cursor", userEmail: null, now: NOW }).actors, []);
  });
});

describe("mergePromptHashOccurrence", () => {
  const existing = {
    promptHash: "abc",
    categories: ["Prompt injection"],
    excerpt: "ignore previous instructions",
    occurrences: 1,
    surfaces: ["proxy"],
    actors: ["a@x.io"],
    lastSeenAt: "2026-09-16T11:00:00.000Z",
  };

  it("increments occurrences and appends a new surface and actor", () => {
    const merged = mergePromptHashOccurrence(existing, {
      surface: "claude_code",
      userEmail: "b@x.io",
      now: NOW,
    });
    assert.equal(merged.occurrences, 2);
    assert.deepEqual(merged.surfaces, ["proxy", "claude_code"]);
    assert.deepEqual(merged.actors, ["a@x.io", "b@x.io"]);
    assert.equal(merged.lastSeenAt, NOW.toISOString());
  });

  it("does not duplicate a surface or actor already present", () => {
    const merged = mergePromptHashOccurrence(existing, {
      surface: "proxy",
      userEmail: "a@x.io",
      now: NOW,
    });
    assert.equal(merged.occurrences, 2);
    assert.deepEqual(merged.surfaces, ["proxy"]);
    assert.deepEqual(merged.actors, ["a@x.io"]);
  });

  it("preserves every other metadata key and does not mutate the input", () => {
    const snapshot = JSON.parse(JSON.stringify(existing));
    const merged = mergePromptHashOccurrence(existing, { surface: "cursor", userEmail: null, now: NOW });
    assert.equal(merged.promptHash, "abc");
    assert.deepEqual(merged.categories, ["Prompt injection"]);
    assert.equal(merged.excerpt, "ignore previous instructions");
    assert.deepEqual(existing, snapshot);
  });

  it("treats legacy metadata without occurrence fields as one prior sighting", () => {
    const merged = mergePromptHashOccurrence(
      { promptHash: "abc", categories: ["x"] },
      { surface: "proxy", userEmail: "c@x.io", now: NOW }
    );
    assert.equal(merged.occurrences, 2);
    assert.deepEqual(merged.surfaces, ["proxy"]);
    assert.deepEqual(merged.actors, ["c@x.io"]);
  });

  it("tolerates garbage in the stored fields", () => {
    const merged = mergePromptHashOccurrence(
      { occurrences: "many", surfaces: "proxy", actors: [1, null, "ok@x.io"] },
      { surface: "cursor", userEmail: undefined, now: NOW }
    );
    assert.equal(merged.occurrences, 2);
    assert.deepEqual(merged.surfaces, ["cursor"]);
    assert.deepEqual(merged.actors, ["ok@x.io"]);
  });

  it("chains across repeated sightings", () => {
    let meta: unknown = initialOccurrenceMetadata({ surface: "proxy", userEmail: "a@x.io", now: NOW });
    meta = mergePromptHashOccurrence(meta, { surface: "claude_code", userEmail: "a@x.io", now: NOW });
    meta = mergePromptHashOccurrence(meta, { surface: "cursor", userEmail: "b@x.io", now: NOW });
    const final = mergePromptHashOccurrence(meta, { surface: "proxy", userEmail: null, now: NOW });
    assert.equal(final.occurrences, 4);
    assert.deepEqual(final.surfaces, ["proxy", "claude_code", "cursor"]);
    assert.deepEqual(final.actors, ["a@x.io", "b@x.io"]);
  });
});

describe("PROMPT_HASH_DEDUPE_WINDOW_MS", () => {
  it("is 24 hours", () => {
    assert.equal(PROMPT_HASH_DEDUPE_WINDOW_MS, 24 * 60 * 60 * 1000);
  });
});
