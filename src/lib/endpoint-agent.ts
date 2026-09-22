import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type EndpointDevice } from "@prisma/client";
import { prisma } from "./prisma";
import {
  KNOWN_AI_TOOLS,
  findKnownTool,
  matchDomain,
  matchDomainHeuristic,
  resolveAIToolMatch,
  resolveToolCategory,
  type AIToolMatchResult,
  type KnownAITool,
} from "./ai-tools-registry";
import { findMatchingGovernedSystem } from "./governed-system-match";
import {
  dismissedDomainKey,
  initialDiscoveryObservation,
  mergeDiscoveryObservation,
} from "./discovery-merge";
import { logger } from "./observability";
import { getSetting } from "./settings";
import type {
  EndpointEnrollPayload,
  EndpointReportPayload,
} from "./validations/endpoint-agent";

/**
 * Server half of the endpoint agent (`ops/endpoint-agent`).
 *
 * Three jobs:
 *  1. Compile `ai-tools-registry` into a **manifest** the agent filters
 *     against locally, so detection knowledge stays in one place and an
 *     observation matching nothing known never leaves the endpoint.
 *  2. Enroll devices and issue per-device tokens.
 *  3. Ingest reports into `EndpointDetection`, and roll them up into
 *     `DiscoveredAITool` so Shadow AI triage works unchanged.
 *
 * See docs/plans/endpoint-agent.md.
 */

export const ENDPOINT_AGENT_DETECTION_SOURCE = "endpoint_agent";

/** Settings keys (AppSetting, falling back to env). */
export const ENDPOINT_ENROLLMENT_SECRET_KEY = "endpoint_agent_enrollment_secret";
export const ENDPOINT_REPORT_INTERVAL_KEY = "endpoint_agent_report_interval_seconds";
export const ENDPOINT_COLLECTORS_KEY = "endpoint_agent_collectors";

/** Default cadence. Deliberately slow — this is inventory, not tracing. */
const DEFAULT_REPORT_INTERVAL_SECONDS = 900;
const MIN_REPORT_INTERVAL_SECONDS = 60;
const MAX_REPORT_INTERVAL_SECONDS = 86_400;

/** No accepted report within this window marks a device STALE. */
export const ENDPOINT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
/** Ceiling on observation rows per report, mirroring the OTel routes' 5000. */
export const ENDPOINT_MAX_OBSERVATIONS = 5000;

/** Collector ids the agent understands. */
export const ENDPOINT_COLLECTORS = ["apps", "browser", "network", "runtimes"] as const;
export type EndpointCollector = (typeof ENDPOINT_COLLECTORS)[number];

/** Signals recorded on `EndpointDetection.signal`, one per collector. */
export const ENDPOINT_SIGNALS = ["app", "browser", "network", "runtime"] as const;
export type EndpointSignal = (typeof ENDPOINT_SIGNALS)[number];

export const ENDPOINT_SIGNAL_LABELS: Record<EndpointSignal, string> = {
  app: "Installed app",
  browser: "Browser",
  network: "Network",
  runtime: "Local runtime",
};

// ─── Local inference runtimes ────────────────────────────
// Ports and probe paths are endpoint-specific knowledge with no place in the
// shared tools registry, but entries name a registry tool where one exists so
// a local runtime lands on the same DiscoveredAITool row as its own traffic.

export interface LocalInferenceRuntime {
  id: string;
  label: string;
  /** Registry `toolName`, or null when the runtime has no registry entry. */
  toolName: string | null;
  vendor: string;
  /** Loopback ports to probe. */
  ports: number[];
  /**
   * HTTP path listing locally available models. The agent reports model
   * *names* only. Null means presence-only detection.
   */
  modelsPath: string | null;
}

