import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceWatermark,
  buildBackfillChunks,
  computeSyncWindow,
  DAY_MS,
  parseRequestedWindow,
  PROVIDER_MAX_LOOKBACK_DAYS,
  SCHEDULED_MAX_WINDOW_DAYS,
} from "./provider-sync-window";

const NOW = new Date("2026-09-16T15:42:10.000Z");
const iso = (d: Date) => d.toISOString();

test("computeSyncWindow with no watermark reaches back the scheduled cap, day-aligned", () => {
  const window = computeSyncWindow({ provider: "anthropic", watermark: null, now: NOW });
  // anthropic max lookback is 90d but a single scheduled window is capped at 31d.
  assert.equal(PROVIDER_MAX_LOOKBACK_DAYS.anthropic, 90);
  assert.equal(iso(window.from), `2026-08-16T00:00:00.000Z`);
  assert.equal(window.to, NOW);
  assert.equal(SCHEDULED_MAX_WINDOW_DAYS, 31);
});

test("computeSyncWindow with no watermark honours a lookback shorter than the cap (Cursor 30d)", () => {
  const window = computeSyncWindow({ provider: "cursor", watermark: null, now: NOW });
  assert.equal(iso(window.from), "2026-08-17T00:00:00.000Z");
  assert.equal(window.to, NOW);
});

test("computeSyncWindow with a recent watermark starts overlapDays before it", () => {
  const watermark = new Date("2026-09-16T00:00:00.000Z");
  const window = computeSyncWindow({ provider: "openai", watermark, now: NOW });
  assert.equal(iso(window.from), "2026-09-14T00:00:00.000Z");
  assert.equal(window.to, NOW);
});

test("computeSyncWindow accepts an overlap of zero (no re-pull)", () => {
  const watermark = new Date("2026-09-16T00:00:00.000Z");
  const window = computeSyncWindow({ provider: "openai", watermark, now: NOW, overlapDays: 0 });
  assert.equal(iso(window.from), "2026-09-16T00:00:00.000Z");
});

test("computeSyncWindow honours a custom overlap", () => {
  const watermark = new Date("2026-09-16T00:00:00.000Z");
  const window = computeSyncWindow({ provider: "openai", watermark, now: NOW, overlapDays: 5 });
  assert.equal(iso(window.from), "2026-09-11T00:00:00.000Z");
});

test("computeSyncWindow clamps a stale watermark to the provider max lookback", () => {
  const watermark = new Date("2026-06-01T00:00:00.000Z");
  const window = computeSyncWindow({
    provider: "cursor",
    watermark,
    now: NOW,
    maxWindowDays: 365, // remove the scheduled cap to isolate the lookback clamp
  });
  assert.equal(iso(window.from), "2026-08-17T00:00:00.000Z"); // now - 30d
});

test("computeSyncWindow clamps a stale watermark to the scheduled window cap", () => {
  const watermark = new Date("2026-06-01T00:00:00.000Z");
  const window = computeSyncWindow({ provider: "anthropic", watermark, now: NOW });
  assert.equal(iso(window.from), "2026-08-16T00:00:00.000Z"); // now - 31d, not now - 90d
});

test("computeSyncWindow never returns an inverted window for a future watermark", () => {
  const watermark = new Date("2026-09-20T00:00:00.000Z");
  const window = computeSyncWindow({ provider: "helicone", watermark, now: NOW });
  assert.ok(window.from < window.to);
  assert.equal(iso(window.from), "2026-09-14T00:00:00.000Z");
});

test("computeSyncWindow falls back to defaults for nonsense overrides", () => {
  const window = computeSyncWindow({
    provider: "portkey",
    watermark: null,
    now: NOW,
    overlapDays: -3,
    maxLookbackDays: Number.NaN,
    maxWindowDays: 0,
  });
  assert.equal(iso(window.from), "2026-08-17T00:00:00.000Z"); // portkey 30d
});

