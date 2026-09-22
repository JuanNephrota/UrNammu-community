import { prisma } from "./prisma";
import {
  ENDPOINT_COLLECTORS,
  ENDPOINT_SIGNAL_LABELS,
  ENDPOINT_STALE_AFTER_MS,
  type EndpointCollector,
  type EndpointSignal,
} from "./endpoint-agent";

/**
 * Read models for the Endpoints console pages.
 *
 * Kept out of `endpoint-agent.ts` so the ingest path — which runs on every
 * report from every machine — does not drag page-shaped query code with it.
 */

export interface FleetDevice {
  id: string;
  hostname: string;
  platform: string;
  osVersion: string | null;
  agentVersion: string | null;
  userEmail: string | null;
  status: string;
  statusReason: string | null;
  enrolledAt: Date;
  lastReportAt: Date | null;
  detectionCount: number;
  /** Collectors that reported a failure on the last cycle. */
  degradedCollectors: Array<{ collector: string; reason: string }>;
}

export interface FleetSummary {
  total: number;
  active: number;
  stale: number;
  revoked: number;
  /** Devices with at least one local inference runtime — the headline risk. */
  withLocalRuntime: number;
  /** Distinct AI tools seen across the fleet. */
  distinctTools: number;
  degraded: number;
}

export interface FleetToolRow {
  toolName: string;
  vendor: string | null;
  category: string | null;
  deviceCount: number;
  observations: number;
  signals: string[];
  lastSeenAt: Date;
}

export interface FleetView {
  summary: FleetSummary;
  devices: FleetDevice[];
  tools: FleetToolRow[];
  /** True when nothing has ever enrolled, which drives the empty state. */
  neverEnrolled: boolean;
}

/**
 * Collector failures worth surfacing on the device row.
 *
 * `unsupported_platform` is excluded: the macOS network collector reports it on
 * every cycle by design, and showing it as a fault would train operators to
 * ignore the degraded column entirely.
 */
function degradedFrom(collectorStatus: unknown): Array<{ collector: string; reason: string }> {
  if (!collectorStatus || typeof collectorStatus !== "object") return [];
  const out: Array<{ collector: string; reason: string }> = [];
  for (const collector of ENDPOINT_COLLECTORS) {
    const entry = (collectorStatus as Record<string, unknown>)[collector];
    if (!entry || typeof entry !== "object") continue;
    const { ok, reason } = entry as { ok?: boolean; reason?: string };
    if (reason === "unsupported_platform") continue;
    // A partial failure still reports ok:true — the browser collector that
    // read Chrome but was refused Safari. That is exactly the case an
    // operator needs to see, so it counts as degraded too.
    if (ok === false || (reason && reason.length > 0)) {
      out.push({ collector, reason: reason ?? "unknown" });
    }
  }
  return out;
}

export const COLLECTOR_REASON_LABELS: Record<string, string> = {
  no_access: "No file access",
  partial_no_access: "Some profiles unreadable",
  no_profiles: "No browser profiles found",
  unreadable: "Could not read history",
  registry_unavailable: "Registry unavailable",
  dns_cache_unavailable: "DNS cache unavailable",
  dns_cache_unparseable: "DNS cache unreadable",
  unsupported_platform: "Not supported on this OS",
  unknown: "Unknown",
};

export function collectorReasonLabel(reason: string): string {
  return COLLECTOR_REASON_LABELS[reason] ?? reason;
}

export function signalLabel(signal: string): string {
  return ENDPOINT_SIGNAL_LABELS[signal as EndpointSignal] ?? signal;
}

export function collectorLabel(collector: string): string {
  const labels: Record<EndpointCollector, string> = {
    apps: "Apps",
    browser: "Browser",
    network: "Network",
    runtimes: "Local runtimes",
  };
  return labels[collector as EndpointCollector] ?? collector;
}

