# Implementation Guide

This guide is the fastest way to understand how UrNammu is put together, where the major product areas live, and how to extend the platform without fighting the existing architecture.

## Stack

- `Next.js 16` with the App Router
- `React 19`
- `Prisma` with PostgreSQL
- `NextAuth`
- server-rendered dashboard pages in `src/app/(dashboard)`
- route handlers in `src/app/api`

## Product Areas

The app is organized around a few core governance surfaces:

- `Registry`
  Tracks governed AI systems, approval state, risk history, policy assignments, evidence, incidents, linked shadow AI findings, and the EU AI Act classification (wizard, tier, applicable articles).
- `Agents`
  Tracks AI agents, autonomy, human review requirements, connected systems, AI-assisted agent risk review, and MCP tool governance (server/tool allowlists, observed tool activity from the proxy).
- `Shadow AI`
  Ingests and normalizes discoveries from Google Workspace, Microsoft 365, Hexnode UEM, CrowdStrike Falcon, and DNS/proxy/Netskope imports. Also owns the two enforcement layers for blocked tools.
- `Risk Center`
  Handles system risk assessments, dynamic review questions, use-case templates, agent-aware overlays, and reassessment triggers.
- `Compliance`
  Manages policies, rule-based enforcement, compliance evidence, governance workflows, and the seeded framework control catalog with crosswalk inheritance and per-framework coverage.
- `Oversight`
  Surfaces normalized provider telemetry, drift, incidents, vendor governance, and operational follow-up. Also hosts the per-surface developer-AI dashboards (Claude Platform, Claude Code, Cowork, Cursor) and the provider security/privacy scan.
- `Alerts`
  Central alert inbox, plus two tunable rule engines: prompt-risk rules (what is being asked) and key usage rules (how a credential behaves).
- `Reports`
  Definition-driven reporting over eight data sources, with PDF/CSV/JSON export and scheduled email delivery.
- `Executive`
  Board-facing posture scorecard: a weighted governance score, period-over-period deltas, and a generated narrative.
- `Sensitive Scan`
  Active probing of reachable AI endpoints for data leakage, plus passive inline DLP on proxy traffic.
- `Proxy Health`
  Live-ops board for the AI proxy: database-write heartbeat plus optional Azure Monitor platform metrics.
- `Integrations`
  Read-only catalog of every external connection and whether it is configured. Behavior still lives in Settings.

## Directory Map

- `src/app/(dashboard)`
  Main product pages.
- `src/app/api`
  Route handlers for CRUD, scans, AI helpers, and background jobs.
- `src/components`
  UI building blocks and product-specific cards/forms.
- `src/lib`
  Shared business logic, integrations, matchers, workflow engines, risk helpers, and validation utilities.
- `prisma/schema.prisma`
  Core data model.
- `prisma/migrations`
  Database migrations.

## Key Domain Models

The most important Prisma models are:

- `AISystem`
  The main governance record for a system. This is the center of approvals, policies, risk, incidents, evidence, and linked agents.
- `AIAgent`
  Operational agents tied to a system or discovered independently. Stores autonomy and review signals.
- `RiskAssessment`
  Stores multi-dimensional scores, justifications, notes, and contextual branching answers.
- `Policy` and `PolicyAssignment`
  Policies can now contain structured rules that are evaluated directly against systems.
- `FrameworkControl`, `ControlCrosswalk`, `ComplianceMapping`
  The seeded per-framework control catalog (NIST AI RMF, ISO 42001, EU AI Act, SOC 2), the undirected crosswalk between controls in different frameworks, and a system's per-control assessment. Coverage is computed in `src/lib/framework-coverage.ts` (pure) and loaded in `src/lib/framework-controls-data.ts`; the catalog content lives in `src/lib/framework-catalog.ts` and is inserted by migration.
- `EuAiActClassification`
  One row per system: risk tier and role under the EU AI Act, obligation flags, applicable article codes (matching `FrameworkControl.code`), the raw wizard answers, and rationale. Classification logic is pure in `src/lib/eu-ai-act.ts`; `src/lib/eu-ai-act-data.ts` derives the approval-blocker / recommendation input. Saving pre-creates `ComplianceMapping` rows for applicable articles and raises `eu_ai_act` alerts.