export const LOCAL_INFERENCE_RUNTIMES: LocalInferenceRuntime[] = [
  {
    id: "ollama",
    label: "Ollama",
    toolName: "Ollama",
    vendor: "Ollama",
    ports: [11434],
    modelsPath: "/api/tags",
  },
  {
    id: "lm_studio",
    label: "LM Studio",
    toolName: "LM Studio",
    vendor: "Element Labs",
    ports: [1234],
    modelsPath: "/v1/models",
  },
  {
    id: "jan",
    label: "Jan",
    toolName: null,
    vendor: "Jan",
    ports: [1337],
    modelsPath: "/v1/models",
  },
  {
    id: "vllm",
    label: "vLLM",
    toolName: null,
    vendor: "vLLM",
    ports: [8000],
    modelsPath: "/v1/models",
  },
  {
    id: "text_generation_webui",
    label: "Text Generation WebUI",
    toolName: null,
    vendor: "oobabooga",
    ports: [5000, 7860],
    modelsPath: "/v1/models",
  },
  {
    // llama.cpp's own server and LocalAI both default to 8080 and both answer
    // the OpenAI-compatible `/v1/models`, so nothing on the wire distinguishes
    // them. Reporting one generic runtime is honest; guessing a product name
    // from a port number is not. The model list usually identifies it to a
    // human reviewer anyway.
    id: "local_openai_server",
    label: "Local OpenAI-compatible server",
    toolName: null,
    vendor: "Unknown",
    ports: [8080, 8081],
    modelsPath: "/v1/models",
  },
];

const RUNTIMES_BY_ID = new Map(LOCAL_INFERENCE_RUNTIMES.map((r) => [r.id, r]));

// ─── Manifest ────────────────────────────────────────────

export interface EndpointManifest {
  /** Content hash — the agent re-fetches only when this changes. */
  version: string;
  reportIntervalSeconds: number;
  collectors: Record<EndpointCollector, boolean>;
  /** Hostnames to allowlist browser history and DNS observations against. */
  domains: string[];
  /** Substrings matched case-insensitively against app names and bundle ids. */
  appPatterns: string[];
  runtimes: Array<{
    id: string;
    label: string;
    ports: number[];
    modelsPath: string | null;
  }>;
}

/**
 * Compile the registry into the agent's local filter.
 *
 * `appPatterns` deliberately merges `clientNamePatterns` and `appIdPatterns`
 * into one flat substring list: the agent only needs to decide "is this worth
 * reporting", and the authoritative match (which tool, at what confidence)
 * runs server-side in `ingestEndpointReport`. Keeping the agent's test crude
 * means a registry change never requires an agent release.
 *
 * Publisher patterns are *excluded*. They are single vendor words ("google",
 * "microsoft") that would make the agent report most of the software on a
 * corporate laptop; the server still uses them once a candidate is in hand.
 */
export async function buildDetectionManifest(): Promise<EndpointManifest> {
  const domains = new Set<string>();
  const appPatterns = new Set<string>();

  for (const tool of KNOWN_AI_TOOLS) {
    for (const domain of tool.domains) domains.add(domain.toLowerCase());
    for (const pattern of tool.clientNamePatterns) {
      const normalized = pattern.trim().toLowerCase();
      // One- and two-character patterns match everything; drop them rather
      // than have every agent report its whole Applications folder.
      if (normalized.length >= 3) appPatterns.add(normalized);
    }
    for (const appId of tool.appIdPatterns ?? []) {
      const normalized = appId.trim().toLowerCase();
      if (normalized.length >= 3) appPatterns.add(normalized);
    }
  }

  for (const runtime of LOCAL_INFERENCE_RUNTIMES) {
    appPatterns.add(runtime.id.replace(/_/g, " "));
    appPatterns.add(runtime.label.toLowerCase());
  }

  const manifest: Omit<EndpointManifest, "version"> = {
    reportIntervalSeconds: await getReportIntervalSeconds(),
    collectors: await getEnabledCollectors(),
    domains: [...domains].sort(),
    appPatterns: [...appPatterns].sort(),
    runtimes: LOCAL_INFERENCE_RUNTIMES.map((r) => ({
      id: r.id,
      label: r.label,
      ports: r.ports,
      modelsPath: r.modelsPath,
    })),
  };

  const version = createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex")
    .slice(0, 16);

  return { version, ...manifest };
}

async function getReportIntervalSeconds(): Promise<number> {
  const raw = await getSetting(ENDPOINT_REPORT_INTERVAL_KEY);
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_REPORT_INTERVAL_SECONDS;
  return Math.min(
    Math.max(parsed, MIN_REPORT_INTERVAL_SECONDS),
    MAX_REPORT_INTERVAL_SECONDS,
  );
}

/**
 * Which collectors are switched on, from a comma-separated setting. Absent
 * means all on; an unrecognized id is ignored rather than failing the fetch,
 * so a typo in Settings cannot take the whole fleet offline.
 */
