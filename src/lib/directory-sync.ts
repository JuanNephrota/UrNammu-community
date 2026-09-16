import { google } from "googleapis";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { createAuditLog } from "./audit";
import { logger } from "./observability";
import {
  createGoogleAdminAuthClient,
  isGoogleWorkspaceConfigured,
} from "./google-workspace";
import {
  getMicrosoft365AccessToken,
  isMicrosoft365Configured,
} from "./microsoft-365-shadow-ai";
import { DIRECTORY_SYNC_SETTINGS_KEYS, getSetting } from "./settings";
import { parseBooleanSetting, type DirectorySyncSource } from "./provider-sync-schedule";
import {
  isGraphGuestUser,
  mapGoogleDirectoryUser,
  mapGraphDirectoryUser,
  type DirectoryPersonInput,
  type GoogleDirectoryUser,
  type GraphDirectoryUser,
} from "./directory-identity";

// ─── Directory sync ────────────────────────────────────────────────────────
// Full sync of an identity provider's user directory into DirectoryPerson.
// Every run upserts every returned person with lastSyncedAt = now, then marks
// rows for that source that were NOT seen as inactive (deactivatedAt = now) —
// but only when at least one page was fetched successfully, so an auth
// failure can never mass-deactivate the directory. Each run is recorded as a
// ProviderSyncRun with syncType "directory" and provider = source; the counts
// live in `metadata`.

export const DIRECTORY_SYNC_TYPE = "directory";
/** Hard cap on pages per run; the run records `truncated: true` when hit. */
export const DIRECTORY_SYNC_MAX_PAGES = 100;

/** Scope the Google directory listing needs. Must be added to the service
 *  account's domain-wide delegation grant alongside the shadow-AI scopes. */
export const GOOGLE_DIRECTORY_SCOPE =
  "https://www.googleapis.com/auth/admin.directory.user.readonly";

export interface DirectorySyncCounts {
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
  /** Platform Users suspended because their directory account went inactive. */
  usersSuspended: number;
  pages: number;
  truncated: boolean;
}

export type DirectorySyncResult =
  | ({ source: DirectorySyncSource; success: true; syncRunId: string } & DirectorySyncCounts)
  | { source: DirectorySyncSource; success: false; syncRunId?: string; error: string };

export async function isDirectorySourceConfigured(source: DirectorySyncSource): Promise<boolean> {
  return source === "google_workspace"
    ? isGoogleWorkspaceConfigured()
    : isMicrosoft365Configured();
}

// ── Fetchers ──────────────────────────────────────────────────────────────

type PageHandler = (people: DirectoryPersonInput[]) => Promise<void>;

interface FetchOutcome {
  pages: number;
  truncated: boolean;
}

/**
 * GET https://admin.googleapis.com/admin/directory/v1/users
 *   ?customer=my_customer&maxResults=500&projection=basic&pageToken=…
 * via the Admin SDK client, impersonating the configured admin with the
 * read-only directory scope.
 */
async function fetchGoogleDirectory(onPage: PageHandler): Promise<FetchOutcome> {
  const auth = await createGoogleAdminAuthClient([GOOGLE_DIRECTORY_SCOPE]);
  const directory = google.admin({ version: "directory_v1", auth });

  let pageToken: string | undefined;
  let pages = 0;
  do {
    const response = await directory.users.list({
      customer: "my_customer",
      maxResults: 500,
      projection: "basic",
      pageToken,
    });
    pages += 1;
    const users = (response.data.users ?? []) as GoogleDirectoryUser[];
    const mapped = users
      .map((user) => mapGoogleDirectoryUser(user))
      .filter((p): p is DirectoryPersonInput => p !== null);
    await onPage(mapped);
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken && pages < DIRECTORY_SYNC_MAX_PAGES);

  return { pages, truncated: !!pageToken };
}

const GRAPH_USERS_URL =
  "https://graph.microsoft.com/v1.0/users" +
  "?$select=id,mail,userPrincipalName,displayName,department,jobTitle,accountEnabled,proxyAddresses,officeLocation" +
  "&$expand=manager($select=mail,userPrincipalName)" +
  "&$top=999";

/**
 * GET /v1.0/users with `$expand=manager` and `@odata.nextLink` paging.
 * Requires the application permission User.Read.All. Guests (#EXT# in the
 * UPN) are skipped unless `directory_sync_include_guests` is "true".
 */
