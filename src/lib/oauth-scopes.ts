// Plain-language classification of the OAuth scopes an identity provider
// reports for a third-party app (Google Workspace token audit / Directory
// tokens, Microsoft Entra oauth2PermissionGrants). A raw scope such as
// `https://www.googleapis.com/auth/gmail.readonly` or `Mail.ReadWrite` becomes
// "Email (read)" / "Email (read/write)" so a reviewer can see at a glance what
// company data the app can reach, and the Shadow AI list can filter on it.
//
// Pure functions, no I/O. Unknown scopes are kept, labelled by their raw
// value, and never counted as broad.

export type ScopeAccessCategory =
  | "mail"
  | "calendar"
  | "files"
  | "contacts"
  | "chat"
  | "directory"
  | "admin"
  | "cloud"
  | "identity"
  | "other";

export type ScopeAccessLevel = "read" | "write" | "full";

export type ScopeDescription = {
  /** The raw scope string as the provider reported it. */
  scope: string;
  category: ScopeAccessCategory;
  access: ScopeAccessLevel;
  /** Short human label, e.g. "Email (read)". */
  label: string;
  /** True when the scope reaches company data (mail, files, directory, ...). */
  broad: boolean;
};

export type ScopeAccessSummary = {
  category: ScopeAccessCategory;
  /** Category display name, e.g. "Email". */
  label: string;
  /** Highest access level any scope in this category grants. */
  access: ScopeAccessLevel;
  broad: boolean;
  /** Raw scopes folded into this category. */
  scopes: string[];
};

export const SCOPE_ACCESS_CATEGORIES: { id: ScopeAccessCategory; label: string; broad: boolean }[] = [
  { id: "mail", label: "Email", broad: true },
  { id: "files", label: "Files & docs", broad: true },
  { id: "calendar", label: "Calendar", broad: true },
  { id: "contacts", label: "Contacts", broad: true },
  { id: "chat", label: "Chat & meetings", broad: true },
  { id: "directory", label: "Directory", broad: true },
  { id: "admin", label: "Admin", broad: true },
  { id: "cloud", label: "Cloud platform", broad: true },
  { id: "identity", label: "Sign-in identity", broad: false },
  { id: "other", label: "Other", broad: false },
];

const CATEGORY_BY_ID = new Map(SCOPE_ACCESS_CATEGORIES.map((c) => [c.id, c]));
const CATEGORY_ORDER = new Map(SCOPE_ACCESS_CATEGORIES.map((c, index) => [c.id, index]));
const ACCESS_RANK: Record<ScopeAccessLevel, number> = { read: 0, write: 1, full: 2 };

export const SCOPE_ACCESS_LEVEL_LABELS: Record<ScopeAccessLevel, string> = {
  read: "read",
  write: "read/write",
  full: "full",
};

export function scopeCategoryLabel(category: ScopeAccessCategory | string | null | undefined): string {
  return (category && CATEGORY_BY_ID.get(category as ScopeAccessCategory)?.label) || "Other";
}

export function isScopeAccessCategory(value: unknown): value is ScopeAccessCategory {
  return typeof value === "string" && CATEGORY_BY_ID.has(value as ScopeAccessCategory);
}

// ---------------------------------------------------------------------------
// Category rules. Matched in order against the lower-cased scope with the
// Google `https://www.googleapis.com/auth/` prefix stripped, so one list
// covers both Google (`gmail.readonly`) and Microsoft Graph (`mail.read`,
// with or without the `https://graph.microsoft.com/` prefix) spellings.
// ---------------------------------------------------------------------------

type Rule = { category: ScopeAccessCategory; test: (scope: string) => boolean };

const startsAny = (...prefixes: string[]) => (scope: string) => prefixes.some((p) => scope.startsWith(p));

const RULES: Rule[] = [
  // Sign-in identity first so `email` / `profile` / `user.read` are not
  // mistaken for mailbox or directory access.
  {
    category: "identity",
    test: (s) =>
      s === "openid" ||
      s === "email" ||
      s === "profile" ||
      s === "offline_access" ||
      s === "user.read" ||
      s === "user.readbasic.all" ||
      s.startsWith("userinfo."),
  },
  { category: "mail", test: startsAny("gmail", "mail.", "mail.google.com", "imap.", "smtp.", "ews.", "pop.") },
  { category: "calendar", test: startsAny("calendar", "calendars.") },
  {
    category: "files",
    test: startsAny(
      "drive",
      "documents",
      "spreadsheets",
      "presentations",
      "forms",
      "files.",
      "sites.",
      "notes.",
      "keep"
    ),
  },
  { category: "contacts", test: startsAny("contacts", "people.", "directory.readonly") },
  {
    category: "chat",
    test: startsAny("chat", "channelmessage.", "team.", "teamsactivity", "meetings", "onlinemeetings", "chatmessage."),
  },
  {
    category: "directory",
    test: startsAny(
      "admin.directory",
      "user.read.all",
      "user.readwrite.all",
      "directory.",
      "group.",
      "groupmember.",
      "organization."
    ),
  },
  {
    category: "admin",
    test: startsAny(
      "admin.",
      "apps.",
      "application.",
      "approleassignment.",
      "rolemanagement.",
      "policy.",
      "auditlog.",
      "securityevents.",
      "reports."
    ),
  },
  { category: "cloud", test: startsAny("cloud-platform", "bigquery", "compute", "devstorage", "cloudfunctions") },
];

