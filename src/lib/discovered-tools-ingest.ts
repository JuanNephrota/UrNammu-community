import { prisma } from "./prisma";
import { matchDomain } from "./ai-tools-registry";
import { findMatchingGovernedSystem } from "./governed-system-match";
import { logger } from "./observability";
import { parseCsv } from "./csv";

export type LogEntry = {
  domain: string;
  user?: string;
  department?: string;
  count?: number;
};

export type IngestResult = {
  processed: number;
  matched: number;
  newTools: number;
  updatedTools: number;
  details: { toolName: string; action: string; userCount: number; hits: number }[];
  ingestionRunId?: string;
};

export const DNS_PROXY_IMPORT_SOURCES = [
  { id: "dns_proxy", label: "DNS / Web Proxy", description: "Generic DNS or secure web gateway export." },
  { id: "umbrella", label: "Cisco Umbrella", description: "Umbrella DNS or activity search export." },
  { id: "cloudflare_gateway", label: "Cloudflare Gateway", description: "Gateway DNS / HTTP activity export." },
  { id: "zscaler", label: "Zscaler", description: "ZIA web or DNS log export." },
  { id: "netskope", label: "Netskope", description: "Netskope web transaction or alert export." },
  { id: "prisma_access", label: "Palo Alto Prisma Access", description: "Prisma Access / SASE traffic export." },
  { id: "dnsfilter", label: "DNSFilter", description: "DNSFilter query log export." },
  { id: "nextdns", label: "NextDNS", description: "NextDNS analytics export." },
  { id: "firewall", label: "Firewall", description: "Firewall or network security appliance export." },
  { id: "siem", label: "SIEM Export", description: "Normalized SIEM export with DNS fields." },
  { id: "other", label: "Other", description: "Fallback parser for custom exports." },
] as const;

type CsvHeaderPreset = {
  domain: string[];
  user: string[];
  actor: string[];
  department: string[];
  count: string[];
};

const DEFAULT_HEADER_PRESET: CsvHeaderPreset = {
  domain: ["domain", "host", "hostname", "destination", "destination fqdn", "url", "query", "fqdn"],
  user: ["user", "email", "username", "source_user", "identity", "user email"],
  actor: ["device name", "device", "computername", "computer name", "client name", "host name"],
  department: ["department", "dept", "group", "team", "organizational unit"],
  count: ["count", "hits", "requests", "queries", "repeatcnt"],
};

const SOURCE_HEADER_PRESETS: Record<string, Partial<CsvHeaderPreset>> = {
  umbrella: {
    domain: ["domain", "destination", "destination fqdn", "query", "query name", "blocked domain", "fqdn"],
    user: ["identity", "most granular identity", "user", "user email", "identity name"],
    actor: ["internalip", "externalip", "device", "computername"],
    department: ["group", "identity type", "department"],
  },
  cloudflare_gateway: {
    domain: ["host", "hostname", "query name", "destination fqdn", "destination", "url", "domain"],
    user: ["email", "user", "user email", "identity", "device user"],
    actor: ["device name", "source ip", "client ip", "client name"],
    department: ["team", "group", "department"],
  },
  zscaler: {
    domain: ["url", "host", "hostname", "destination host", "destination domain", "fqdn", "domain"],
    user: ["user", "user name", "login", "email", "source user"],
    actor: ["location", "client ip", "host", "device name"],
    department: ["department", "dept", "group", "location"],
  },
  netskope: {
    domain: ["url", "hostname", "domain", "dsthostname", "destination", "destination fqdn"],
    user: ["user", "user name", "user id", "email"],
    actor: ["device name", "instance", "client name", "host"],
    department: ["department", "group", "organizational unit"],
  },
  prisma_access: {
    domain: ["fqdn", "host", "url", "domain", "misc", "destination"],
    user: ["srcuser", "source user", "user", "user name", "email"],
    actor: ["serial", "hostname", "device name", "source address", "src"],
    department: ["group", "department", "source zone"],
    count: ["repeatcnt", "count", "hits", "sessions"],
  },
  dnsfilter: {
    domain: ["query", "domain", "hostname", "destination", "fqdn"],
    user: ["user", "username", "user email", "roaming client", "identity"],
    actor: ["client name", "device name", "source ip"],
    department: ["group", "policy", "department"],
  },
  nextdns: {
    domain: ["domain", "query", "host", "hostname"],
    user: ["user", "profile", "email"],
    actor: ["device name", "client name", "device"],
    department: ["profile", "department", "group"],
  },
};