- `AgentToolCall` and `AgentToolProfile`
  MCP tool governance telemetry written by both proxies: one row per distinct tool the model invoked in a response, and a first/last-seen profile per (scope, server, tool). `AIAgent.mcpServerAllowlist` / `mcpToolAllowlist` / `mcpEnforcement` hold the policy. Pure extraction and allowlist logic lives in `src/lib/mcp-tool-governance.ts` (mirrored byte-for-byte in `ai-proxy/src/lib/`); IO in `src/lib/mcp-tool-activity.ts` and `ai-proxy/src/lib/tool-activity.ts`.
- `GovernanceReview`, `GovernanceException`, `GovernanceIncident`
  Support staged signoff, exception handling, and oversight workflows.
- `VendorProfile`
  Stores contract posture, lifecycle dates, review status, residency, subprocessors, approved use cases, and renewal notes.
- `UsageBucket` and `CostBucket`
  The normalized telemetry layer for provider oversight.
- `DiscoveredAITool`
  Normalized shadow AI discoveries. `externalAppId` / `externalAppProvider` are the IdP handles that make identity enforcement possible — a discovery without them cannot be enforced at the identity layer.
- `KeyUsageRule` and `ApiKeyProfile`
  Rule definitions for credential-behavior alerting, and the per-key rolling profile the rules evaluate against.
- `PolicyDenial`
  One row per request the proxy evaluated as a policy violation, in both dry-run and enforce modes.
- `SensitiveScan` and `SensitiveFinding`
  Probe runs and the sanitized findings they produce. Findings store redacted excerpts only.
- `ProviderSecurityScan` and `ProviderSecurityResult`
  Results of the provider secure-use and privacy configuration audit.
- `ReportDefinition`, `ReportRun`, `ReportSchedule`
  Report configuration, run history with stored artifacts, and recurring delivery.
- `ClaudeCodeEvent` / `ClaudeCodeMetric`, `CursorMetric` / `CursorSpan`
  Per-surface developer-AI telemetry from the OpenTelemetry pipeline. Metadata only — no prompt or code content.
- `ProxyHealthSnapshot`
  Periodic Azure Monitor captures backing the Proxy Health board.
- `PromptRiskRule` and `PromptRiskException`
  Tunable dangerous-prompt detection rules and their suppression exceptions.

## Risk Center Architecture

Risk Center is no longer just a score form. The implementation is split across a few helpers:

- `src/lib/risk-center.ts`
  Shared risk scoring, recommended tier logic, control-gap detection, agent overlays, and reassessment drift logic.
- `src/lib/risk-questionnaire.ts`
  Dynamic branching questions based on data sensitivity, autonomy, and user impact.
- `src/lib/risk-templates.ts`
  Starter assessment templates for copilot, vendor AI SaaS, autonomous agent, and customer-facing AI.
- `src/components/forms/risk-assessment-form.tsx`
  The main UI that combines scores, templates, branching questions, AI generation, and control-gap guidance.

If you add new risk behavior, prefer adding it to the shared helpers first and then wiring it into the form or overview page. That keeps the logic testable and reusable.

## Governance Workflow Architecture

Governance decisions are intentionally centralized in shared logic instead of being embedded directly in page components.

- `src/lib/governance-workflow.ts`
  Computes stage/readiness state and next workflow actions.
- `src/lib/governance-recommendations.ts`
  Builds prioritized next-best actions per system from workflow, policy, exception, and incident state.
- `src/lib/policy-rules.ts`
  Parses and evaluates structured policy rules.

If you add new approval gates or recommendation logic, update these shared libs first.

## Vendor Governance Architecture

Vendor governance now has three layers:

- profile data in `VendorProfile`
- composite scoring in `src/lib/vendor-risk.ts`
- lifecycle and renewal state in `src/lib/vendor-lifecycle.ts`

