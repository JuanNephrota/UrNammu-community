/**
 * Incremental sync for Forge AI Skills.
 *
 * Loops `GET /skills?since=<lastSince>&cursor=...` until `has_more: false`,
 * upserting each row on `forgeId`. Stores the highest `updated_at` seen as
 * the next sync's `since`. Records every run to `ForgeSyncRun`.
 *
 * Incremental by design — we never do full sweeps, so deletions won't
 * propagate until the caller requests a fresh sync (future: passing
 * `fullResync: true` would null out `lastSince`).
 */

import { prisma } from "./prisma";
import { FORGE_SETTINGS_KEYS, getSetting, setSetting } from "./settings";
import {
  ForgeApiError,
  type ForgeSkill,
  listForgeSkills,
  loadForgeConfig,
} from "./forge-skills-client";
import { promoteSkill } from "./forge-skills-promotion";

export type SyncOptions = {
  trigger: "manual" | "cron";
  triggeredByUserId?: string | null;
  fullResync?: boolean;
};

export type SyncResult = {
  runId: string;
  status: "succeeded" | "failed";
  skillsFetched: number;
  skillsCreated: number;
  skillsUpdated: number;
  agentsLinked: number;
  systemsLinked: number;
  errorMessage?: string;
};

function toSkillRow(item: ForgeSkill) {
  return {
    name: item.name,
    contentType: item.content_type,
    fileType: item.file_type ?? null,
    fileName: item.file_name ?? null,
    fileSizeBytes:
      typeof item.file_size_bytes === "number" ? item.file_size_bytes : null,
    sha256: item.sha256 ?? null,
    status: item.status,
    appUrl: item.app_url ?? null,
    tags: item.tags ?? [],
    currentVersion: item.current_version ?? 1,
    categoryForgeId: item.category?.id ?? null,
    categoryName: item.category?.name ?? null,
    departmentForgeId: item.department?.id ?? null,
    departmentName: item.department?.name ?? null,
    authorForgeId: item.author?.id ?? null,
    authorName: item.author?.name ?? null,
    authorDepartmentName: item.author?.department_name ?? null,
    isFeaturedGlobal: item.is_featured_global ?? false,
    upvoteCount: item.upvote_count ?? 0,
    downloadCount: item.download_count ?? 0,
    forgeCreatedAt: new Date(item.created_at),
    forgeUpdatedAt: new Date(item.updated_at),
    syncedAt: new Date(),
    retiredAt: item.status === "retired" ? new Date() : null,
  } satisfies Record<string, unknown>;
}

export async function syncForgeSkills(opts: SyncOptions): Promise<SyncResult> {
  const config = await loadForgeConfig();
  if (!config) {
    throw new Error(
      "Forge is not configured. Set forge_integration_key in Settings → General."
    );
  }

  const lastSinceStr = opts.fullResync
    ? null
    : await getSetting(FORGE_SETTINGS_KEYS.LAST_SINCE);
  const since = lastSinceStr ?? undefined;

  const run = await prisma.forgeSyncRun.create({
    data: {
      trigger: opts.trigger,
      triggeredByUserId: opts.triggeredByUserId ?? null,
      sinceUsed: since ? new Date(since) : null,
      status: "running",
    },
  });

  let cursor: string | undefined;
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let agentsLinked = 0;
  let systemsLinked = 0;
  let highestUpdatedAt: Date | null = since ? new Date(since) : null;

  try {
    // Upper bound on pages to stop a runaway loop. 200 pages × 100 skills =
    // 20k skills per run, well beyond anything plausible for Forge today.
    for (let page = 0; page < 200; page++) {
      const body = await listForgeSkills(config, {
        since,
        cursor,
        limit: 100,
      });
      for (const item of body.items) {
        fetched++;
        const row = toSkillRow(item);
        // Upsert + fetch back in one round trip — we need the final row
        // (with linked*Id) to feed promotion.
        const before = await prisma.aISkill.findUnique({
          where: { forgeId: item.id },
          select: { id: true },
        });
        const saved = await prisma.aISkill.upsert({
          where: { forgeId: item.id },
          create: { forgeId: item.id, ...row },
          update: row,
        });
        if (before) updated++;
        else created++;

        // Auto-promote into AIAgent / AISystem when contentType matches and
        // the skill isn't already linked. Idempotent — safe to re-run on
        // every sync; no-op when already linked.
        try {
          const result = await promoteSkill(saved);
          if (result.action === "linked_agent") agentsLinked++;
          else if (result.action === "linked_system") systemsLinked++;
        } catch (promoteErr) {
          // Don't fail the whole sync if a single promotion errors —
          // record and move on.
          console.error(
            `promoteSkill failed for ${item.id}:`,
            promoteErr instanceof Error ? promoteErr.message : promoteErr
          );
        }

        const ts = row.forgeUpdatedAt as Date;
        if (!highestUpdatedAt || ts > highestUpdatedAt) {
          highestUpdatedAt = ts;
        }
      }
      if (!body.has_more) break;
      cursor = body.cursor ?? undefined;
      if (!cursor) break;
    }

    if (highestUpdatedAt) {
      await setSetting(
        FORGE_SETTINGS_KEYS.LAST_SINCE,
        highestUpdatedAt.toISOString()
      );
    }

    await prisma.forgeSyncRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        skillsFetched: fetched,
        skillsCreated: created,
        skillsUpdated: updated,
        cursorUsed: cursor ?? null,
      },
    });

    return {
      runId: run.id,
      status: "succeeded",
      skillsFetched: fetched,
      skillsCreated: created,
      skillsUpdated: updated,
      agentsLinked,
      systemsLinked,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail =
      err instanceof ForgeApiError ? `${message} (HTTP ${err.status})` : message;

    await prisma.forgeSyncRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        skillsFetched: fetched,
        skillsCreated: created,
        skillsUpdated: updated,
        cursorUsed: cursor ?? null,
        errorMessage: detail,
      },
    });

    return {
      runId: run.id,
      status: "failed",
      skillsFetched: fetched,
      skillsCreated: created,
      skillsUpdated: updated,
      agentsLinked,
      systemsLinked,
      errorMessage: detail,
    };
  }
}
