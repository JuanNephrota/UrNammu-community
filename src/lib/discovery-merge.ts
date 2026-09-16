/**
 * Pure merge rules for folding a fresh discovery observation into an
 * existing DiscoveredAITool row. Kept free of Prisma so the rules are unit
 * testable; scan-executor.ts and discovered-tools-ingest.ts call these.
 */

/**
 * DismissedCandidate.detectedDomain is part of a unique key, and Postgres
 * treats NULLs as distinct in unique indexes — so a domain-less tool must be
 * stored with this placeholder, never NULL, or `findUnique` by
 * (toolName, "") will miss it and the tool resurfaces on every scan.
 */
export const DISMISSED_DOMAIN_PLACEHOLDER = "";

export function dismissedDomainKey(domain: string | null | undefined): string {
  return domain ?? DISMISSED_DOMAIN_PLACEHOLDER;
}

/** Lowercase, trim, drop empties, dedupe, sort. */
export function normalizeEmails(emails: Iterable<string> | null | undefined): string[] {
  if (!emails) return [];
  const set = new Set<string>();
  for (const raw of emails) {
    const value = (raw ?? "").trim().toLowerCase();
    if (value) set.add(value);
  }
  return Array.from(set).sort();
}

/** Trim, drop empties, dedupe, sort (scopes are case-sensitive URIs). */
export function normalizeScopes(scopes: Iterable<string> | null | undefined): string[] {
  if (!scopes) return [];
  const set = new Set<string>();
  for (const raw of scopes) {
    const value = (raw ?? "").trim();
    if (value) set.add(value);
  }
  return Array.from(set).sort();
}

/**
 * Only values that look like email addresses. DNS/proxy exports fall back to
 * device names or usernames for the "user" column; those still count as
 * identities for userCount but do not belong in `userEmails`.
 */
export function pickEmails(identities: Iterable<string> | null | undefined): string[] {
  if (!identities) return [];
  return normalizeEmails(Array.from(identities).filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value ?? "").trim())));
}

export interface UserCountMergeInput {
  existingCount: number;
  existingSource: string;
  observedCount: number;
  observedSource: string;
}

/**
 * userCount rule: a rescan from the SAME source is authoritative and may
 * lower the count (users revoked access, devices retired). A DIFFERENT source
 * only ever raises it — two partial views are combined with max, never
 * overwritten.
 */
export function mergeUserCount(input: UserCountMergeInput): number {
  if (input.existingSource === input.observedSource) {
    return Math.max(0, input.observedCount);
  }
  return Math.max(input.existingCount, input.observedCount);
}

export interface SeenWindowMergeInput {
  existingFirstSeenAt: Date | null | undefined;
  existingLastSeenAt: Date | null | undefined;
  /** Earliest observation in this scan; defaults to `observedAt`. */
  observedFirstSeenAt?: Date | null;
  /** Latest observation in this scan; defaults to `observedAt`. */
  observedLastSeenAt?: Date | null;
  /** When the scan ran — the fallback when the source has no timestamps. */
  observedAt: Date;
}

export interface SeenWindow {
  firstSeenAt: Date;
  lastSeenAt: Date;
}

function validDate(value: Date | null | undefined): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

/** firstSeenAt = min(existing, scan), lastSeenAt = max(existing, scan). */
export function mergeSeenWindow(input: SeenWindowMergeInput): SeenWindow {
  const scanFirst = validDate(input.observedFirstSeenAt) ?? input.observedAt;
  const scanLast = validDate(input.observedLastSeenAt) ?? input.observedAt;
  const existingFirst = validDate(input.existingFirstSeenAt);
  const existingLast = validDate(input.existingLastSeenAt);

  const firstCandidates = [scanFirst, scanLast, existingFirst, existingLast].filter(
    (d): d is Date => d !== null
  );
  const lastCandidates = firstCandidates;

  return {
    firstSeenAt: new Date(Math.min(...firstCandidates.map((d) => d.getTime()))),
    lastSeenAt: new Date(Math.max(...lastCandidates.map((d) => d.getTime()))),
  };
}

export interface ExistingDiscoveryRow {
  detectionSource: string;
  userCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export interface DiscoveryObservation {
  detectionSource: string;
  userCount: number;
  userEmails?: string[] | null;
  scopes?: string[] | null;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  observedAt: Date;
}

export interface DiscoveryObservationUpdate {
  userCount: number;
  userEmails: string[];
  scopes: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** True when userCount moved (up or down) — callers use it to decide whether to annotate notes. */
  userCountChanged: boolean;
}

/**
 * Compute the column updates for an existing row given a new observation.
 * `userEmails` and `scopes` are replaced (not unioned) — they describe what
 * the most recent scan saw, so stale users drop off once access is revoked.
 */
export function mergeDiscoveryObservation(
  existing: ExistingDiscoveryRow,
  observed: DiscoveryObservation
): DiscoveryObservationUpdate {
  const userCount = mergeUserCount({
    existingCount: existing.userCount,
    existingSource: existing.detectionSource,
    observedCount: observed.userCount,
    observedSource: observed.detectionSource,
  });
  const window = mergeSeenWindow({
    existingFirstSeenAt: existing.firstSeenAt,
    existingLastSeenAt: existing.lastSeenAt,
    observedFirstSeenAt: observed.firstSeenAt,
    observedLastSeenAt: observed.lastSeenAt,
    observedAt: observed.observedAt,
  });
  return {
    userCount,
    userEmails: normalizeEmails(observed.userEmails),
    scopes: normalizeScopes(observed.scopes),
    firstSeenAt: window.firstSeenAt,
    lastSeenAt: window.lastSeenAt,
    userCountChanged: userCount !== existing.userCount,
  };
}

/** Column values for a brand-new row from a single observation. */
export function initialDiscoveryObservation(observed: DiscoveryObservation): Omit<DiscoveryObservationUpdate, "userCountChanged"> {
  const window = mergeSeenWindow({
    existingFirstSeenAt: null,
    existingLastSeenAt: null,
    observedFirstSeenAt: observed.firstSeenAt,
    observedLastSeenAt: observed.lastSeenAt,
    observedAt: observed.observedAt,
  });
  return {
    userCount: Math.max(0, observed.userCount),
    userEmails: normalizeEmails(observed.userEmails),
    scopes: normalizeScopes(observed.scopes),
    firstSeenAt: window.firstSeenAt,
    lastSeenAt: window.lastSeenAt,
  };
}