export async function getEnabledCollectors(): Promise<Record<EndpointCollector, boolean>> {
  const raw = (await getSetting(ENDPOINT_COLLECTORS_KEY))?.trim();
  if (!raw) {
    return Object.fromEntries(ENDPOINT_COLLECTORS.map((c) => [c, true])) as Record<
      EndpointCollector,
      boolean
    >;
  }
  const enabled = new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  return Object.fromEntries(
    ENDPOINT_COLLECTORS.map((c) => [c, enabled.has(c)]),
  ) as Record<EndpointCollector, boolean>;
}

// ─── Tokens ──────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 256 bits of entropy, URL-safe. Returned to the agent exactly once. */
function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time compare of two hex digests. */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/** The org-wide enrollment secret, from settings or env. */
export async function getEnrollmentSecret(): Promise<string | null> {
  return (
    (await getSetting(ENDPOINT_ENROLLMENT_SECRET_KEY)) ??
    process.env.ENDPOINT_AGENT_ENROLLMENT_SECRET ??
    null
  );
}

// ─── Enrollment ──────────────────────────────────────────

export interface EnrollmentResult {
  device: EndpointDevice;
  /** Plaintext token. Present only in the enrollment response. */
  token: string;
  reEnrolled: boolean;
}

/**
 * Enroll, or re-enroll, a machine.
 *
 * Re-enrollment (agent reinstall, wiped state directory) updates the existing
 * row by `machineId` and issues a fresh token, which invalidates the old one.
 * That is the desired behaviour for a reinstall, and an acceptable one for an
 * attacker who already holds the enrollment secret *and* can name an existing
 * machineId — they would gain nothing they could not get by enrolling a new
 * device. A REVOKED device is the exception: it stays revoked, and re-running
 * the installer will not resurrect it.
 */
export async function enrollDevice(
  payload: EndpointEnrollPayload,
): Promise<EnrollmentResult | { revoked: true }> {
  const existing = await prisma.endpointDevice.findUnique({
    where: { machineId: payload.machineId },
  });

  if (existing?.status === "REVOKED") {
    logger.warn("endpoint_agent.enroll.revoked_device", {
      machineId: payload.machineId,
      deviceId: existing.id,
    });
    return { revoked: true };
  }

  const token = generateDeviceToken();
  const shared = {
    hostname: payload.hostname,
    platform: payload.platform,
    osVersion: payload.osVersion ?? null,
    arch: payload.arch ?? null,
    agentVersion: payload.agentVersion ?? null,
    userEmail: payload.userEmail?.toLowerCase() ?? null,
    userName: payload.userName ?? null,
    tokenHash: hashToken(token),
    tokenIssuedAt: new Date(),
    status: "ACTIVE",
    statusReason: null,
    lastSeenAt: new Date(),
  };

  const device = existing
    ? await prisma.endpointDevice.update({ where: { id: existing.id }, data: shared })
    : await prisma.endpointDevice.create({
        data: { machineId: payload.machineId, ...shared },
      });

  logger.info("endpoint_agent.enrolled", {
    deviceId: device.id,
    machineId: device.machineId,
    platform: device.platform,
    reEnrolled: Boolean(existing),
  });

  return { device, token, reEnrolled: Boolean(existing) };
}

/**
 * Resolve a device from its bearer token.
 *
 * Lookup is by token hash, which is not a unique column — a SHA-256 collision
 * is infeasible, but the constant-time re-check keeps the code honest about
 * what it relies on.
 */
export async function authenticateDevice(
  token: string | null | undefined,
): Promise<EndpointDevice | null> {
  if (!token) return null;
  const digest = hashToken(token);
  const device = await prisma.endpointDevice.findFirst({
    where: { tokenHash: digest },
  });
  if (!device) return null;
  if (!hashesMatch(device.tokenHash, digest)) return null;
  if (device.status === "REVOKED") return null;
  return device;
}

/** Record a successful authenticated call without touching report state. */
export async function touchDevice(deviceId: string): Promise<void> {
  await prisma.endpointDevice.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date() },
  });
}

// ─── Report ingest ───────────────────────────────────────

