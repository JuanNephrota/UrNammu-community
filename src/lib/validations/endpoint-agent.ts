import { z } from "zod";

/**
 * Wire schemas for the endpoint agent (`ops/endpoint-agent`).
 *
 * Design rule: the agent may only ever send *identifiers and counts*. There is
 * no field here that can carry a prompt, a response, a URL path, a window
 * title or a file path, and adding one would break the promise the agent is
 * deployed on (docs/plans/endpoint-agent.md). Hostnames are bare — the
 * `hostname` schema rejects anything containing a slash, so a full URL cannot
 * be smuggled through a domain field even by a compromised agent.
 */

/** Bare hostname: no scheme, no path, no query, no credentials, no port. */
const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    "must be a bare hostname (no scheme, path, port or credentials)",
  );

/** Short free-text identifier — app name, publisher, model id. */
const label = z.string().trim().min(1).max(200);

/**
 * Timestamps come off a machine whose clock we do not control. They are
 * validated as parseable here and clamped to a sane window at ingest, so a
 * laptop with a wrong year cannot poison `firstSeenAt`/`lastSeenAt` ordering.
 */
const timestamp = z.string().datetime({ offset: true });

/** Machine identity. Opaque to us — we only require it to be stable. */
const machineId = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/, "must be an opaque identifier");

export const endpointPlatformSchema = z.enum(["darwin", "windows"]);
export type EndpointPlatform = z.infer<typeof endpointPlatformSchema>;

// ─── Enrollment ──────────────────────────────────────────

export const endpointEnrollSchema = z.object({
  machineId,
  hostname: z.string().trim().min(1).max(253),
  platform: endpointPlatformSchema,
  osVersion: label.nullish(),
  arch: label.nullish(),
  agentVersion: label.nullish(),
  /** Console user. Best-effort — shared and unjoined machines report null. */
  userEmail: z.string().trim().email().max(320).nullish(),
  userName: label.nullish(),
});
export type EndpointEnrollPayload = z.infer<typeof endpointEnrollSchema>;

// ─── Observations ────────────────────────────────────────

/** An installed or running AI application. */
export const endpointAppObservationSchema = z.object({
  /** Display name as the OS reports it. */
  name: label,
  /** macOS bundle id / Windows registry key or image name. */
  identifier: label.nullish(),
  publisher: label.nullish(),
  version: label.nullish(),
  /** Whether the app was running at collection time, not merely installed. */
  running: z.boolean().default(false),
  /** Launches or running-samples seen since the last report. */
  count: z.number().int().min(0).max(1_000_000).default(1),
  firstSeen: timestamp,
  lastSeen: timestamp,
});

/**
 * An allowlisted AI hostname seen in browser history. The agent filters
 * against the server-issued manifest before this leaves the machine, so a
 * hostname that matches no known AI tool is never transmitted.
 */
export const endpointBrowserObservationSchema = z.object({
  domain: hostname,
  /** "chrome" | "edge" | "brave" | "arc" | "firefox" | "safari" */
  browser: label,
  visits: z.number().int().min(0).max(1_000_000).default(1),
  firstSeen: timestamp,
  lastSeen: timestamp,
});

/** An allowlisted AI hostname seen in the DNS cache or an open connection. */
export const endpointNetworkObservationSchema = z.object({
  domain: hostname,
  count: z.number().int().min(0).max(1_000_000).default(1),
  firstSeen: timestamp,
  lastSeen: timestamp,
});

/** A local inference runtime listening on the loopback interface. */
export const endpointRuntimeObservationSchema = z.object({
  /** Manifest runtime id, e.g. "ollama", "lm_studio", "llama_cpp". */
  runtime: label,
  port: z.number().int().min(1).max(65535),
  /** Models the runtime reports as available locally. Names only. */
  models: z.array(label).max(200).default([]),
  firstSeen: timestamp,
  lastSeen: timestamp,
});

/**
 * Per-collector outcome, so the console can distinguish "no AI found" from
 * "this collector could not run" (Safari without Full Disk Access is the
 * common case). Keyed by collector name.
 */
export const endpointCollectorStatusSchema = z.record(
  z.string().trim().min(1).max(64),
  z.object({
    ok: z.boolean(),
    /** Short machine-readable reason, e.g. "no_access", "not_installed". */
    reason: label.nullish(),
    itemsScanned: z.number().int().min(0).max(10_000_000).nullish(),
  }),
);

export const endpointReportSchema = z.object({
  /** UUID per report. Re-sending a spooled report is a no-op. */
  reportId: z.string().trim().uuid(),
  machineId,
  agentVersion: label.nullish(),
  osVersion: label.nullish(),
  hostname: z.string().trim().min(1).max(253).nullish(),
  userEmail: z.string().trim().email().max(320).nullish(),
  userName: label.nullish(),
  collectedAt: timestamp,
  apps: z.array(endpointAppObservationSchema).max(2000).default([]),
  browser: z.array(endpointBrowserObservationSchema).max(5000).default([]),
  network: z.array(endpointNetworkObservationSchema).max(5000).default([]),
  runtimes: z.array(endpointRuntimeObservationSchema).max(100).default([]),
  collectors: endpointCollectorStatusSchema.default({}),
});
export type EndpointReportPayload = z.infer<typeof endpointReportSchema>;
export type EndpointAppObservation = z.infer<typeof endpointAppObservationSchema>;
export type EndpointBrowserObservation = z.infer<typeof endpointBrowserObservationSchema>;
export type EndpointNetworkObservation = z.infer<typeof endpointNetworkObservationSchema>;
export type EndpointRuntimeObservation = z.infer<typeof endpointRuntimeObservationSchema>;

/** Total observation rows in a report, used for the payload ceiling. */
export function countReportObservations(report: EndpointReportPayload): number {
  return (
    report.apps.length +
    report.browser.length +
    report.network.length +
    report.runtimes.length
  );
}
