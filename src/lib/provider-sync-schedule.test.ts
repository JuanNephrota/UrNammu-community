import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isDiscoveryScanSource,
  isSyncProvider,
  resolveDiscoveryScanSchedule,
  resolveProviderSyncSchedule,
  SYNC_PROVIDERS,
} from "./provider-sync-schedule";

const NOW = new Date("2026-09-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

const base = {
  globalEnabledRaw: null,
  globalIntervalRaw: null,
  providerEnabledRaw: null,
  providerIntervalRaw: null,
  lastSucceededAt: null,
  running: false,
  configured: true,
  now: NOW,
};

describe("resolveProviderSyncSchedule", () => {
  it("is due immediately with built-in defaults and no prior run", () => {
    const schedule = resolveProviderSyncSchedule(base);
    assert.equal(schedule.enabled, true);
    assert.equal(schedule.enabledSource, "default");
    assert.equal(schedule.intervalHours, 6);
    assert.equal(schedule.intervalSource, "default");
    assert.equal(schedule.due, true);
    assert.equal(schedule.nextDueAt, null);
    assert.equal(schedule.skippedReason, undefined);
  });

  it("falls back to the global keys when no provider override exists", () => {
    const schedule = resolveProviderSyncSchedule({
      ...base,
      globalEnabledRaw: "true",
      globalIntervalRaw: "12",
      lastSucceededAt: hoursAgo(7),
    });
    assert.equal(schedule.intervalHours, 12);
    assert.equal(schedule.intervalSource, "global");
    assert.equal(schedule.enabledSource, "global");
    assert.equal(schedule.due, false);
    assert.match(schedule.skippedReason ?? "", /Not due yet/);
    assert.equal(schedule.nextDueAt?.toISOString(), hoursAgo(-5).toISOString());
  });

  it("lets a provider override win over the global keys", () => {
    const schedule = resolveProviderSyncSchedule({
      ...base,
      globalEnabledRaw: "true",
      globalIntervalRaw: "24",
      providerIntervalRaw: "1",
      lastSucceededAt: hoursAgo(2),
    });
    assert.equal(schedule.intervalHours, 1);
    assert.equal(schedule.intervalSource, "provider");
    assert.equal(schedule.due, true);
  });

  it("lets a provider disable itself while the global switch is on", () => {
    const schedule = resolveProviderSyncSchedule({
      ...base,
      globalEnabledRaw: "true",
      providerEnabledRaw: "false",
    });
    assert.equal(schedule.enabled, false);
    assert.equal(schedule.enabledSource, "provider");
    assert.equal(schedule.due, false);
    assert.equal(schedule.skippedReason, "Sync is disabled.");
  });

  it("lets a provider enable itself while the global switch is off", () => {
    const schedule = resolveProviderSyncSchedule({
      ...base,
      globalEnabledRaw: "false",
      providerEnabledRaw: "true",
    });
    assert.equal(schedule.enabled, true);
    assert.equal(schedule.due, true);
  });

  it("ignores an invalid provider interval and inherits the global one", () => {
    const schedule = resolveProviderSyncSchedule({
      ...base,
      globalIntervalRaw: "6",
      providerIntervalRaw: "not-a-number",
    });
    assert.equal(schedule.intervalHours, 6);
    assert.equal(schedule.intervalSource, "global");
  });

  it("does not run while a fresh RUNNING row exists for this provider", () => {
    const schedule = resolveProviderSyncSchedule({ ...base, running: true });
    assert.equal(schedule.due, false);
    assert.match(schedule.skippedReason ?? "", /already running/);
  });

  it("skips unconfigured providers without treating them as due", () => {
    const schedule = resolveProviderSyncSchedule({ ...base, configured: false });
    assert.equal(schedule.due, false);
    assert.equal(schedule.skippedReason, "Provider is not configured.");
  });

  it("keys due-ness off this provider's own last success", () => {
    // Anthropic succeeded 1h ago; Cursor has never succeeded. Each provider is
    // resolved independently, so the Anthropic success must not delay Cursor.
    const anthropic = resolveProviderSyncSchedule({
      ...base,
      globalIntervalRaw: "6",
      lastSucceededAt: hoursAgo(1),
    });
    const cursor = resolveProviderSyncSchedule({
      ...base,
      globalIntervalRaw: "6",
      lastSucceededAt: null,
    });
    assert.equal(anthropic.due, false);
    assert.equal(cursor.due, true);
  });
});

describe("resolveDiscoveryScanSchedule", () => {
  it("defaults to disabled with a 24 hour interval", () => {
    const schedule = resolveDiscoveryScanSchedule("google_workspace", {
      enabledRaw: null,
      intervalRaw: null,
      lastCompletedAt: null,
      running: false,
      configured: true,
      now: NOW,
    });
    assert.equal(schedule.enabled, false);
    assert.equal(schedule.intervalHours, 24);
    assert.equal(schedule.due, false);
    assert.equal(schedule.skippedReason, "Google Workspace auto-scan is disabled.");
  });

  it("is due when enabled, configured, idle, and past the interval", () => {
    const schedule = resolveDiscoveryScanSchedule("hexnode", {
      enabledRaw: "true",
      intervalRaw: "12",
      lastCompletedAt: hoursAgo(13),
      running: false,
      configured: true,
      now: NOW,
    });
    assert.equal(schedule.due, true);
    assert.equal(schedule.skippedReason, undefined);
  });

  it("reports the not-configured and already-running reasons", () => {
    const unconfigured = resolveDiscoveryScanSchedule("crowdstrike", {
      enabledRaw: "true",
      intervalRaw: null,
      lastCompletedAt: null,
      running: false,
      configured: false,
      now: NOW,
    });
    assert.equal(unconfigured.skippedReason, "CrowdStrike is not configured.");

    const running = resolveDiscoveryScanSchedule("microsoft_365", {
      enabledRaw: "true",
      intervalRaw: null,
      lastCompletedAt: null,
      running: true,
      configured: true,
      now: NOW,
    });
    assert.equal(running.skippedReason, "A Microsoft 365 scan is already running.");
  });
});

describe("id guards", () => {
  it("recognises every sync provider and rejects unknown ids", () => {
    for (const provider of SYNC_PROVIDERS) assert.equal(isSyncProvider(provider), true);
    assert.equal(isSyncProvider("mistral"), false);
    assert.equal(isSyncProvider(""), false);
  });

  it("recognises discovery scan sources", () => {
    assert.equal(isDiscoveryScanSource("google_workspace"), true);
    assert.equal(isDiscoveryScanSource("netskope"), false);
  });
});
