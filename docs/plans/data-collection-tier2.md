# Data collection upgrades — Tier 2 (staged)

Status: **staged, not started**. Tier 1 shipped in `feat/data-collection-tier1`
(cache tokens, unified pricing, OpenAI stream telemetry, Portkey per-model
buckets, Shadow AI observation columns, OTel idempotency). This document scopes
the next tier so each item can be picked up as its own PR. Items are ordered
by dependency; 2.1 and 2.2 unblock most of the rest.

Every item that touches `prisma/schema.prisma` needs the migration applied to
production by hand (`npx prisma migrate deploy`) after merge — merging does
not migrate. Never run `prisma migrate dev` against the default `.env`
database; diff against a local throwaway Postgres instead.

---

## 2.1 Split the maintenance route into one job per cron entry

**Problem.** `GET /api/scheduler/maintenance` (hourly, `maxDuration = 60`) runs
nine provider syncs and four directory scans sequentially inside a single
60-second Vercel function (`src/lib/background-jobs.ts:635-650`). When the
function is killed, scans stay `running` until the 10-minute sweep fails them,
and due-ness is keyed off the most recent success of *any* provider
(`background-jobs.ts:430-435`), so one healthy provider resets the clock for
all of them.

**Change.**
- New routes, each with its own `vercel.json` line and `maxDuration`:
  - `/api/cron/provider-sync/[provider]` — one function per `SyncProvider`
    (`anthropic`, `claude_code`, `cursor`, `gemini`, `openai`, `openrouter`,
    `helicone`, `portkey`, `litellm`), or a single `/api/cron/provider-sync`
    that fans out with `Promise.allSettled` and a per-provider deadline.
  - `/api/cron/discovery-scan/[source]` for `google_workspace`,
    `microsoft_365`, `hexnode`, `crowdstrike`.
  - `/api/cron/governance-automation` and `/api/cron/key-usage-rules` for
    the two non-collection passes that currently ride along.
- Per-provider due-ness: `ProviderSyncRun` already has `provider`; query the
  latest SUCCEEDED run **per provider** instead of globally.
- Per-provider settings (README already claims these exist):
  `provider_sync_<provider>_enabled`, `provider_sync_<provider>_interval_hours`,
  falling back to the existing global keys. Surface them on
  Settings → Provider Admin APIs.
- Keep `/api/scheduler/maintenance` as a thin compatibility shim for one
  release, then delete it and the unlisted duplicate
  `/api/discovered-tools/scan/cron`.

**Files.** `src/lib/background-jobs.ts`, `src/app/api/scheduler/maintenance/route.ts`,
new `src/app/api/cron/**`, `vercel.json`, `src/lib/settings.ts`,
`src/app/(dashboard)/settings/provider-admin/**`, docs.

**Acceptance.** Each cron route completes inside its budget with one provider
misbehaving; a failing provider does not delay others; Settings shows
per-provider last-run and next-due.

---

## 2.2 Sync watermarks and backfill

**Problem.** Every sync recomputes a fixed `now - 7d` window inline
(`src/lib/provider-telemetry.ts`, one `startingAt` per provider). No cursor,
no watermark, no backfill. Cursor retains ~30 days upstream but a fresh
install captures 7 and loses the rest permanently; Claude Code analytics and
Anthropic usage have deeper history that is never pulled.

**Change.**
- New model:
  ```prisma
  model ProviderSyncWatermark {
    provider      String   @id
    // Last bucket day fully ingested (UTC midnight)
    watermark     DateTime
    // Earliest day ever ingested — lets the UI say "history from X"
    earliest      DateTime
    updatedAt     DateTime @updatedAt
  }
  ```
- Each sync takes `{ from, to }` instead of computing the window. The job
  layer computes `from = min(watermark - overlapDays, now - maxLookbackDays)`,
  where `overlapDays` (default 2) re-pulls recent days that providers revise
  and `maxLookbackDays` is per provider (Cursor 30, Anthropic 90, OpenAI 90,
  gateways 30, Gemini 90).
- One-shot backfill: `POST /api/admin-sync` gains `{ provider, from, to }`
  and a **Backfill** button on Settings → Provider Admin APIs that walks the
  range in 7-day chunks, one invocation per chunk (client-driven so no single
  function exceeds its budget).
