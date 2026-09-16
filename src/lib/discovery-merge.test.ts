import test from "node:test";
import assert from "node:assert/strict";
import {
  dismissedDomainKey,
  initialDiscoveryObservation,
  mergeDiscoveryObservation,
  mergeSeenWindow,
  mergeUserCount,
  normalizeEmails,
  normalizeScopes,
  pickEmails,
} from "./discovery-merge";

test("mergeUserCount lets a rescan from the same source lower the count", () => {
  assert.equal(
    mergeUserCount({ existingCount: 12, existingSource: "google_workspace", observedCount: 4, observedSource: "google_workspace" }),
    4
  );
  assert.equal(
    mergeUserCount({ existingCount: 3, existingSource: "hexnode", observedCount: 9, observedSource: "hexnode" }),
    9
  );
  // Never negative.
  assert.equal(
    mergeUserCount({ existingCount: 3, existingSource: "hexnode", observedCount: -1, observedSource: "hexnode" }),
    0
  );
});

test("mergeUserCount keeps the max when the observation comes from a different source", () => {
  assert.equal(
    mergeUserCount({ existingCount: 12, existingSource: "google_workspace", observedCount: 4, observedSource: "dns_proxy" }),
    12
  );
  assert.equal(
    mergeUserCount({ existingCount: 2, existingSource: "dns_proxy", observedCount: 7, observedSource: "microsoft_365" }),
    7
  );
});

test("mergeSeenWindow takes min for first seen and max for last seen", () => {
  const window = mergeSeenWindow({
    existingFirstSeenAt: new Date("2026-03-01T00:00:00Z"),
    existingLastSeenAt: new Date("2026-05-01T00:00:00Z"),
    observedFirstSeenAt: new Date("2026-02-15T00:00:00Z"),
    observedLastSeenAt: new Date("2026-04-01T00:00:00Z"),
    observedAt: new Date("2026-09-16T00:00:00Z"),
  });
  assert.equal(window.firstSeenAt.toISOString(), "2026-02-15T00:00:00.000Z");
  // Scan's last-seen was older than what we already had — keep the later one.
  assert.equal(window.lastSeenAt.toISOString(), "2026-05-01T00:00:00.000Z");
});

test("mergeSeenWindow falls back to the scan time when the source has no timestamps", () => {
  const observedAt = new Date("2026-09-16T12:00:00Z");
  const fresh = mergeSeenWindow({
    existingFirstSeenAt: null,
    existingLastSeenAt: null,
    observedAt,
  });
  assert.equal(fresh.firstSeenAt.getTime(), observedAt.getTime());
  assert.equal(fresh.lastSeenAt.getTime(), observedAt.getTime());

  const rescan = mergeSeenWindow({
    existingFirstSeenAt: new Date("2026-01-01T00:00:00Z"),
    existingLastSeenAt: new Date("2026-01-10T00:00:00Z"),
    observedAt,
  });
  assert.equal(rescan.firstSeenAt.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(rescan.lastSeenAt.getTime(), observedAt.getTime());
});

test("mergeSeenWindow ignores invalid dates", () => {
  const window = mergeSeenWindow({
    existingFirstSeenAt: new Date("not a date"),
    existingLastSeenAt: null,
    observedFirstSeenAt: new Date("2026-06-01T00:00:00Z"),
    observedLastSeenAt: new Date("garbage"),
    observedAt: new Date("2026-09-16T00:00:00Z"),
  });
  assert.equal(window.firstSeenAt.toISOString(), "2026-06-01T00:00:00.000Z");
  assert.equal(window.lastSeenAt.toISOString(), "2026-09-16T00:00:00.000Z");
});

test("normalizeEmails lowercases, trims, dedupes and sorts", () => {
  assert.deepEqual(
    normalizeEmails(["Bob@Acme.com", " alice@acme.com ", "bob@acme.com", "", "  "]),
    ["alice@acme.com", "bob@acme.com"]
  );
  assert.deepEqual(normalizeEmails(undefined), []);
});

test("normalizeScopes preserves case but dedupes and sorts", () => {
  assert.deepEqual(
    normalizeScopes(["User.Read", "openid", "User.Read", " profile "]),
    ["User.Read", "openid", "profile"]
  );
});

test("pickEmails keeps only email-shaped identities", () => {
  assert.deepEqual(
    pickEmails(["HOST-17", "jane@acme.com", "jdoe", "Ops@Acme.com"]),
    ["jane@acme.com", "ops@acme.com"]
  );
});

test("mergeDiscoveryObservation replaces emails/scopes and reports count changes", () => {
  const update = mergeDiscoveryObservation(
    {
      detectionSource: "google_workspace",
      userCount: 5,
      firstSeenAt: new Date("2026-01-01T00:00:00Z"),
      lastSeenAt: new Date("2026-02-01T00:00:00Z"),
    },
    {
      detectionSource: "google_workspace",
      userCount: 2,
      userEmails: ["Z@acme.com", "a@acme.com"],
      scopes: ["email", "openid"],
      firstSeenAt: new Date("2026-01-20T00:00:00Z"),
      lastSeenAt: new Date("2026-03-01T00:00:00Z"),
      observedAt: new Date("2026-03-02T00:00:00Z"),
    }
  );
  assert.equal(update.userCount, 2);
  assert.equal(update.userCountChanged, true);
  assert.deepEqual(update.userEmails, ["a@acme.com", "z@acme.com"]);
  assert.deepEqual(update.scopes, ["email", "openid"]);
  assert.equal(update.firstSeenAt.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(update.lastSeenAt.toISOString(), "2026-03-01T00:00:00.000Z");

  const unchanged = mergeDiscoveryObservation(
    { detectionSource: "dns_proxy", userCount: 5, firstSeenAt: null, lastSeenAt: null },
    { detectionSource: "hexnode", userCount: 3, observedAt: new Date() }
  );
  assert.equal(unchanged.userCount, 5);
  assert.equal(unchanged.userCountChanged, false);
});

test("initialDiscoveryObservation seeds the window from the scan or scan time", () => {
  const observedAt = new Date("2026-09-16T00:00:00Z");
  const seeded = initialDiscoveryObservation({
    detectionSource: "crowdstrike",
    userCount: 7,
    observedAt,
  });
  assert.equal(seeded.userCount, 7);
  assert.deepEqual(seeded.userEmails, []);
  assert.deepEqual(seeded.scopes, []);
  assert.equal(seeded.firstSeenAt.getTime(), observedAt.getTime());
  assert.equal(seeded.lastSeenAt.getTime(), observedAt.getTime());
});

test("dismissedDomainKey maps a missing domain to the empty-string placeholder", () => {
  assert.equal(dismissedDomainKey(null), "");
  assert.equal(dismissedDomainKey(undefined), "");
  assert.equal(dismissedDomainKey("claude.ai"), "claude.ai");
});
