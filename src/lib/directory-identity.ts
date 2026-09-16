// Prisma-free helpers for identity-provider directory data. The sync in
// directory-sync.ts maps raw Google Directory / Microsoft Graph users through
// the mappers below; Usage by Person, the shadow-AI department rollup, and the
// governance check consume DirectoryPerson rows through the alias helpers.
// Everything here is pure so it can be unit tested without a database.

import type { DirectorySyncSource } from "./provider-sync-schedule";

/** The DirectoryPerson columns the sync writes (minus bookkeeping). */
export interface DirectoryPersonInput {
  source: DirectorySyncSource;
  externalId: string;
  primaryEmail: string;
  aliases: string[];
  displayName: string | null;
  department: string | null;
  title: string | null;
  managerEmail: string | null;
  orgUnit: string | null;
  active: boolean;
  raw: Record<string, unknown>;
}

/** The subset of a DirectoryPerson row the read-side helpers need. */
export interface DirectoryIdentity {
  primaryEmail: string;
  aliases: string[];
  displayName?: string | null;
  department?: string | null;
  active: boolean;
  deactivatedAt?: Date | null;
}

export type DirectoryStatus = "active" | "deactivated" | "unknown";

/** Lower-cased, trimmed email — or null when the value is not an email. */
export function normalizeDirectoryEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  const at = v.indexOf("@");
  if (at <= 0 || at !== v.lastIndexOf("@") || at === v.length - 1) return null;
  return v;
}