- Record truncation: every paginated fetch reports `{ pages, truncated }` and
  the sync run stores it in `metadata`; a `truncated` run raises a
  `provider_sync_truncated` alert (dedupe 24h). Caps to instrument:
  Helicone 20×500, Portkey 20×100, Gemini `LIMIT 5000`, Cursor 50/200 pages,
  Anthropic keys/members `limit:100` with `has_more`, OpenAI `next_page`.

**Files.** `prisma/schema.prisma` + migration, `src/lib/provider-telemetry.ts`
(all `sync*Telemetry`), `src/lib/*-admin.ts` (pagination + page counts),
`src/lib/background-jobs.ts`, `src/app/api/admin-sync/route.ts`, settings UI,
docs.

**Acceptance.** Deleting a week of `UsageBucket` rows and re-running the sync
restores them; a fresh database backfills Cursor to 30 days; a truncated
Helicone page range produces an alert.

---

## 2.3 Cost attribution columns and Anthropic workspace grouping

**Problem.** `CostBucket` has no `apiKeyExternalId`, `apiKeyName`, or
`aiSystemId` (`prisma/schema.prisma:612-635`) while `UsageBucket` has all
three, so cost stops at model + project. The Anthropic usage and cost reports
are never grouped by `workspace_id` even though the API supports it, and the
cost report is grouped only by `description`.

**Change.**
- Schema:
  ```prisma
  model CostBucket {
    // …existing…
    apiKeyExternalId String?
    apiKeyName       String?
    aiSystem         AISystem? @relation(fields: [aiSystemId], references: [id], onDelete: SetNull)
    aiSystemId       String?
    workspaceExternalId String?
    workspaceName       String?
    @@index([aiSystemId, bucketStart])
  }
  model UsageBucket {
    // …existing…
    workspaceExternalId String?
    workspaceName       String?
  }
  ```
  `ai-proxy/prisma/schema.prisma` mirrors `CostBucket`/`UsageBucket` — update
  both or `scripts/check-schema-drift.mjs` fails CI.
- Anthropic: add `group_by[]=workspace_id` (and `api_key_id` on cost where
  the API allows) to `/usage_report/messages` and `/cost_report`; upsert
  `ProviderProject` rows for **workspaces** (today they are API keys).
- Governed-system link: extend `settings.ts:190-193` mapping so the
  key→AISystem mapping also applies to `CostBucket`, and add mappings for
  OpenAI (`api_key_id`) and LiteLLM (`api_key`).
- Oversight: cost-by-system and cost-by-key panels; `people-usage` proxy
  loader can then attribute cost per key.

**Files.** schema + migration (both schemas), `src/lib/anthropic-admin.ts`,
`src/lib/provider-telemetry.ts`, `src/lib/proxy-bucket-writer.ts` (+ mirror),
`src/lib/third-party-proxy-ingest.ts`, `src/lib/oversight-telemetry.ts`,
Oversight UI, docs.

---

## 2.4 Retention for the unbounded tables

**Problem.** Only the four OTel tables are pruned. `ProviderRawSnapshot` is
write-only (no reader, no prune). `APIUsageLog`, `UsageBucket`, `CostBucket`,
`AgentToolCall`, `PolicyDenial`, `ProxyHealthSnapshot`, `SensitiveScan`,
`ProviderSecurityScan` grow without bound.

**Change.**
- One `/api/cron/prune-collection` route (daily 03:45) driven by settings,
  all default-on with conservative windows and `0` = disabled:

  | Setting | Default | Table |
  |---|---|---|
  | `raw_snapshot_retention_days` | 14 | ProviderRawSnapshot |
  | `api_usage_log_retention_days` | 180 | APIUsageLog (buckets keep the aggregate) |
  | `agent_tool_call_retention_days` | 180 | AgentToolCall (profiles keep counts) |
  | `policy_denial_retention_days` | 365 | PolicyDenial |
  | `proxy_health_retention_days` | 90 | ProxyHealthSnapshot |
  | `scan_result_retention_days` | 365 | SensitiveScan / ProviderSecurityScan (keep latest per provider) |

  `UsageBucket`/`CostBucket` are **not** pruned — they are the long-term
  aggregate. Optionally roll hourly proxy buckets up to daily after 90 days.