test("buildBackfillChunks splits a range into 7-day chunks and clamps the tail", () => {
  const from = new Date("2026-08-01T00:00:00.000Z");
  const to = new Date("2026-08-18T00:00:00.000Z"); // 17 days
  const chunks = buildBackfillChunks(from, to);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((c) => [iso(c.from), iso(c.to)]), [
    ["2026-08-01T00:00:00.000Z", "2026-08-08T00:00:00.000Z"],
    ["2026-08-08T00:00:00.000Z", "2026-08-15T00:00:00.000Z"],
    ["2026-08-15T00:00:00.000Z", "2026-08-18T00:00:00.000Z"],
  ]);
});

test("buildBackfillChunks produces exact chunks for a multiple of the chunk size", () => {
  const from = new Date("2026-08-01T00:00:00.000Z");
  const chunks = buildBackfillChunks(from, new Date(from.getTime() + 14 * DAY_MS), 7);
  assert.equal(chunks.length, 2);
  assert.equal(iso(chunks[1]!.to), "2026-08-15T00:00:00.000Z");
});

test("buildBackfillChunks returns nothing for an empty or inverted range", () => {
  const d = new Date("2026-08-01T00:00:00.000Z");
  assert.deepEqual(buildBackfillChunks(d, d), []);
  assert.deepEqual(buildBackfillChunks(new Date(d.getTime() + DAY_MS), d), []);
  assert.deepEqual(buildBackfillChunks(new Date("nope"), d), []);
});

test("advanceWatermark seeds both fields from the first window", () => {
  const state = advanceWatermark(null, {
    from: new Date("2026-09-09T13:00:00.000Z"),
    to: NOW,
  });
  assert.equal(iso(state.watermark), "2026-09-16T00:00:00.000Z");
  assert.equal(iso(state.earliest), "2026-09-09T00:00:00.000Z");
});

test("advanceWatermark never regresses on a backfill of older history", () => {
  const existing = {
    watermark: new Date("2026-09-16T00:00:00.000Z"),
    earliest: new Date("2026-09-09T00:00:00.000Z"),
  };
  const state = advanceWatermark(existing, {
    from: new Date("2026-07-01T00:00:00.000Z"),
    to: new Date("2026-07-08T00:00:00.000Z"),
  });
  assert.equal(iso(state.watermark), "2026-09-16T00:00:00.000Z");
  assert.equal(iso(state.earliest), "2026-07-01T00:00:00.000Z");
});

test("advanceWatermark moves forward on a newer window", () => {
  const existing = {
    watermark: new Date("2026-09-10T00:00:00.000Z"),
    earliest: new Date("2026-09-01T00:00:00.000Z"),
  };
  const state = advanceWatermark(existing, {
    from: new Date("2026-09-08T00:00:00.000Z"),
    to: NOW,
  });
  assert.equal(iso(state.watermark), "2026-09-16T00:00:00.000Z");
  assert.equal(iso(state.earliest), "2026-09-01T00:00:00.000Z");
});

test("parseRequestedWindow accepts a valid ISO pair", () => {
  const result = parseRequestedWindow("2026-08-01T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
  assert.ok("window" in result);
  assert.equal(iso(result.window.from), "2026-08-01T00:00:00.000Z");
});

test("parseRequestedWindow rejects missing, invalid, inverted and oversized ranges", () => {
  assert.deepEqual(parseRequestedWindow(undefined, undefined), { error: "from_and_to_required" });
  assert.deepEqual(parseRequestedWindow("2026-08-01", undefined), { error: "from_and_to_required" });
  assert.deepEqual(parseRequestedWindow("nope", "2026-08-08"), { error: "invalid_date" });
  assert.deepEqual(parseRequestedWindow("2026-08-08", "2026-08-01"), { error: "to_before_from" });
  assert.deepEqual(
    parseRequestedWindow("2026-06-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"),
    { error: "window_too_long" },
  );
});