/** One normalized observation, whatever collector produced it. */
interface NormalizedObservation {
  signal: EndpointSignal;
  /** Registry tool name, or the raw observed name when nothing matched. */
  toolName: string;
  vendor: string | null;
  category: string | null;
  matchConfidence: string | null;
  /** Stable per-signal identity: bundle id, hostname, or runtime:port. */
  evidence: string;
  detail: Prisma.InputJsonValue | null;
  observations: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Registry domain used for the DiscoveredAITool rollup; null suppresses it. */
  rollupDomain: string | null;
  /** True when the registry recognized this; unmatched rows stay device-local. */
  matched: boolean;
}

export interface EndpointIngestResult {
  reportId: string;
  observations: number;
  matched: number;
  detectionsCreated: number;
  detectionsUpdated: number;
  discoveriesCreated: number;
  discoveriesUpdated: number;
}

/**
 * Clamp a client-supplied timestamp into a believable window.
 *
 * Endpoint clocks drift, get set wrong, and occasionally sit in 1970 or 2099.
 * An unclamped value would corrupt `firstSeenAt` ordering permanently, since
 * the merge takes the minimum and never walks it back.
 */
function clampTimestamp(value: string, now: Date): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return now;
  const floor = now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000;
  const ceiling = now.getTime() + 24 * 60 * 60 * 1000;
  if (parsed.getTime() < floor) return new Date(floor);
  if (parsed.getTime() > ceiling) return now;
  return parsed;
}

/** Primary rollup domain for a registry tool — its first, broadest host. */
function rollupDomainFor(tool: KnownAITool): string | null {
  return tool.domains[0]?.toLowerCase() ?? null;
}

function fromMatch(match: AIToolMatchResult) {
  return {
    toolName: match.tool.toolName,
    vendor: match.tool.vendor as string | null,
    category: match.tool.category as string | null,
    matchConfidence: match.confidence as string | null,
    rollupDomain: rollupDomainFor(match.tool),
  };
}

function normalizeReport(
  report: EndpointReportPayload,
  now: Date,
): NormalizedObservation[] {
  const out: NormalizedObservation[] = [];

  // Apps — name/bundle-id/publisher against the registry's name matcher.
  for (const app of report.apps) {
    const match = resolveAIToolMatch({
      clientName: app.name,
      publisherName: app.publisher ?? null,
      appIds: app.identifier ? [app.identifier] : [],
    });
    const base = match
      ? fromMatch(match)
      : {
          toolName: app.name,
          vendor: app.publisher ?? null,
          category: null,
          matchConfidence: null,
          rollupDomain: null,
        };
    out.push({
      signal: "app",
      ...base,
      evidence: (app.identifier ?? app.name).toLowerCase(),
      detail: {
        appName: app.name,
        publisher: app.publisher ?? null,
        version: app.version ?? null,
        running: app.running,
      },
      observations: app.count,
      firstSeenAt: clampTimestamp(app.firstSeen, now),
      lastSeenAt: clampTimestamp(app.lastSeen, now),
      matched: Boolean(match),
    });
  }

  // Browser and network — both are hostnames, matched the same way.
  const hostSignals: Array<{
    signal: EndpointSignal;
    domain: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    detail: Prisma.InputJsonValue | null;
  }> = [
    ...report.browser.map((b) => ({
      signal: "browser" as const,
      domain: b.domain,
      count: b.visits,
      firstSeen: b.firstSeen,
      lastSeen: b.lastSeen,
      detail: { browser: b.browser } as Prisma.InputJsonValue,
    })),
    ...report.network.map((n) => ({
      signal: "network" as const,
      domain: n.domain,
      count: n.count,
      firstSeen: n.firstSeen,
      lastSeen: n.lastSeen,
      detail: null,
    })),
  ];

  for (const entry of hostSignals) {
    const known = matchDomain(entry.domain);
    // The heuristic path catches hosts the agent allowlisted from an older
    // manifest, or ones the registry describes only by pattern.
    const heuristic = known ? null : matchDomainHeuristic(entry.domain);
    // The rollup domain is the registry's *canonical* host, not the one
    // observed. Browser history yields every host a tool touches —
    // chatgpt.com, auth.openai.com, platform.openai.com — and keying Shadow AI
    // on the observed host turned one person using ChatGPT into six
    // DiscoveredAITool rows and six identical alerts. `domains[0]` is what the
    // DNS importer already keys on, so endpoint and DNS observations of the
    // same tool now land on one row instead of competing. The specific host is
    // not lost: it is the `evidence` on the EndpointDetection row.
    const base = known
      ? {
          toolName: known.toolName,
          vendor: known.vendor as string | null,
          category: known.category as string | null,
          matchConfidence: "high" as string | null,
          rollupDomain: rollupDomainFor(known),
        }
      : heuristic
        ? {
            toolName: heuristic.tool.toolName,
            vendor: heuristic.tool.vendor as string | null,
            category: heuristic.tool.category as string | null,
            matchConfidence: heuristic.confidence as string | null,
            rollupDomain: rollupDomainFor(heuristic.tool),
          }
        : {
            toolName: entry.domain,
            vendor: null,
            category: null,
            matchConfidence: null,
            rollupDomain: null,
          };
    out.push({
      signal: entry.signal,
      ...base,
      evidence: entry.domain,
      detail: entry.detail,
      observations: entry.count,
      firstSeenAt: clampTimestamp(entry.firstSeen, now),
      lastSeenAt: clampTimestamp(entry.lastSeen, now),
      matched: Boolean(known || heuristic),
    });
  }

  // Local runtimes — identified by manifest id, not by guessing from a port.
  for (const runtime of report.runtimes) {
    const known = RUNTIMES_BY_ID.get(runtime.runtime);
    const registryTool = known?.toolName ? findKnownTool(known.toolName) : null;
    out.push({
      signal: "runtime",
      toolName: registryTool?.toolName ?? known?.label ?? runtime.runtime,
      vendor: registryTool?.vendor ?? known?.vendor ?? null,
      category: registryTool?.category ?? "ml_platform",
      // A listening port on loopback is direct evidence, not an inference.
      matchConfidence: registryTool ? "high" : "medium",
      evidence: `${runtime.runtime}:${runtime.port}`,
      detail: {
        runtime: runtime.runtime,
        label: known?.label ?? runtime.runtime,
        port: runtime.port,
        models: runtime.models,
      },
      observations: 1,
      firstSeenAt: clampTimestamp(runtime.firstSeen, now),
      lastSeenAt: clampTimestamp(runtime.lastSeen, now),
      rollupDomain: registryTool ? rollupDomainFor(registryTool) : null,
      matched: Boolean(known),
    });
  }

  return out;
}