- Delete in batches of 5,000 by `createdAt` cursor so the route fits its
  budget; report `{ table, deleted, remaining }`.
- Register env fallbacks in `settings.ts` (also fixes the missing
  `CURSOR_TELEMETRY_RETENTION_DAYS` fallback).

**Files.** new cron route, `vercel.json`, `src/lib/settings.ts`, Settings →
General retention card, docs.

---

## 2.5 Scheduled proxy-health sync

**Problem.** `ProxyHealthSnapshot` is written only on manual
`POST /api/proxy-health/sync`; the board's "latest snapshot" goes stale.

**Change.** Add `/api/cron/proxy-health` every 15 minutes calling the same
sync function with the system actor; skip when Azure Monitor is not
configured. Show "last synced N min ago" on the board.

**Files.** new cron route, `vercel.json`, `src/app/api/proxy-health/sync/route.ts`
(extract the body into `src/lib/proxy-health-sync.ts`), docs/help/proxy-health.md.

---

## 2.6 Promote coding-assistant metadata to columns

**Problem.** Claude Code analytics and Cursor admin data live only in
`UsageBucket.metadata` JSON: `estimated_cost`, `model_breakdown` tokens,
`tool_actions` accept/reject, `core_metrics` (sessions, lines, commits, PRs),
Cursor `acceptedLinesAdded`, `totalLinesAdded`, `isActive`,
`subscriptionIncludedReqs`, `usageBasedReqs`. Dashboards query them by JSON
path; reports cannot filter or sum them.

**Change.**
- New model rather than widening `UsageBucket`:
  ```prisma
  model AssistantDailyStat {
    id             String   @id @default(cuid())
    provider       String   // claude_code | cursor
    day            DateTime
    actorExternalId String
    actorName      String?
    sessions       Int?
    linesAdded     Int?
    linesRemoved   Int?
    linesAccepted  Int?
    commits        Int?
    pullRequests   Int?
    toolAccepted   Int?
    toolRejected   Int?
    estimatedCost  Float?
    inputTokens    Int?
    outputTokens   Int?
    cacheReadTokens Int?
    cacheCreationTokens Int?
    isActive       Boolean?
    metadata       Json?
    syncRunId      String
    @@unique([provider, day, actorExternalId])
    @@index([provider, day])
    @@index([actorExternalId, day])
  }
  ```
- Populate from `syncClaudeCodeAnalytics` and `syncCursorTelemetry`; keep
  the existing `UsageBucket` rows for compatibility for one release.
- Point `claude-code-dashboard.ts`, `cursor-dashboard.ts`, `people-usage.ts`
  and the `PEOPLE_USAGE` report source at the new table.
- Also flatten OTel histogram data points on the Claude Code metrics path
  (`src/lib/validations/claude-code-telemetry.ts:123-126` drops them).

---

## 2.7 Docs drift (do alongside 2.1–2.6)

- `docs/user-guide.md` CSV import section documents columns the importer does
  not parse — replace with the DNS/proxy header presets actually supported.
- `docs/implementation-guide.md` "Cursor's hook carries no token or cost
  data" — qualify: the OTel hook does not, the Cursor Admin API sync does.
- `docs/help/integrations.md` and `docs/user-guide.md` list provider
  telemetry as Anthropic + OpenAI + Gemini — add Cursor Admin API and Claude
  Code analytics.
- `README.md` per-gateway toggles — true once 2.1 lands; until then remove.
- `docs/help/oversight.md` "on each provider's own interval" — true after 2.1.

---

## Suggested sequencing

| Order | Item | Schema? | Rough size |
|---|---|---|---|
| 1 | 2.1 Split maintenance route + per-provider settings | no | M |
| 2 | 2.4 Retention cron | no | S |
| 3 | 2.5 Proxy-health cron | no | S |
| 4 | 2.2 Watermarks + backfill + truncation alerts | yes | L |
| 5 | 2.3 Cost attribution + workspace grouping | yes (both schemas) | M |
| 6 | 2.6 Assistant daily stats | yes | M |
| 7 | 2.7 Docs | no | S |