/** Lower-cased, deduped alias list that never repeats the primary address. */
export function normalizeAliases(raw: (string | null | undefined)[], primaryEmail: string): string[] {
  const out = new Set<string>();
  for (const value of raw) {
    const email = normalizeDirectoryEmail(value);
    if (email && email !== primaryEmail) out.add(email);
  }
  return [...out].sort();
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ── Google Directory API ──────────────────────────────────────────────────

export interface GoogleDirectoryUser {
  id?: string | null;
  primaryEmail?: string | null;
  aliases?: string[] | null;
  name?: { fullName?: string | null } | null;
  organizations?: { department?: string | null; title?: string | null; primary?: boolean | null }[] | null;
  relations?: { type?: string | null; value?: string | null }[] | null;
  orgUnitPath?: string | null;
  suspended?: boolean | null;
  archived?: boolean | null;
}

/**
 * Map one Admin SDK `users.list` entry. Returns null when the entry has no id
 * or no usable primary email (Google never returns such rows for real users,
 * but the type allows it).
 */
export function mapGoogleDirectoryUser(user: GoogleDirectoryUser): DirectoryPersonInput | null {
  const externalId = str(user.id);
  const primaryEmail = normalizeDirectoryEmail(user.primaryEmail);
  if (!externalId || !primaryEmail) return null;

  const org = user.organizations?.find((o) => o?.primary) ?? user.organizations?.[0] ?? null;
  const manager = user.relations?.find((r) => r?.type === "manager")?.value ?? null;

  return {
    source: "google_workspace",
    externalId,
    primaryEmail,
    aliases: normalizeAliases(user.aliases ?? [], primaryEmail),
    displayName: str(user.name?.fullName),
    department: str(org?.department),
    title: str(org?.title),
    managerEmail: normalizeDirectoryEmail(manager),
    orgUnit: str(user.orgUnitPath),
    active: !(user.suspended === true || user.archived === true),
    raw: user as Record<string, unknown>,
  };
}

// ── Microsoft Graph ───────────────────────────────────────────────────────

export interface GraphDirectoryUser {
  id?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
  displayName?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  accountEnabled?: boolean | null;
  proxyAddresses?: string[] | null;
  officeLocation?: string | null;
  manager?: { mail?: string | null; userPrincipalName?: string | null } | null;
}

export function isGraphGuestUser(user: GraphDirectoryUser): boolean {
  return (user.userPrincipalName ?? "").toUpperCase().includes("#EXT#");
}

/**
 * Map one Graph `/users` entry. `proxyAddresses` carries `SMTP:` / `smtp:`
 * prefixed addresses (the upper-case one is the primary); the prefix is
 * stripped case-insensitively and the primary excluded. Returns null for rows
 * without an id or a usable address.
 */
export function mapGraphDirectoryUser(user: GraphDirectoryUser): DirectoryPersonInput | null {
  const externalId = str(user.id);
  const primaryEmail =
    normalizeDirectoryEmail(user.mail) ?? normalizeDirectoryEmail(user.userPrincipalName);
  if (!externalId || !primaryEmail) return null;

  const aliasCandidates = (user.proxyAddresses ?? []).map((address) =>
    address.replace(/^smtp:/i, "")
  );
  // The UPN is a valid sign-in identity even when it differs from `mail`.
  if (user.userPrincipalName) aliasCandidates.push(user.userPrincipalName);

  return {
    source: "microsoft_365",
    externalId,
    primaryEmail,
    aliases: normalizeAliases(aliasCandidates, primaryEmail),
    displayName: str(user.displayName),
    department: str(user.department),
    title: str(user.jobTitle),
    managerEmail:
      normalizeDirectoryEmail(user.manager?.mail) ??
      normalizeDirectoryEmail(user.manager?.userPrincipalName),
    orgUnit: str(user.officeLocation),
    active: user.accountEnabled !== false,
    raw: user as Record<string, unknown>,
  };
}

// ── Read-side helpers ─────────────────────────────────────────────────────

/**
 * alias → primaryEmail (both lower-cased). The primary address maps to
 * itself so callers can resolve any observed email with one lookup. When two
 * directory rows claim the same alias the first one wins.
 */
export function buildAliasMap(people: DirectoryIdentity[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const person of people) {
    const primary = normalizeDirectoryEmail(person.primaryEmail);
    if (!primary) continue;
    if (!map.has(primary)) map.set(primary, primary);
    for (const alias of person.aliases) {
      const email = normalizeDirectoryEmail(alias);
      if (email && !map.has(email)) map.set(email, primary);
    }
  }
  return map;
}

/** Resolve an observed email to its directory primary; unknown emails pass through lower-cased. */
export function resolveAlias(email: string | null | undefined, aliasMap: Map<string, string>): string | null {
  const normalized = normalizeDirectoryEmail(email);
  if (!normalized) return null;
  return aliasMap.get(normalized) ?? normalized;
}

/** primaryEmail → identity, for enrichment after alias resolution. */
export function buildDirectoryIndex(people: DirectoryIdentity[]): Map<string, DirectoryIdentity> {
  const index = new Map<string, DirectoryIdentity>();
  for (const person of people) {
    const primary = normalizeDirectoryEmail(person.primaryEmail);
    if (!primary) continue;
    const existing = index.get(primary);
    // Prefer an active row when the same person exists in two sources.
    if (!existing || (!existing.active && person.active)) index.set(primary, person);
  }
  return index;
}

export function directoryStatusFor(identity: DirectoryIdentity | undefined): DirectoryStatus {
  if (!identity) return "unknown";
  return identity.active ? "active" : "deactivated";
}

export interface DepartmentRollupEntry {
  department: string;
  count: number;
}

export interface DepartmentRollup {
  entries: DepartmentRollupEntry[];
  /** Emails with no directory match, or a match without a department. */
  unmatched: number;
}

/**
 * Count observed emails by directory department, e.g. for a discovered tool's
 * user list. Aliases fold onto the primary before lookup. Sorted by count
 * desc, then department name.
 */
export function rollupDepartments(
  emails: string[],
  people: DirectoryIdentity[]
): DepartmentRollup {
  const aliasMap = buildAliasMap(people);
  const index = buildDirectoryIndex(people);
  const counts = new Map<string, number>();
  let unmatched = 0;
  const seen = new Set<string>();

  for (const raw of emails) {
    const primary = resolveAlias(raw, aliasMap);
    if (!primary || seen.has(primary)) continue;
    seen.add(primary);
    const department = index.get(primary)?.department?.trim();
    if (!department) {
      unmatched += 1;
      continue;
    }
    counts.set(department, (counts.get(department) ?? 0) + 1);
  }

  const entries = [...counts.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department));
  return { entries, unmatched };
}

/** "Engineering 4 · Sales 2" — compact label for the rollup. */
export function formatDepartmentRollup(rollup: DepartmentRollup, max = 4): string {
  const shown = rollup.entries.slice(0, max).map((e) => `${e.department} ${e.count}`);
  const hidden = rollup.entries.slice(max).reduce((acc, e) => acc + e.count, 0);
  if (hidden > 0) shown.push(`+${hidden} other`);
  return shown.join(" · ");
}