/**
 * Ingest one report.
 *
 * Idempotency: `EndpointDetection` is keyed on
 * (device, signal, toolName, evidence) and merged, so a re-sent spooled report
 * cannot create duplicate rows. It *can* double-count `observations`, which is
 * why the agent clears its spool only on a 2xx and why counts are presented as
 * "activity", never as an audited total.
 */
export async function ingestEndpointReport(
  device: EndpointDevice,
  report: EndpointReportPayload,
): Promise<EndpointIngestResult> {
  const now = new Date();
  const observations = normalizeReport(report, now);

  let detectionsCreated = 0;
  let detectionsUpdated = 0;

  for (const observation of observations) {
    const existing = await prisma.endpointDetection.findUnique({
      where: {
        deviceId_signal_toolName_evidence: {
          deviceId: device.id,
          signal: observation.signal,
          toolName: observation.toolName,
          evidence: observation.evidence,
        },
      },
      select: { id: true, observations: true, firstSeenAt: true, lastSeenAt: true },
    });

    if (existing) {
      await prisma.endpointDetection.update({
        where: { id: existing.id },
        data: {
          vendor: observation.vendor,
          category: observation.category,
          matchConfidence: observation.matchConfidence,
          detail: observation.detail ?? Prisma.JsonNull,
          observations: existing.observations + observation.observations,
          firstSeenAt:
            observation.firstSeenAt < existing.firstSeenAt
              ? observation.firstSeenAt
              : existing.firstSeenAt,
          lastSeenAt:
            observation.lastSeenAt > existing.lastSeenAt
              ? observation.lastSeenAt
              : existing.lastSeenAt,
        },
      });
      detectionsUpdated++;
    } else {
      await prisma.endpointDetection.create({
        data: {
          deviceId: device.id,
          signal: observation.signal,
          toolName: observation.toolName,
          vendor: observation.vendor,
          category: observation.category,
          matchConfidence: observation.matchConfidence,
          evidence: observation.evidence,
          detail: observation.detail ?? Prisma.JsonNull,
          observations: observation.observations,
          firstSeenAt: observation.firstSeenAt,
          lastSeenAt: observation.lastSeenAt,
        },
      });
      detectionsCreated++;
    }
  }

  const rollup = await rollUpToDiscoveredTools(device, observations, now);

  await prisma.endpointDevice.update({
    where: { id: device.id },
    data: {
      lastSeenAt: now,
      lastReportAt: now,
      status: "ACTIVE",
      statusReason: null,
      agentVersion: report.agentVersion ?? device.agentVersion,
      osVersion: report.osVersion ?? device.osVersion,
      hostname: report.hostname ?? device.hostname,
      userEmail: report.userEmail?.toLowerCase() ?? device.userEmail,
      userName: report.userName ?? device.userName,
      collectorStatus: report.collectors as Prisma.InputJsonValue,
    },
  });

  const matched = observations.filter((o) => o.matched).length;
  logger.info("endpoint_agent.report.ingested", {
    deviceId: device.id,
    reportId: report.reportId,
    observations: observations.length,
    matched,
    detectionsCreated,
    detectionsUpdated,
    ...rollup,
  });

  return {
    reportId: report.reportId,
    observations: observations.length,
    matched,
    detectionsCreated,
    detectionsUpdated,
    ...rollup,
  };
}