function normalise(scope: string): string {
  return scope
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/www\.googleapis\.com\/auth\//, "")
    .replace(/^https?:\/\/graph\.microsoft\.com\//, "")
    .replace(/^https?:\/\//, "");
}

function categorise(normalised: string): ScopeAccessCategory {
  for (const rule of RULES) {
    if (rule.test(normalised)) return rule.category;
  }
  return "other";
}

function accessLevel(normalised: string, category: ScopeAccessCategory): ScopeAccessLevel {
  // Google: a bare product scope (`gmail`, `drive`, `calendar`) or the legacy
  // full-mailbox host is complete control; `.readonly` is read.
  if (normalised === "mail.google.com" || normalised === "mail.google.com/") return "full";
  if (normalised.endsWith(".readonly") || normalised.includes(".readonly.")) return "read";
  if (normalised.endsWith(".metadata")) return "read";
  // Microsoft Graph: Mail.Read, Files.Read.All, Mail.ReadBasic -> read;
  // Mail.ReadWrite, Mail.Send -> write; *.AccessAsUser.All -> full.
  if (/\.accessasuser(\.all)?$/.test(normalised)) return "full";
  if (/\.read(basic)?(\.all|\.shared)?$/.test(normalised)) return "read";
  if (/\.readwrite(\.all|\.shared)?$/.test(normalised) || /\.send(\.shared)?$/.test(normalised)) return "write";
  if (/\.manage(\.all)?$/.test(normalised) || /\.create$/.test(normalised)) return "write";
  // `userinfo.email`, `openid`, `profile`: reading who the user is.
  if (category === "identity") return "read";
  if (category === "other") return "read";
  // A bare Google product scope with no qualifier is read/write.
  return "write";
}

function isBroad(normalised: string, category: ScopeAccessCategory): boolean {
  const meta = CATEGORY_BY_ID.get(category);
  if (!meta?.broad) return false;
  // `drive.file` only reaches files the user opened with the app; it is the
  // narrow alternative Google recommends, so don't flag it as broad.
  if (normalised === "drive.file" || normalised === "drive.appdata" || normalised === "drive.install") return false;
  return true;
}

/** Describe one raw scope. */
export function describeScope(scope: string): ScopeDescription {
  const normalised = normalise(scope);
  const category = categorise(normalised);
  const access = accessLevel(normalised, category);
  const broad = isBroad(normalised, category);
  const label =
    category === "other"
      ? scope
      : category === "identity"
        ? "Sign-in identity"
        : normalised === "drive.file"
          ? "Files & docs (files opened with the app)"
          : `${scopeCategoryLabel(category)} (${SCOPE_ACCESS_LEVEL_LABELS[access]})`;
  return { scope, category, access, label, broad };
}

/**
 * Describe every scope, deduplicated, most consequential first: broad scopes
 * before narrow ones, higher access before lower, then by category weight,
 * so a capped list still shows the grants that matter.
 */
export function describeScopes(scopes: readonly string[] | null | undefined): ScopeDescription[] {
  const seen = new Set<string>();
  const out: ScopeDescription[] = [];
  for (const raw of scopes ?? []) {
    const scope = raw.trim();
    if (!scope || seen.has(scope)) continue;
    seen.add(scope);
    out.push(describeScope(scope));
  }
  return out.sort((a, b) => {
    if (a.broad !== b.broad) return a.broad ? -1 : 1;
    if (a.access !== b.access) return ACCESS_RANK[b.access] - ACCESS_RANK[a.access];
    return (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99);
  });
}

/**
 * Fold scopes into one entry per access category, highest access level wins,
 * ordered broad-first then by category weight. Drives the badges on the
 * Shadow AI list and the access filter.
 */
export function summariseScopeAccess(scopes: readonly string[] | null | undefined): ScopeAccessSummary[] {
  const byCategory = new Map<ScopeAccessCategory, ScopeAccessSummary>();
  for (const desc of describeScopes(scopes)) {
    const existing = byCategory.get(desc.category);
    if (existing) {
      existing.scopes.push(desc.scope);
      if (ACCESS_RANK[desc.access] > ACCESS_RANK[existing.access]) existing.access = desc.access;
      existing.broad = existing.broad || desc.broad;
    } else {
      byCategory.set(desc.category, {
        category: desc.category,
        label: scopeCategoryLabel(desc.category),
        access: desc.access,
        broad: desc.broad,
        scopes: [desc.scope],
      });
    }
  }
  return Array.from(byCategory.values()).sort((a, b) => {
    if (a.broad !== b.broad) return a.broad ? -1 : 1;
    return (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99);
  });
}

/** The scopes that reach company data. */
export function broadScopes(scopes: readonly string[] | null | undefined): string[] {
  return describeScopes(scopes)
    .filter((desc) => desc.broad)
    .map((desc) => desc.scope);
}

/** Does any scope land in the given access category? */
export function hasScopeAccess(
  scopes: readonly string[] | null | undefined,
  category: ScopeAccessCategory
): boolean {
  return describeScopes(scopes).some((desc) => desc.category === category);
}