async function fetchGraphDirectory(onPage: PageHandler): Promise<FetchOutcome> {
  const [accessToken, includeGuestsRaw] = await Promise.all([
    getMicrosoft365AccessToken(),
    getSetting(DIRECTORY_SYNC_SETTINGS_KEYS.INCLUDE_GUESTS),
  ]);
  const includeGuests = parseBooleanSetting(includeGuestsRaw, false);

  let nextUrl: string | undefined = GRAPH_USERS_URL;
  let pages = 0;
  while (nextUrl && pages < DIRECTORY_SYNC_MAX_PAGES) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Required for $expand + $top on /users beyond the default page.
        ConsistencyLevel: "eventual",
        "Content-Type": "application/json",
      },
    });
    const payload = (await response.json()) as {
      value?: GraphDirectoryUser[];
      "@odata.nextLink"?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(
        payload.error?.message ?? `Microsoft Graph request failed with ${response.status}.`
      );
    }
    pages += 1;
    const mapped = (payload.value ?? [])
      .filter((user) => includeGuests || !isGraphGuestUser(user))
      .map((user) => mapGraphDirectoryUser(user))
      .filter((p): p is DirectoryPersonInput => p !== null);
    await onPage(mapped);
    nextUrl = payload["@odata.nextLink"];
  }

  return { pages, truncated: !!nextUrl };
}

// ── Persistence ───────────────────────────────────────────────────────────

/**
 * Upsert one page. Returns created/updated counts and the ids of people who
 * flipped from active to inactive in this page (for offboarding).
 */
async function upsertPage(
  people: DirectoryPersonInput[],
  now: Date
): Promise<{ created: number; updated: number; newlyInactive: string[] }> {
  if (people.length === 0) return { created: 0, updated: 0, newlyInactive: [] };

  const source = people[0].source;
  const existing = await prisma.directoryPerson.findMany({
    where: { source, externalId: { in: people.map((p) => p.externalId) } },
    select: { externalId: true, active: true, deactivatedAt: true },
  });
  const existingById = new Map(existing.map((row) => [row.externalId, row]));

  let created = 0;
  let updated = 0;
  const newlyInactive: string[] = [];

  for (const person of people) {
    const prior = existingById.get(person.externalId);
    const wasActive = prior ? prior.active : true;
    const deactivatedAt = person.active
      ? null
      : wasActive || !prior?.deactivatedAt
        ? now
        : prior.deactivatedAt;
    if (prior && wasActive && !person.active) newlyInactive.push(person.primaryEmail);
    if (!prior && !person.active) newlyInactive.push(person.primaryEmail);

    const data = {
      primaryEmail: person.primaryEmail,
      aliases: person.aliases,
      displayName: person.displayName,
      department: person.department,
      title: person.title,
      managerEmail: person.managerEmail,
      orgUnit: person.orgUnit,
      active: person.active,
      deactivatedAt,
      lastSyncedAt: now,
      raw: person.raw as Prisma.InputJsonValue,
    };

    await prisma.directoryPerson.upsert({
      where: { source_externalId: { source, externalId: person.externalId } },
      create: { source, externalId: person.externalId, ...data },
      update: data,
    });
    if (prior) updated += 1;
    else created += 1;
  }

  return { created, updated, newlyInactive };
}

/**
 * Offboarding hook: a platform User whose directory account went inactive is
 * suspended (never deleted) and the change is written to the audit log. JWT
 * sessions are revoked on the next request by the status re-read in
 * hydrateJwtClaims; database sessions are cleared here.
 */
export async function suspendUsersForDeactivatedEmails(
  emails: string[],
  actorUserId: string,
  source: string
): Promise<number> {
  if (emails.length === 0) return 0;
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      email: { in: emails, mode: "insensitive" },
    },
    select: { id: true, email: true, name: true, role: true, department: true },
  });

  let suspended = 0;
  for (const user of users) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: "SUSPENDED",
          suspendedAt: new Date(),
          statusReason: `Deactivated in the ${source.replace("_", " ")} directory (directory sync).`,
        },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await createAuditLog(
        {
          userId: actorUserId,
          action: "SUSPEND",
          entityType: "User",
          entityId: user.id,
          changes: {
            reason: "directory_sync_deactivation",
            source,
            before: { status: "ACTIVE" },
            after: { status: "SUSPENDED" },
            email: user.email,
          },
        },
        tx
      );
    });
    suspended += 1;
    logger.warn("directory_sync.user_suspended", { userId: user.id, source });
  }
  return suspended;
}