The main page is:

- `src/app/(dashboard)/oversight/vendors/page.tsx`

If you add more vendor posture signals, prefer extending the shared scoring/lifecycle helpers instead of hard-coding logic directly in the page.

## Shadow AI Architecture

Shadow AI discovery is normalized into one pipeline even though the sources differ.

Important files:

- `src/lib/google-workspace.ts`
- `src/lib/microsoft-365-shadow-ai.ts`
- `src/lib/hexnode.ts`
- `src/lib/crowdstrike.ts`
- `src/lib/discovered-tools-ingest.ts` and `src/lib/third-party-proxy-ingest.ts` (DNS / proxy / Netskope imports)
- `src/lib/ai-tools-registry.ts`
- `src/lib/scan-executor.ts`
- `src/app/api/discovered-tools/scan/route.ts`

The source-specific scanners gather raw signals, the tool registry handles matching, and the scan executor persists normalized discoveries. Adding a source means writing a scanner and registering it in `ShadowAIScanProvider` inside `scan-executor.ts` — the dedupe, confidence scoring, and suppression logic is shared and should not be reimplemented per source.

Hostnames from log imports are normalized before matching, so trailing dots and case differences do not create duplicate tools.

## Shadow AI Enforcement Architecture

Blocking a discovery records a decision; it does not by itself stop anything, because UrNammu is not in the traffic path. Two independent layers do the enforcing:

- `src/lib/shadow-blocklist.ts` — builds the denylist of blocked domains, served by `src/app/api/discovered-tools/blocklist/route.ts` in `text`, `hosts`, `json`, or `pac` format for a DNS sinkhole, proxy, firewall, or CASB to poll. Bearer-token guarded, and **fails closed**: with no token configured the route returns 503 rather than serving unauthenticated.
- `src/lib/identity-enforcement.ts` — disables the app at the identity provider (Google Workspace or Microsoft Entra) so sign-ins stop. Requires the IdP app handle captured at scan time; without one the result is `skipped`, and a missing Graph permission surfaces as `failed` rather than silent success.

The two are complementary, not redundant: identity enforcement only governs apps federated to the IdP, so a tool someone used with a personal account is only catchable by the network feed. When adding enforcement behavior, keep the "record the decision" path separate from the "make it stick" path — that separation is why a block is still auditable when no enforcement layer is configured.

## Telemetry Architecture

There are two distinct telemetry pipelines, and mixing them is the most common mistake when extending Oversight.

**Provider-reported usage** — normalized into `UsageBucket` and `CostBucket` from provider admin APIs, gateways, and billing exports:

- `src/lib/oversight-telemetry.ts`
- `src/app/(dashboard)/oversight/page.tsx`
- `src/app/(dashboard)/oversight/usage/page.tsx`

Prefer `UsageBucket` and `CostBucket` over reading `APIUsageLog` directly. `APIUsageLog` is the proxy's own write path and is the right source only for proxy-specific views such as Proxy Health.

Because a single request can be recorded by both the proxy and a provider admin API, cost aggregation deduplicates. Reuse the existing exclusion helper (`EXCLUDE_PROXY_DUPLICATES_COST`) rather than summing `CostBucket` naively, or you will double-count proxied spend.

**Per-surface developer-AI telemetry** — OpenTelemetry data landing in dedicated tables (`ClaudeCodeEvent`, `ClaudeCodeMetric`, `CursorMetric`, `CursorSpan`) behind the Claude Code, Cowork, and Cursor pages. Session traces are reconstructed from event timing in `src/lib/claude-code-traces.ts`; spans are **derived**, not client-emitted, so treat durations as approximations.

All of this is metadata only — no prompt text and no code content — and that boundary should be preserved in anything new. Not every surface carries the same fields: the Cursor hook reports no token or cost data, so a spend figure there would be fabricated rather than zero.

## Background Jobs

Two kinds of scheduled work, both wired in `vercel.json` and Bearer-guarded with `CRON_SECRET`.