/**
 * Fold a report's matched observations into Shadow AI.
 *
 * Observations collapse per (toolName, rollupDomain) first, so a device seeing
 * ChatGPT as an app, in the browser and over the network produces one
 * `DiscoveredAITool` touch, not three. `userCount` is the device's own user,
 * which `mergeDiscoveryObservation` reconciles across sources.
 *
 * Unmatched observations are deliberately excluded: an unrecognized app name
 * from one laptop is not shadow-AI evidence, and pushing it into the Shadow AI
 * queue would bury reviewers. It stays visible on the device's detail page.
 */
async function rollUpToDiscoveredTools(
  device: EndpointDevice,
  observations: NormalizedObservation[],
  observedAt: Date,
): Promise<{ discoveriesCreated: number; discoveriesUpdated: number }> {
  interface Rollup {
    toolName: string;
    vendor: string | null;
    domain: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
    signals: Set<EndpointSignal>;
  }

  const byKey = new Map<string, Rollup>();
  for (const observation of observations) {
    if (!observation.matched || !observation.rollupDomain) continue;
    const key = `${observation.toolName}|${observation.rollupDomain}`;
    const current = byKey.get(key);
    if (current) {
      current.signals.add(observation.signal);
      if (observation.firstSeenAt < current.firstSeenAt) {
        current.firstSeenAt = observation.firstSeenAt;
      }
      if (observation.lastSeenAt > current.lastSeenAt) {
        current.lastSeenAt = observation.lastSeenAt;
      }
    } else {
      byKey.set(key, {
        toolName: observation.toolName,
        vendor: observation.vendor,
        domain: observation.rollupDomain,
        firstSeenAt: observation.firstSeenAt,
        lastSeenAt: observation.lastSeenAt,
        signals: new Set([observation.signal]),
      });
    }
  }

  const userEmails = device.userEmail ? [device.userEmail] : [];
  let discoveriesCreated = 0;
  let discoveriesUpdated = 0;

  for (const entry of byKey.values()) {
    // Respect a reviewer's decision to dismiss this candidate.
    const dismissed = await prisma.dismissedCandidate.findUnique({
      where: {
        toolName_detectedDomain: {
          toolName: entry.toolName,
          detectedDomain: dismissedDomainKey(entry.domain),
        },
      },
    });
    if (dismissed) continue;

    const existing = await prisma.discoveredAITool.findFirst({
      where: { toolName: entry.toolName, detectedDomain: entry.domain },
    });

    if (existing) {
      const merged = mergeDiscoveryObservation(existing, {
        detectionSource: ENDPOINT_AGENT_DETECTION_SOURCE,
        userCount: userEmails.length,
        userEmails,
        scopes: [],
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        observedAt,
      });
      const data: Prisma.DiscoveredAIToolUpdateInput = {
        userCount: merged.userCount,
        userEmails: merged.userEmails,
        scopes: merged.scopes,
        firstSeenAt: merged.firstSeenAt,
        lastSeenAt: merged.lastSeenAt,
      };
      if (!existing.category) {
        const category = resolveToolCategory({
          toolName: entry.toolName,
          domain: entry.domain,
        });
        if (category) data.category = category;
      }
      await prisma.discoveredAITool.update({ where: { id: existing.id }, data });
      discoveriesUpdated++;
      continue;
    }

    const governedMatch = await findMatchingGovernedSystem({
      toolName: entry.toolName,
      vendor: entry.vendor ?? undefined,
      detectedDomain: entry.domain,
    });
    const initial = initialDiscoveryObservation({
      detectionSource: ENDPOINT_AGENT_DETECTION_SOURCE,
      userCount: userEmails.length,
      userEmails,
      scopes: [],
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      observedAt,
    });
    const signalList = [...entry.signals]
      .map((signal) => ENDPOINT_SIGNAL_LABELS[signal].toLowerCase())
      .join(", ");
    const baseNotes = `Auto-discovered by the endpoint agent on ${device.hostname} (${signalList}).`;

    try {
      const tool = await prisma.discoveredAITool.create({
        data: {
          toolName: entry.toolName,
          vendor: entry.vendor,
          detectedDomain: entry.domain,
          detectionSource: ENDPOINT_AGENT_DETECTION_SOURCE,
          userCount: initial.userCount,
          userEmails: initial.userEmails,
          scopes: initial.scopes,
          firstSeenAt: initial.firstSeenAt,
          lastSeenAt: initial.lastSeenAt,
          status: governedMatch ? "REGISTERED" : "DISCOVERED",
          linkedSystemId: governedMatch?.id,
          matchConfidence: "high",
          category: resolveToolCategory({
            toolName: entry.toolName,
            domain: entry.domain,
          }),
          notes: governedMatch
            ? `${baseNotes} Suppressed: matches governed system "${governedMatch.name}".`
            : baseNotes,
        },
      });
      discoveriesCreated++;

      if (!governedMatch) {
        await prisma.alert.create({
          data: {
            title: `Shadow AI detected: ${entry.toolName}`,
            description: `${entry.toolName}${entry.vendor ? ` (${entry.vendor})` : ""} observed by the endpoint agent on ${device.hostname}${device.userEmail ? ` (${device.userEmail})` : ""} via ${signalList}.`,
            // Local inference is the one endpoint signal that is high by
            // default: an un-proxied model running on a laptop sits outside
            // every control this platform can otherwise apply.
            severity: entry.signals.has("runtime") ? "HIGH" : "MEDIUM",
            source: "shadow_ai",
            relatedToolId: tool.id,
          },
        });
      }
    } catch (error) {
      // A concurrent report or scan created the same (toolName, domain)
      // between the findFirst and the create — fold into the update path.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const raced = await prisma.discoveredAITool.findFirst({
          where: { toolName: entry.toolName, detectedDomain: entry.domain },
        });
        if (raced) {
          const merged = mergeDiscoveryObservation(raced, {
            detectionSource: ENDPOINT_AGENT_DETECTION_SOURCE,
            userCount: userEmails.length,
            userEmails,
            scopes: [],
            firstSeenAt: entry.firstSeenAt,
            lastSeenAt: entry.lastSeenAt,
            observedAt,
          });
          await prisma.discoveredAITool.update({
            where: { id: raced.id },
            data: {
              userCount: merged.userCount,
              userEmails: merged.userEmails,
              scopes: merged.scopes,
              firstSeenAt: merged.firstSeenAt,
              lastSeenAt: merged.lastSeenAt,
            },
          });
          discoveriesUpdated++;
          continue;
        }
      }
      throw error;
    }
  }

  return { discoveriesCreated, discoveriesUpdated };
}

/**
 * Mark devices that have stopped reporting. Run from the scheduler sweep — a
 * fleet where agents quietly die is worse than no agent at all, because the
 * console then reads as "no AI activity" rather than "no data".
 */
export async function markStaleDevices(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ENDPOINT_STALE_AFTER_MS);
  const { count } = await prisma.endpointDevice.updateMany({
    where: {
      status: "ACTIVE",
      OR: [
        { lastReportAt: { lt: cutoff } },
        { lastReportAt: null, enrolledAt: { lt: cutoff } },
      ],
    },
    data: {
      status: "STALE",
      statusReason: "No report received within the staleness window.",
    },
  });
  if (count > 0) {
    logger.info("endpoint_agent.devices.marked_stale", { count });
  }
  return count;
}