async function resolveAuditActor(triggeredByUserId: string): Promise<string | null> {
  if (triggeredByUserId !== "system") return triggeredByUserId;
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

// ── Orchestration ─────────────────────────────────────────────────────────

/**
 * Run one full directory sync for `source`. `triggeredByUserId` is a User id
 * for the manual button or "system" for the cron. Never throws for upstream
 * failures: the run row is marked FAILED and the error returned.
 */
export async function runDirectorySync(
  source: DirectorySyncSource,
  triggeredByUserId: string
): Promise<DirectorySyncResult> {
  if (!(await isDirectorySourceConfigured(source))) {
    return { source, success: false, error: `${source.replace("_", " ")} credentials are not configured.` };
  }

  const now = new Date();
  const run = await prisma.providerSyncRun.create({
    data: {
      provider: source,
      syncType: DIRECTORY_SYNC_TYPE,
      status: "RUNNING",
      triggeredByUserId: triggeredByUserId === "system" ? null : triggeredByUserId,
    },
  });

  const counts: DirectorySyncCounts = {
    fetched: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    usersSuspended: 0,
    pages: 0,
    truncated: false,
  };
  const seenExternalIds: string[] = [];
  const newlyInactive: string[] = [];

  const onPage: PageHandler = async (people) => {
    counts.fetched += people.length;
    for (const p of people) seenExternalIds.push(p.externalId);
    const result = await upsertPage(people, now);
    counts.created += result.created;
    counts.updated += result.updated;
    newlyInactive.push(...result.newlyInactive);
  };

  try {
    const outcome =
      source === "google_workspace"
        ? await fetchGoogleDirectory(onPage)
        : await fetchGraphDirectory(onPage);
    counts.pages = outcome.pages;
    counts.truncated = outcome.truncated;

    // Deactivate rows this run did not see — only after a successful fetch,
    // and never when the listing was cut short (a truncated run has not seen
    // everyone, so absence proves nothing).
    if (counts.pages > 0 && !counts.truncated) {
      const missing = await prisma.directoryPerson.findMany({
        where: { source, active: true, externalId: { notIn: seenExternalIds } },
        select: { id: true, primaryEmail: true },
      });
      if (missing.length > 0) {
        await prisma.directoryPerson.updateMany({
          where: { id: { in: missing.map((m) => m.id) } },
          data: { active: false, deactivatedAt: now, lastSyncedAt: now },
        });
        counts.deactivated = missing.length;
        newlyInactive.push(...missing.map((m) => m.primaryEmail));
      }
    }

    const actor = await resolveAuditActor(triggeredByUserId);
    if (actor && newlyInactive.length > 0) {
      counts.usersSuspended = await suspendUsersForDeactivatedEmails(
        [...new Set(newlyInactive)],
        actor,
        source
      );
    } else if (!actor && newlyInactive.length > 0) {
      logger.warn("directory_sync.offboarding_skipped", {
        source,
        reason: "no admin user available to attribute the audit log",
      });
    }

    await prisma.providerSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        completedAt: new Date(),
        recordsProcessed: counts.fetched,
        metadata: counts as unknown as Prisma.InputJsonValue,
      },
    });
    logger.info("directory_sync.completed", { source, ...counts });
    return { source, success: true, syncRunId: run.id, ...counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown directory sync error";
    await prisma.providerSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        recordsProcessed: counts.fetched,
        errorMessage: message,
        metadata: counts as unknown as Prisma.InputJsonValue,
      },
    });
    logger.error("directory_sync.failed", { source, error: message, ...counts });
    return { source, success: false, syncRunId: run.id, error: message };
  }
}

/** Active / deactivated head-count per source, for the settings card. */
export async function getDirectoryPeopleCounts(): Promise<
  Record<DirectorySyncSource, { active: number; deactivated: number }>
> {
  const grouped = await prisma.directoryPerson.groupBy({
    by: ["source", "active"],
    _count: { _all: true },
  });
  const counts: Record<DirectorySyncSource, { active: number; deactivated: number }> = {
    google_workspace: { active: 0, deactivated: 0 },
    microsoft_365: { active: 0, deactivated: 0 },
  };
  for (const row of grouped) {
    const bucket = counts[row.source as DirectorySyncSource];
    if (!bucket) continue;
    if (row.active) bucket.active += row._count._all;
    else bucket.deactivated += row._count._all;
  }
  return counts;
}