function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.includes("://")) return new URL(trimmed).hostname;
  } catch {
    return trimmed;
  }

  return trimmed.toLowerCase().replace(/\.$/, "");
}

function normalizeHeader(raw: string) {
  return raw.trim().toLowerCase().replace(/[_-]+/g, " ");
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(header));
}

function mergePreset(source: string): CsvHeaderPreset {
  const specific = SOURCE_HEADER_PRESETS[source] ?? {};
  return {
    domain: [...(specific.domain ?? []), ...DEFAULT_HEADER_PRESET.domain],
    user: [...(specific.user ?? []), ...DEFAULT_HEADER_PRESET.user],
    actor: [...(specific.actor ?? []), ...DEFAULT_HEADER_PRESET.actor],
    department: [...(specific.department ?? []), ...DEFAULT_HEADER_PRESET.department],
    count: [...(specific.count ?? []), ...DEFAULT_HEADER_PRESET.count],
  };
}

function parseCount(raw: string | undefined) {
  const normalized = (raw ?? "").replace(/,/g, "").trim();
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function parseEntriesFromCsv(text: string, source: string = "dns_proxy"): LogEntry[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const firstRow = rows[0].map((value) => normalizeHeader(value));
  const preset = mergePreset(source);
  const hasHeaders =
    preset.domain.some((header) => firstRow.includes(header)) ||
    preset.user.some((header) => firstRow.includes(header)) ||
    preset.actor.some((header) => firstRow.includes(header));

  const entries: LogEntry[] = [];

  if (hasHeaders) {
    const domainIdx = findHeaderIndex(firstRow, preset.domain);
    const userIdx = findHeaderIndex(firstRow, preset.user);
    const actorIdx = findHeaderIndex(firstRow, preset.actor);
    const deptIdx = findHeaderIndex(firstRow, preset.department);
    const countIdx = findHeaderIndex(firstRow, preset.count);

    for (const cols of rows.slice(1)) {
      const domain = domainIdx >= 0 ? normalizeDomain(cols[domainIdx] ?? "") : null;
      if (!domain) continue;

      const userValue = userIdx >= 0 ? cols[userIdx]?.trim() || undefined : undefined;
      const actorValue = actorIdx >= 0 ? cols[actorIdx]?.trim() || undefined : undefined;

      entries.push({
        domain,
        user: userValue ?? actorValue,
        department: deptIdx >= 0 ? cols[deptIdx]?.trim() || undefined : undefined,
        count: countIdx >= 0 ? parseCount(cols[countIdx]) : 1,
      });
    }
    return entries;
  }

  for (const row of rows) {
    const domain = normalizeDomain(row[0] ?? "");
    if (domain) entries.push({ domain });
  }

  return entries;
}

async function runIngestion(source: string, entries: LogEntry[]) {
  const toolMap = new Map<
    string,
    {
      toolName: string;
      vendor: string;
      domain: string;
      users: Set<string>;
      departments: Set<string>;
      totalHits: number;
    }
  >();

  let processed = 0;

  for (const entry of entries) {
    if (!entry.domain) continue;
    processed++;

    const match = matchDomain(entry.domain);
    if (!match) continue;

    const key = `${match.toolName}::${match.domains[0]}`;
    const existing = toolMap.get(key);

    if (existing) {
      if (entry.user) existing.users.add(entry.user);
      if (entry.department) existing.departments.add(entry.department);
      existing.totalHits += entry.count ?? 1;
      continue;
    }

    toolMap.set(key, {
      toolName: match.toolName,
      vendor: match.vendor,
      domain: match.domains[0],
      users: new Set(entry.user ? [entry.user] : []),
      departments: new Set(entry.department ? [entry.department] : []),
      totalHits: entry.count ?? 1,
    });
  }

  let newTools = 0;
  let updatedTools = 0;
  const details: { toolName: string; action: string; userCount: number; hits: number }[] = [];

  for (const discovery of toolMap.values()) {
    const userCount = Math.max(discovery.users.size, 1);
    const department =
      discovery.departments.size > 0
        ? Array.from(discovery.departments).join(", ")
        : null;

    const existing = await prisma.discoveredAITool.findFirst({
      where: {
        toolName: discovery.toolName,
        detectedDomain: discovery.domain,
      },
    });

    if (existing) {
      const newUserCount = Math.max(existing.userCount, userCount);
      await prisma.discoveredAITool.update({
        where: { id: existing.id },
        data: {
          userCount: newUserCount,
          notes: existing.notes
            ? `${existing.notes}\nDNS/proxy scan (${source}): ${discovery.totalHits} hits, ${userCount} users.`
            : `DNS/proxy scan (${source}): ${discovery.totalHits} hits, ${userCount} users.`,
        },
      });
      updatedTools++;
      details.push({
        toolName: discovery.toolName,
        action: "updated",
        userCount: newUserCount,
        hits: discovery.totalHits,
      });
      continue;
    }

    const governedMatch = await findMatchingGovernedSystem({
      toolName: discovery.toolName,
      vendor: discovery.vendor,
      detectedDomain: discovery.domain,
    });

    const baseNotes = `Detected via DNS/proxy logs (${source}). ${discovery.totalHits} hits from ${userCount} user(s).`;

    const tool = await prisma.discoveredAITool.create({
      data: {
        toolName: discovery.toolName,
        vendor: discovery.vendor,
        detectedDomain: discovery.domain,
        detectionSource: source,
        department,
        userCount,
        status: governedMatch ? "REGISTERED" : "DISCOVERED",
        linkedSystemId: governedMatch?.id,
        matchConfidence: "high",
        matchScore: 8,
        matchReasons: [`domain matched '${discovery.domain}'`],
        notes: governedMatch
          ? `${baseNotes} Suppressed: matches governed system "${governedMatch.name}".`
          : baseNotes,
      },
    });

    // Suppress the alert when this tool is already a governed AISystem.
    if (!governedMatch) {
      await prisma.alert.create({
        data: {
          title: `Shadow AI detected: ${discovery.toolName}`,
          description: `${discovery.toolName} (${discovery.vendor}) detected via ${source} logs. ${discovery.totalHits} requests from ${userCount} user(s).`,
          severity: discovery.totalHits >= 50 || userCount >= 10 ? "HIGH" : "MEDIUM",
          source: "shadow_ai",
          relatedToolId: tool.id,
        },
      });
    }

    newTools++;
    details.push({
      toolName: discovery.toolName,
      action: "created",
      userCount,
      hits: discovery.totalHits,
    });
  }

  return {
    processed,
    matched: toolMap.size,
    newTools,
    updatedTools,
    details,
  };
}

export async function ingestDiscoveredToolEntries(params: {
  source: string;
  entries: LogEntry[];
  inputType: "json" | "csv";
  fileName?: string | null;
  triggeredByUserId?: string | null;
}): Promise<IngestResult> {
  const run = await prisma.ingestionRun.create({
    data: {
      source: params.source,
      inputType: params.inputType,
      fileName: params.fileName ?? undefined,
      triggeredByUserId: params.triggeredByUserId ?? undefined,
      status: "running",
    },
  });

  logger.info("shadow_ai.ingestion.started", {
    ingestionRunId: run.id,
    source: params.source,
    inputType: params.inputType,
    entries: params.entries.length,
    fileName: params.fileName ?? null,
  });

  try {
    const result = await runIngestion(params.source, params.entries);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        processed: result.processed,
        matched: result.matched,
        newTools: result.newTools,
        updatedTools: result.updatedTools,
        details: JSON.parse(JSON.stringify({ details: result.details })),
        completedAt: new Date(),
      },
    });

    logger.info("shadow_ai.ingestion.completed", {
      ingestionRunId: run.id,
      source: params.source,
      processed: result.processed,
      matched: result.matched,
      newTools: result.newTools,
      updatedTools: result.updatedTools,
    });

    return { ...result, ingestionRunId: run.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown ingestion error";
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage,
        completedAt: new Date(),
      },
    });

    logger.error("shadow_ai.ingestion.failed", {
      ingestionRunId: run.id,
      source: params.source,
      error: errorMessage,
    });

    throw error;
  }
}