**The hourly maintenance pass** — `GET /api/scheduler/maintenance`, orchestrated by `runScheduledMaintenance()` in `src/lib/background-jobs.ts`:

- provider telemetry syncs
- Google Workspace, Microsoft 365, Hexnode, and CrowdStrike shadow-AI scans
- governance automation alerts (review renewals, exception renewals, ownership escalations)
- key usage rule evaluation

Each job checks its own saved enable/interval settings before doing work, so the hourly tick is cheap when little is due. Two details worth preserving if you extend it: scans stuck in `running` for more than ten minutes are marked failed at the top of the pass, and key-usage evaluation runs **last** inside a catch so a bad rule cannot fail the whole maintenance run.

**Dedicated crons**, each on its own schedule:

- `/api/cron/run-report-schedules` — every 15 minutes
- `/api/cron/sensitive-scan` — daily
- `/api/cron/provider-security-scan` — daily
- `/api/cron/prune-claude-code-metrics` — daily
- `/api/cron/prune-cursor-metrics` — daily

The two prune jobs exist because the OTel surfaces are high-volume; if you add another telemetry surface, add a retention job with it rather than letting the table grow unbounded.

## Settings Strategy

Settings are split by responsibility:

- `Settings > General`
  AI provider and model defaults for in-app AI features, plus the global proxy policy enforcement mode (`off` / `dryrun` / `enforce`).
- `Settings > Provider Admin APIs`
  OpenAI, Anthropic, Gemini billing, and gateway integrations, with anomaly and attribution tuning.
- `Settings > Proxy Setup`
  Proxy secret, generated client config, and attribution headers.
- `Settings > Users & Identity`
  Authentication providers and user-management options.
- `Settings > Shadow AI`
  Discovery configuration for every scan source and log import, plus the blocklist feed token and the enforcement readiness summary.
- `Settings > Reporting`
  Email delivery for scheduled reports.

Secret values are stored in `AppSetting` and encrypted with `SETTINGS_ENCRYPTION_KEY`. `getSetting()` falls back to the matching environment variable when no database value is present, so UI values always win over env. Do not rotate `SETTINGS_ENCRYPTION_KEY` after data has been written — previously encrypted settings become unreadable.

The `Integrations` page reads the same settings data but is deliberately catalog-only. Add configuration UI under `Settings`, then let the tile reflect it.

## Reports Architecture

Reports are definition-driven rather than hand-coded per report:

- `src/lib/reports/data-sources.ts` — the eight sources and their typed, filterable columns. This is the file to touch when exposing new data to reporting.
- `src/lib/reports/query.ts` and `generate.ts` — turn a stored definition into rows, then into an artifact.
- `src/lib/reports/export/` — `pdf.tsx`, `csv.ts`, `json.ts`.
- `src/lib/reports/schedule.ts` and `email.ts` — recurrence and delivery.
- `src/lib/reports/access.ts` — `PRIVATE` / `SHARED` visibility and the author-role checks.

Adding a column to an existing source is a `data-sources.ts` change only; the builder, preview, filters, and every export format pick it up automatically. Run artifacts above `MAX_STORED_ARTIFACT_BYTES` (5 MB) are still streamed to the requester but not persisted to run history.

## In-App Help Architecture

Help content is authored as markdown and compiled into a runtime bundle:

- `docs/help/*.md` — the source of truth, one file per help key.
- `src/lib/help/content.ts` — **generated**. Holds `HelpKey`, `HELP_TITLES`, `HELP_CONTENT`, and `helpKeyForPath()`.
- `scripts/gen-help-content.mjs` — the generator. `npm run help:sync` writes the bundle; `npm run check:help-drift` fails if it is stale.
- `src/components/help/markdown.tsx` — the renderer.
- `src/lib/help/hints.ts` — short inline `HelpHint` strings for form labels, separate from page help.

Never hand-edit the strings in `content.ts`; edit the markdown and re-run `help:sync`. Two constraints to respect when writing help:

- The renderer supports a deliberate subset — `#` and `##` headings, `-` bullets, `**bold**`, `` `code` ``, and inline markdown links. H3s, ordered lists, tables, blockquotes, code fences, and single-asterisk italics render as **literal text**. The generator rejects all of these, so a violation fails the build step rather than shipping visibly broken help.
- Adding a page means adding the markdown file, then registering the key in `ORDER` (with its drawer title) and `ROUTES` (with its pathname prefix) in the generator. A route with no entry silently falls back to the Dashboard drawer.

## How To Extend Safely

When adding a new feature, the safest pattern in this codebase is:

1. Update shared domain logic in `src/lib` first.
2. Add or update validation in `src/lib/validations`.
3. Update the route handler in `src/app/api`.
4. Wire the feature into the page/component surface.
5. Add a focused test for the shared logic.
6. If Prisma changes are involved, add a migration and run `prisma generate`.

This project moves faster when business rules stay centralized and page components stay mostly presentational.

## Verification Workflow

For most changes, the standard check set is:

```bash
npx prisma generate
npx eslint <touched-files>
npx tsc --noEmit --pretty false
npm test
```

If you touch Prisma types, rerun `tsc` after `prisma generate`.

Lint the files you touched rather than the whole repo. A full `npm run lint` currently reports a large pre-existing backlog, so a repo-wide problem count tells you nothing about whether your change is clean — lint explicit paths instead.

Repo-specific guards, worth running when they apply:

```bash
npm run check:help-drift     # docs/help/*.md vs src/lib/help/content.ts
npm run check:schema-drift   # Prisma schema vs migrations
npm run check:secrets        # no credentials staged
```

## Common Extension Points

- New governance rule:
  Start in `src/lib/policy-rules.ts`.
- New recommendation:
  Start in `src/lib/governance-recommendations.ts`.
- New risk heuristic:
  Start in `src/lib/risk-center.ts`.
- New branching review question:
  Start in `src/lib/risk-questionnaire.ts`.
- New assessment template:
  Start in `src/lib/risk-templates.ts`.
- New vendor risk signal:
  Start in `src/lib/vendor-risk.ts` or `src/lib/vendor-lifecycle.ts`.
- New Shadow AI source:
  Start with a scanner in `src/lib`, then plug it into `src/lib/scan-executor.ts`.
- New key usage condition:
  Add the variant to `KeyUsageConditionType` in the schema, the Zod config in `src/lib/validations/key-usage-rule.ts`, and the evaluator in `src/lib/key-usage-evaluation.ts`.
- New prompt-risk category:
  Rules are data, not code — add a `PromptRiskRule` row. Rule keys are immutable once created because exceptions reference them.
- New EU AI Act question or obligation rule:
  Edit the option lists and `classifyEuAiAct()` in `src/lib/eu-ai-act.ts`; article codes must exist in the EU_AI_ACT catalog. Extend `eu-ai-act.test.ts` with the new branch.
- New framework control or crosswalk link:
  Edit `src/lib/framework-catalog.ts` (codes are immutable once shipped), then add a migration containing the output of `npx tsx scripts/gen-framework-catalog-sql.ts`. The inserts are idempotent, so re-emitting the whole block is safe.
- New MCP tool signal or allowlist rule:
  Edit `src/lib/mcp-tool-governance.ts`, copy it over `ai-proxy/src/lib/mcp-tool-governance.ts` (the file header explains the mirror), and extend `mcp-tool-governance.test.ts`. Proxy write models must stay in sync across both Prisma schemas — `npm run check:schema-drift` enforces it.
- New report column or data source:
  Start in `src/lib/reports/data-sources.ts`.
- New help page:
  Add `docs/help/<key>.md`, register it in `scripts/gen-help-content.mjs`, then run `npm run help:sync`.
- New telemetry surface:
  Model the metric/event tables, add an ingest route, and add a retention prune cron alongside it.

## Current Caveat

When you add Prisma fields, make sure you:

- update `prisma/schema.prisma`
- create a migration
- run `npx prisma generate`

Some local type errors after schema edits are just stale generated client state and disappear after regeneration.
