import test from "node:test";
import assert from "node:assert/strict";
import { formatSyncAge, syncStaleness } from "./proxy-health-age";

const T0 = Date.parse("2026-09-16T12:00:00Z");
const minutesAgo = (m: number) => new Date(T0 - m * 60_000).toISOString();

test("formatSyncAge renders minutes, hours and days", () => {
  assert.equal(formatSyncAge(minutesAgo(0.5), T0), "just now");
  assert.equal(formatSyncAge(minutesAgo(1), T0), "1 min ago");
  assert.equal(formatSyncAge(minutesAgo(14), T0), "14 min ago");
  assert.equal(formatSyncAge(minutesAgo(59), T0), "59 min ago");
  assert.equal(formatSyncAge(minutesAgo(60), T0), "1 hr ago");
  assert.equal(formatSyncAge(minutesAgo(23 * 60 + 59), T0), "23 hr ago");
  assert.equal(formatSyncAge(minutesAgo(48 * 60), T0), "2 d ago");
});

test("formatSyncAge accepts Date instances", () => {
  assert.equal(formatSyncAge(new Date(T0 - 5 * 60_000), T0), "5 min ago");
});

test("syncStaleness allows one missed 15-minute tick before warning", () => {
  assert.equal(syncStaleness(minutesAgo(0), T0), "fresh");
  assert.equal(syncStaleness(minutesAgo(15), T0), "fresh");
  assert.equal(syncStaleness(minutesAgo(35), T0), "fresh");
  assert.equal(syncStaleness(minutesAgo(36), T0), "overdue");
  assert.equal(syncStaleness(minutesAgo(60), T0), "overdue");
  assert.equal(syncStaleness(minutesAgo(61), T0), "stale");
});

test("syncStaleness treats a missing snapshot as stale", () => {
  assert.equal(syncStaleness(null, T0), "stale");
  assert.equal(syncStaleness(undefined, T0), "stale");
});