/** Whether a device has gone quiet, computed rather than trusting `status`. */
export function isStale(device: { status: string; lastReportAt: Date | null }, now = new Date()) {
  if (device.status !== "ACTIVE") return device.status === "STALE";
  if (!device.lastReportAt) return true;
  return now.getTime() - device.lastReportAt.getTime() > ENDPOINT_STALE_AFTER_MS;
}

export async function loadFleetView(): Promise<FleetView> {
  const [devices, statusCounts, detections, runtimeDevices] = await Promise.all([
    prisma.endpointDevice.findMany({
      orderBy: [{ lastReportAt: { sort: "desc", nulls: "last" } }, { hostname: "asc" }],
      take: 500,
      select: {
        id: true,
        hostname: true,
        platform: true,
        osVersion: true,
        agentVersion: true,
        userEmail: true,
        status: true,
        statusReason: true,
        enrolledAt: true,
        lastReportAt: true,
        collectorStatus: true,
        _count: { select: { detections: true } },
      },
    }),
    prisma.endpointDevice.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.endpointDetection.groupBy({
      by: ["toolName", "vendor", "category", "signal"],
      _sum: { observations: true },
      _max: { lastSeenAt: true },
      _count: { _all: true },
    }),
    prisma.endpointDetection.findMany({
      where: { signal: "runtime" },
      distinct: ["deviceId"],
      select: { deviceId: true },
    }),
  ]);

  // Per-tool device counts need distinct devices, which groupBy cannot give in
  // the same pass — a tool seen through three signals on one laptop is one
  // device, not three.
  const deviceCounts = await prisma.endpointDetection.findMany({
    distinct: ["toolName", "deviceId"],
    select: { toolName: true },
  });
  const devicesPerTool = new Map<string, number>();
  for (const row of deviceCounts) {
    devicesPerTool.set(row.toolName, (devicesPerTool.get(row.toolName) ?? 0) + 1);
  }

  const toolMap = new Map<string, FleetToolRow>();
  for (const row of detections) {
    const existing = toolMap.get(row.toolName);
    const lastSeen = row._max.lastSeenAt ?? new Date(0);
    if (existing) {
      existing.observations += row._sum.observations ?? 0;
      if (!existing.signals.includes(row.signal)) existing.signals.push(row.signal);
      if (lastSeen > existing.lastSeenAt) existing.lastSeenAt = lastSeen;
      existing.vendor = existing.vendor ?? row.vendor;
      existing.category = existing.category ?? row.category;
    } else {
      toolMap.set(row.toolName, {
        toolName: row.toolName,
        vendor: row.vendor,
        category: row.category,
        deviceCount: devicesPerTool.get(row.toolName) ?? 0,
        observations: row._sum.observations ?? 0,
        signals: [row.signal],
        lastSeenAt: lastSeen,
      });
    }
  }

  const byStatus = (status: string) =>
    statusCounts.find((s) => s.status === status)?._count._all ?? 0;

  const fleetDevices: FleetDevice[] = devices.map((device) => ({
    id: device.id,
    hostname: device.hostname,
    platform: device.platform,
    osVersion: device.osVersion,
    agentVersion: device.agentVersion,
    userEmail: device.userEmail,
    status: device.status,
    statusReason: device.statusReason,
    enrolledAt: device.enrolledAt,
    lastReportAt: device.lastReportAt,
    detectionCount: device._count.detections,
    degradedCollectors: degradedFrom(device.collectorStatus),
  }));

  const total = statusCounts.reduce((sum, s) => sum + s._count._all, 0);

  return {
    summary: {
      total,
      active: byStatus("ACTIVE"),
      stale: byStatus("STALE"),
      revoked: byStatus("REVOKED"),
      withLocalRuntime: runtimeDevices.length,
      distinctTools: toolMap.size,
      degraded: fleetDevices.filter((d) => d.degradedCollectors.length > 0).length,
    },
    devices: fleetDevices,
    tools: [...toolMap.values()].sort((a, b) => b.deviceCount - a.deviceCount),
    neverEnrolled: total === 0,
  };
}
