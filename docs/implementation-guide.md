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
  Tracks AI agents, autonomy, human review requirements, connected systems, AI-assisted agent risk review, MCP tool governance (server/tool allowlists, observed tool activity from the proxy), and the kill switch (`suspendedAt` / `suspendedById` / `suspendedReason`).
- `Shadow AI`
  Ingests and normalizes discoveries from Google Workspace, Microsoft 365, Hexnode UEM, CrowdStrike Falcon, DNS/proxy/Netskope imports, and the endpoint agent. Also owns the two enforcement layers for blocked tools.
- `Endpoints`
  Fleet view of machines running the endpoint agent (`ops/endpoint-agent`) and the AI tools each one runs and reaches — the only source that observes from *inside* a device, covering off-VPN laptops, personal-tier accounts, desktop apps with no SaaS audit trail, and local inference.
- `Risk Center`
  Handles system risk assessments, dynamic review questions, use-case templates, agent-aware overlays, and reassessment triggers.
- `Compliance`
  Manages policies, rule-based enforcement, compliance evidence, governance workflows, and the seeded framework control catalog with crosswalk inheritance and per-framework coverage.
- `Oversight`
  Surfaces normalized provider telemetry, drift, incidents, vendor governance, and operational follow-up. Also hosts the per-surface developer-AI dashboards (Claude Platform, Claude Code, Cowork, Cursor, GitHub Copilot) and the provider security/privacy scan.
- `Alerts`
  Central alert inbox, plus two tunable rule engines: prompt-risk rules (what is being asked) and key usage rules (how a credential behaves).
- `Reports`
  Definition-driven reporting over nine data sources (eight Prisma-model sources plus the computed Usage by Person source), with PDF/CSV/JSON export and scheduled email delivery.
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
- `ops/endpoint-agent`
  Standalone Go project for the endpoint agent — collectors, packaging, and MDM deploy scripts. Built and released separately from the Next.js app; excluded from its TypeScript build by virtue of not being TypeScript.

## Key Domain Models

The most important Prisma models are:

- `AISystem`
  The main governance record for a system. This is the center of approvals, policies, risk, incidents, evidence, and linked agents.
- `AIAgent`
  Operational agents tied to a system or discovered independently. Stores autonomy and review signals.
- `DiscoveredAgent`
  The agent-discovery review queue, keyed by `(source, externalId)`. Every source writes through `upsertDiscoveredAgent()` in `src/lib/agent-discovery.ts` (list columns union, timestamps widen, reviewer `status` / `notes` untouched, one MEDIUM `agent_discovery` alert on first create unless the input sets `suppressAlert` or `linkedAgentId`); `registerDiscoveredAgent()` promotes a row into `AIAgent`. See *Agent Discovery Architecture* below and `docs/plans/agent-discovery.md`. API: `GET /api/discovered-agents`, `GET|PUT /api/discovered-agents/[id]`, `POST /api/discovered-agents/[id]/register`, `POST /api/discovered-agents/detect`, `POST /api/discovered-agents/import`.
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

  **Agent charter and approval gate.** `AIAgent` carries the charter (`purpose`, `inScopeActions[]`, `outOfScopeActions[]`, `decisionBoundaries`, `successCriteria`), the four `require*Approval` toggles, `reviewIntervalDays` and `nextReviewDate`. `AgentApproval` and `AgentGovernanceReview` are agent-scoped twins of `SystemApproval` / `GovernanceReview` (kept separate so every existing `aiSystem` include stays non-nullable). Pure logic in `src/lib/agent-governance.ts` — `getCharterStatus`, `getAgentApprovalBlockers` (each blocker carries `soft`), `getAgentWorkflowSummary` (returns the same shape as the system summary), `getAgentChecklist` — with the Prisma loader in `agent-governance-data.ts` shared by the detail page and `POST /api/agents/[id]/approval`. `POST /api/agents/[id]/governance-review` records stage sign-offs. `PUT /api/agents/[id]` refuses a transition into APPROVED/DEPLOYED without an APPROVED `AgentApproval`. The system cards `ApprovalDecisionCard` and `GovernanceStageReviewCard` take an `endpoint` (and `subjectNoun`) prop so the agent page reuses them; `WorkflowSummaryCard` is the extracted workflow strip.

  **Human-review triggers (enforced).** `AIAgent.humanReviewTriggers` holds the structured list defined in `src/lib/human-review-triggers.ts` (mirrored into `ai-proxy/src/lib/`): `tool`, `tool_argument` (dot-path + op + value), `sensitive_data`, `note`; `normalizeHumanReviewTriggers()` coerces legacy free text into notes. `AIAgent.humanReviewEnforcement` is `monitor` | `enforce`. `ObservedToolUse` now carries `input` (and `id`); non-streaming extractors read `tool_use.input` / `function.arguments` / `mcp_call.arguments`, and streaming uses `createAnthropicToolUseAccumulator()` (assembles `input_json_delta` until `content_block_stop`) and `createOpenAIToolUseAccumulator(endpoint)` (Chat Completions `delta.tool_calls[].function.arguments` by index; Responses `response.output_item.done`). `collect*ToolUsesFromSse(text)` read a fully buffered body. IO: `evaluateAgentReviewTriggers()` (runs the response-DLP detector over arguments for `sensitive_data`) and `recordHumanReviewMatches()` (PolicyDenial `human_review_required`, mode `dryrun`/`enforced`, `requestMetadata.matches[]`; HIGH alert source `human_review_trigger`) in `mcp-tool-activity.ts` / `tool-activity.ts`; `recordToolActivity` flags `AgentToolCall.reviewRequired`. Handlers: non-streaming evaluates after extraction and returns 403 `humanReviewBlockedBody()` in enforce mode; streaming in enforce mode (`agentEnforcesReview(agent)`) buffers the upstream body, evaluates via the collectors, and either returns 403 (the extractor still runs over the buffer with `reviewDecision: "blocked"` so usage and denials are logged) or replays the buffer through the existing tee. Anthropic + OpenAI/Azure OpenAI only; Gemini and Bedrock forward unevaluated.

  **Governance posture.** `src/lib/agent-posture.ts` (pure): `computeAgentPosture(PostureInput)` scores the six dimensions with weighted checks (partial credit for charter thirds and stage-review fractions), `tierOf()`, and `summarizePostures()` for the portfolio. `PostureInput` = `AgentGovernanceInput` + `connectedSystemsCount`, `toolArgumentTriggersCount`, `baseline { mature, findingsCount }`. `agent-governance-data.ts` now builds inputs through shared `buildGovernanceInput` / `buildPostureInput` mappers over one `governanceInclude`; `loadAgentGovernance()` returns `posture`, and `loadAgentPostures()` scores every agent in two queries for the registry badge and the executive `AgentPostureSummaryCard`.

  **Behaviour baselines.** `src/lib/agent-baseline.ts` (pure): `computeBaseline(days, windowDays)` over `DailyActivity` rows (active days only), `evaluateDrift(stats, recent)` with the rules in the user guide, `MIN_BASELINE_ACTIVE_DAYS = 7`. `agent-baseline-data.ts` loads per-agent/per-UTC-day activity with two `$queryRaw` aggregates (APIUsageLog grouped by `promptMetadata->>'agentId'` — no expression index, hence daily — and AgentToolCall by `agentId`), upserts `AgentBehaviorBaseline` (`stats`, `lastFindings` JSON) and raises `agent_behavior_drift` alerts (24 h dedupe by title). Entry points: `/api/cron/agent-baselines` (daily, `vercel.json`) and `POST /api/agents/[id]/baseline`. The notifications route counts `agent_behavior_drift` alongside `system_drift`.

  **Approved MCP catalog.** `McpCatalogEntry` (server pattern, `tools[]`, `active`, approver) is a READ model on the proxy (mirrored, in `check-schema-drift` READ_MODELS). `mergeCatalogIntoConfig(own, catalog)` in `mcp-tool-governance.ts` (mirrored) is the single definition of inheritance: servers additive (and the whole allowlist when the agent has none), tool entries added only when the agent already has a tool allowlist. Both loaders apply it when `AIAgent.inheritMcpCatalog` is set (Azure `agent-loader.ts` caches the catalog 60 s, fail-closed like the agent row; Vercel `loadAgentGovernance` reads it per request); `agent-governance-data.ts` scores blockers against the same effective config and returns `inheritedServers` for the MCP card. `/api/mcp-catalog` GET/POST (upsert by `server`, reactivates) and `DELETE /api/mcp-catalog/[id]` (soft). `inheritMcpCatalog` defaults false in the DB (existing agents unchanged) and true in the create schema.

  **Accountability, incidents, retirement.** `AIAgent.technicalOwnerId` / `riskOwnerId` (User relations) / `escalationContact`, and `retiredAt` / `retiredById` / `retirementNotes` / `retirementAttested`. `GovernanceIncident` is now polymorphic: `aiSystemId` optional plus `agentId` optional with a CHECK constraint that at least one is set (migration `20260930210000_agent_incidents_retirement`); only the notifications route assumed a non-null system. `POST /api/agents/[id]/incidents` + `PUT …/[incidentId]` mirror the system routes (alert attributed to the parent system when present); `GovernanceIncidentsCard` takes `endpoint` + `subjectNoun`. `POST /api/agents/[id]/retire` sets RETIRED, records the retirement fields, creates a REVOKED `AgentApproval` when one stands, audits `RETIRE`. `agent-governance.ts`: open incidents are a hard blocker (`incident`); missing risk owner (HIGH/CRITICAL) and escalation contact (FULL_AUTONOMY/SUPERVISED) are soft (`accountability`); checklist gains "Name the accountable people"; `getAgentRetirementChecklist()` drives the Retirement checklist (`loadAgentGovernance` returns `retirement` input incl. 7-day `agentToolCall` count and open-incident count). `workflow-notifications.ts` accepts `agentApprovals`, `agentOverdueReviews`, `reviewAlerts` and per-incident `href`.

  **Pending review queue.** `HumanReviewRequest` (WRITE model on the proxy, scalar parity enforced) holds withheld calls: `fingerprint` (sha256 over tool + canonical arguments, order-independent; `src/lib/review-fingerprint.ts`, mirrored, server-only because it uses `crypto`), `triggers[]`, `calls` JSON, `occurrences`, and the decision (`waiverScope` exact|trigger, `expiresAt`, `usesRemaining`). `adjudicateHumanReview()` in `mcp-tool-activity.ts` / `tool-activity.ts` runs in enforce mode only: it finds APPROVED waivers for the agent, splits matches into `waived` (consuming uses; `CONSUMED` at zero) and `withheld`, and upserts one PENDING request per fingerprint. Handlers withhold only when something was withheld; the 403 body (`humanReviewBlockedBody(agent, withheld, request)`) carries `review.id`. Stream extractors take a `StreamReviewDecision` from the handler instead of re-adjudicating, so waivers are consumed once. Monitor mode is unchanged (dry-run denials, no requests). App side: `human-review-queue.ts` (list, defaults, `expireHumanReviews` run by the baselines cron), `GET /api/human-review`, `POST /api/human-review/[id]/decision`, page `/oversight/human-review`, notifications `pendingReviews`.

  **Agent kill switch.** `src/lib/agent-runtime-gate.ts` (mirrored) turns an agent's `status` + `suspendedAt` into a verdict: suspended → `agent_suspended`, `RETIRED` → `agent_retired`, anything else forwards. Both proxies evaluate it immediately after attribution on every provider path — the Azure side inside `resolveAttribution(req, provider)` in `proxy-gate.ts` (the agent loader now selects `status` and `suspendedAt`; 30 s TTL cache), the Vercel side via `runAgentRuntimeGate()` in `proxy-common.ts` called by each `handle*Proxy`. A blocked request returns `403 { error: { type: "agent_blocked", violations[] } }` and writes an enforced `PolicyDenial` (`model: "unknown"`, `requestMetadata.agentId`). `POST`/`DELETE /api/agents/[id]/suspend` flip the switch and audit `SUSPEND` / `RESUME`. Follow-on lifecycle work is planned in `docs/plans/agentic-governance-playbook.md`.
- `GovernanceReview`, `GovernanceException`, `GovernanceIncident`
  Support staged signoff, exception handling, and oversight workflows.
- `VendorProfile`
- `VendorAssessment`
  Stores contract posture, lifecycle dates, review status, residency, subprocessors, approved use cases, and renewal notes.
- `UsageBucket` and `CostBucket`
  The normalized telemetry layer for provider oversight.
- `AssistantDailyStat`  Per-person, per-day coding-assistant stats (provider `claude_code` from the Anthropic Admin API analytics report, `cursor` from the Cursor Admin API daily-usage + usage-events feeds, `github_copilot` from the Copilot usage metrics `users-1-day` report, `chatgpt` and `codex` from the ChatGPT Enterprise Compliance Logs Platform) as columns: sessions, requests, lines added / removed / accepted, commits, PRs, tool accept / reject, tokens, cost, `isActive`. Written by `syncClaudeCodeAnalytics` / `syncCursorTelemetry` / `syncGitHubCopilotTelemetry` / `syncChatGPTEnterprise` in `src/lib/provider-telemetry.ts` via the pure mappers in `src/lib/assistant-daily-stats.ts` and `src/lib/github-copilot-metrics.ts`; the log-derived providers accumulate onto an existing day row through `mergeAssistantDailyStat` because a day's events arrive across several runs. Read by `claude-code-dashboard.ts`, `cursor-dashboard.ts`, `github-copilot-dashboard.ts`, and `people-usage.ts` (which feeds the `PEOPLE_USAGE` report source). The syncs still write the legacy per-day `UsageBucket` rows (same data in `metadata` JSON) for one release; new readers should not depend on them.
- `ComplianceActivity` and `ProviderSyncWatermark`
  `ComplianceActivity` holds immutable auth / admin-audit events from provider compliance feeds, keyed by the upstream event id (`createMany({ skipDuplicates })` makes overlapping pulls idempotent); today provider `openai` from the ChatGPT Enterprise `AUTH_LOG` / `AUDIT_LOG` streams, with the Anthropic Compliance API (Tier 3 item 3.4) planned to share it. `ProviderSyncWatermark` is one row per incremental stream keyed by `provider`: the per-provider sync windows described under *Sync windows, watermarks, and backfill* below (`anthropic`, `cursor`, `github_copilot`, …), plus the ChatGPT Enterprise cursors (`chatgpt_enterprise`, `chatgpt_enterprise:<EVENT_TYPE>`, `chatgpt_enterprise:GPTS`) recording the instant ingested through.- `DiscoveredAITool`
  Normalized shadow AI discoveries. `externalAppId` / `externalAppProvider` are the IdP handles that make identity enforcement possible — a discovery without them cannot be enforced at the identity layer.
- `DirectoryPerson`
  One row per person in an identity provider's directory, keyed by `(source, externalId)` with `source` = `google_workspace` | `microsoft_365`. Stores the lower-cased `primaryEmail`, deduped `aliases` (never containing the primary), `displayName`, `department`, `title`, `managerEmail`, `orgUnit`, `active` / `deactivatedAt`, `lastSyncedAt`, and the raw provider payload. Written only by `runDirectorySync()` in `src/lib/directory-sync.ts` (Google Admin SDK `users.list`, Graph `/users?$expand=manager`), whose runs are `ProviderSyncRun` rows with `syncType = "directory"`. The pure mappers and read-side helpers (alias map, department rollup) live in `src/lib/directory-identity.ts`. Consumers: `people-usage.ts` (alias folding, enrichment, `directoryStatus`), the `/api/discovered-tools` department rollup, the offboarding hook (suspends a matching `ACTIVE` `User`), and the `usage_after_deactivation` governance check in `governance-automation.ts`.
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
- `EndpointDevice` and `EndpointDetection`
  The endpoint agent's fleet and its observations. `EndpointDevice` is one enrolled machine keyed by a stable hardware id (`machineId`), holding the SHA-256 of its per-device bearer token — the plaintext is returned once at enrollment and never stored — plus `status` (`ACTIVE` | `STALE` | `REVOKED`) and the last cycle's per-collector health. `EndpointDetection` is one `(device, signal, toolName, evidence)` row, merged on repeat so the table grows with the fleet's tool surface, not with time; `evidence` is non-null and part of the unique key because Postgres treats NULLs as distinct, which would defeat the index. Never store content here: the schema deliberately has no field wide enough for a prompt, and `evidence` holds a bundle id, a bare hostname, or `runtime:port`.
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

Vendor governance has four layers:

- profile data in `VendorProfile`, plus `VendorAssessment` rows for the vendor risk questionnaire
- composite scoring in `src/lib/vendor-risk.ts` (the latest completed questionnaire is one of its inputs: MEDIUM adds 6 points, HIGH 15, CRITICAL 25)
- lifecycle and renewal state in `src/lib/vendor-lifecycle.ts`
- the questionnaire bank and scoring in `src/lib/vendor-questionnaire.ts`, and the onboarding checklist in `src/lib/vendor-onboarding.ts`

Pages:

- `src/app/(dashboard)/oversight/vendors/page.tsx` — the list
- `.../vendors/new` — Add vendor (identity step). `POST /api/vendor-profiles/onboard` creates the profile, or returns the existing one matched case-insensitively.
- `.../vendors/[id]` — vendor page with the checklist
- `.../vendors/[id]/setup?step=` — profile wizard. Each step calls `PATCH /api/vendor-profiles/[id]` with only that step's fields.
- `.../vendors/[id]/assessment?step=` — questionnaire. `POST /api/vendor-assessments` starts or resumes one, `PATCH /api/vendor-assessments/[id]` merges one section's answers, and `POST /api/vendor-assessments/[id]/complete` scores it, locks it and writes the decision to `VendorProfile.securityReviewStatus`.

The older `POST /api/vendor-profiles` full upsert is still there for API clients, but the UI no longer uses it.

Questionnaire questions are static and keyed by id. Stored answers go through `parseVendorAnswers`, which drops ids that no longer exist, so retiring a question is safe. Changing what a question means is not safe: add a new id instead, so old answers are not reinterpreted.

If you add more vendor posture signals, prefer extending the shared scoring/lifecycle helpers instead of hard-coding logic directly in the page.

## Guided Workflows

Shared building blocks for step-by-step flows live in `src/components/workflow/` and `src/lib/workflow.ts`:

- `WizardStepper` — the progress header. It uses a container query, so it collapses to "Step n of m" whenever the content area is narrow, not only on small screens.
- `WizardFooter` — Back / Skip for now / Save & continue, with saving and error states.
- `ChecklistCard` — a server component that renders `ChecklistItem[]` with a progress bar and a "Next step" link.
- `TagInput` — a list field with one-click suggestions.
- `resolveStepId` maps a `?step=` search param to a known step. Pages read `searchParams` on the server and pass the initial step down. Wizards update the URL with `history.replaceState`, so a step link can be shared and survives a reload.
- `canRunWorkflows(role)` gates wizard pages to ADMIN and COMPLIANCE_OFFICER. The API routes enforce the same roles with `withRole`.

Wizards save each step to the real record rather than to a draft table, so a checklist built from that record always shows true progress.

Current flows:

- **Vendors** — see Vendor Governance Architecture above.
- **Risk assessment** — `src/components/forms/risk-assessment-form.tsx` with steps from `src/lib/risk-assessment-steps.ts`. This is the one wizard that keeps state in memory until submit, because `POST /api/risk-assessments` recalculates the system's risk level.
- **Shadow AI triage** — `/shadow-ai/[id]/triage` with `src/components/shadow-ai/triage-wizard.tsx`. The suggested outcome comes from `getTriageRecommendation` in `src/lib/shadow-ai-triage.ts`, which is pure and unit-tested. Decisions go through the existing `PUT /api/discovered-tools/[id]`, which now also accepts `rationale` and `triage` (the three answers plus the suggestion) and writes them into the status-change audit entry, never into `notes`. "Next in queue" uses the same filter and order as the Needs Review list.
- **System registration** — `src/components/registry/system-setup-wizard.tsx` on `/registry/new` and `/registry/[id]/setup`. The Basics step `POST`s `/api/ai-systems` (including `discoveredToolId` for shadow AI conversions); later steps `PUT /api/ai-systems/[id]` with only their own fields. The system page's checklist comes from `getSystemChecklist` in `src/lib/system-onboarding.ts`.

`updateAISystemSchema` is written out field by field rather than derived with `createAISystemSchema.partial()`. Zod 4 applies `.default()` even inside `.optional()`, so the derived schema turned a partial update such as `{ vendor }` into one that also reset risk level, status and the approval stages. An explicit empty string clears a nullable field.

## Shadow AI Architecture

Shadow AI discovery is normalized into one pipeline even though the sources differ.

Important files:

- `src/lib/google-workspace.ts`
- `src/lib/microsoft-365-shadow-ai.ts`
- `src/lib/hexnode.ts`
- `src/lib/crowdstrike.ts`
- `src/lib/endpoint-agent.ts` (manifest, enrollment, report ingest) and `src/lib/endpoint-fleet.ts` (console read models)
- `src/lib/discovered-tools-ingest.ts` and `src/lib/third-party-proxy-ingest.ts` (DNS / proxy / Netskope imports)
- `src/lib/ai-tools-registry.ts`
- `src/lib/discovery-merge.ts` (pure merge rules for user count, emails, scopes, first/last seen)
- `src/lib/scan-executor.ts`
- `src/app/api/discovered-tools/scan/route.ts`

The source-specific scanners gather raw signals, the tool registry handles matching, and the scan executor persists normalized discoveries. Adding a source means writing a scanner and registering it in `ShadowAIScanProvider` inside `scan-executor.ts` — the dedupe, confidence scoring, and suppression logic is shared and should not be reimplemented per source.

Hostnames from log imports are normalized before matching, so trailing dots and case differences do not create duplicate tools. Registry domains must be bare hostnames — `matchDomain` compares hostnames, so a URL path can never match. GitHub Copilot, for example, is keyed on the hosts its IDE extensions actually resolve (`githubcopilot.com`, `copilot-proxy.githubusercontent.com`, `copilot-telemetry.githubusercontent.com`), which is what DNS logs record. When several registry hosts match a hostname, `matchDomain` returns the most specific (longest) one, so a narrow entry (`labs.openai.com` → DALL·E, `sora.chatgpt.com` → Sora) can coexist with the broad vendor entry that owns `openai.com` / `chatgpt.com`. Two products that genuinely share a host (OpenAI Codex on `chatgpt.com`) resolve to the general product at the DNS layer and to the specific one by name or app id.

**Registry shape.** `KNOWN_AI_TOOLS` holds 160+ `KnownAITool` entries: `{ toolName, vendor, category, domains[], clientNamePatterns[], publisherPatterns?, appIdPatterns?, riskHints? }`.

- `category` is one of the closed `AI_TOOL_CATEGORY_IDS` (`chat_assistant`, `coding_assistant`, `agent_platform`, `image_generation`, `video_generation`, `audio_voice`, `writing`, `meeting_notes`, `search`, `ml_platform`, `data_analysis`, `productivity`, `translation`, `customer_support`, `browser_extension`, `other`). `AI_TOOL_CATEGORIES` / `AI_TOOL_CATEGORY_LABELS` supply UI labels; `isAIToolCategory` guards untrusted input; the PUT route validates with `z.enum(AI_TOOL_CATEGORY_IDS)`.
- `riskHints` is informational reviewer context (`trains_on_data`, `consumer_grade`, `china_hosted`, `no_enterprise_tier`) and does not affect scoring.
- `clientNamePatterns` are matched as case-insensitive substrings of the observed name, so keep them distinctive: a bare `udio` would match "Studio" and a bare `dify` would match "Modify". Prefer a domain-shaped or two-word pattern (`udio.com`, `stability ai`) and let fuzzy matching handle the bare word. Never list a host that is embedded on third-party sites (`intercom.io` widgets, `*.zendesk.com` help centers) — it would flag every visit to someone else's website.
- `src/lib/ai-tools-registry.test.ts` enforces: ≥120 entries, every entry has ≥1 domain and a valid category, domains are bare lowercase hostnames (no `/`, scheme, whitespace or `www.`), and toolNames are unique.

**Fuzzy name matching** (`resolveAIToolMatch`). An exact substring hit on a `clientNamePattern` scores +6; when none hits, the observed name(s) are compared loosely for +4 and the reason `fuzzy_name:<observed tokens>`:

- `normalizeToolName` lowercases, replaces non-alphanumerics with spaces, and drops the filler tokens `ai`, `inc`, `llc`, `app`, `the`.
- Candidate tokens are the observed tokens, each adjacent pair concatenated ("co"+"pilot"), and the whole name concatenated. Every token of a registry pattern (from `toolName` and `clientNamePatterns`) must be covered by a candidate — exactly, or with `damerauLevenshtein` (optimal string alignment, implemented locally) ≤ 1 when both tokens are ≥ 5 characters.
- Single-token patterns must be ≥ 5 characters and not in `FUZZY_GENERIC_TOKENS` (plain words such as `beautiful`, `continue`, `replicate` that are the sole token of some registry name after filler removal); multi-token patterns are distinctive by combination.
- Only `clientName` and `additionalText` are fuzzy-matched, never `publisherName`, so a fuzzy reason is always a distinguishing signal for the Hexnode/CrowdStrike guards, which reject matches whose reasons all start with `publisher matched`. Do not weaken that guard.
- Ties on score are broken by (has a non-publisher signal, longest matched name pattern, longest matched domain), so "OpenAI Codex" beats "ChatGPT" and "Microsoft 365 Copilot" beats "GitHub Copilot".

**Categories on discoveries.** `DiscoveredAITool.category` (nullable, indexed) is set from the registry on create in `scan-executor.ts` (via `resolveToolCategory({ toolName, domain })` — by registry `toolName` first, then `matchDomain`), in `discovered-tools-ingest.ts` (from the domain match), and for manual reports in `POST /api/discovered-tools`. Updates backfill it only when the existing value is null, so a reviewer's manual choice is never overwritten. Heuristic candidates that match nothing stay null and render as "Uncategorized". `GET /api/discovered-tools?category=<id|uncategorized>` filters; `PUT /api/discovered-tools/[id]` accepts `{ category }` alone or with `status` and audit-logs `UPDATE_CATEGORY`.

Backfill for rows that predate the column: `npx tsx scripts/backfill-tool-categories.ts [--dry-run]` resolves every `category IS NULL` row through the same `resolveToolCategory` and reports per-category counts plus the rows it could not resolve. Run it against production once `prisma migrate deploy` has applied `20260916180000_discovered_tool_category`.

**Observation columns.** `DiscoveredAITool` stores `userEmails`, `scopes`, `firstSeenAt`, and `lastSeenAt` as first-class fields (they were previously stringified into `notes`). Every scanner and importer funnels through the merge helpers in `discovery-merge.ts` rather than writing these directly:

- `mergeUserCount` — a rescan from the **same** `detectionSource` is authoritative and may lower the count; a **different** source only raises it (max).
- `pickEmails` — only email-shaped identities go into `userEmails`; device names and bare usernames from network logs still count toward `userCount`.
- `mergeSeenWindow` — first/last seen widen across scans. Log imports and the Netskope webhook read a timestamp column/field (`timestamp`, `@timestamp`, `time`, `date`, …; ISO or epoch via `parseLogTimestamp`) and fall back to the import time.

The Microsoft 365 scanner resolves granting principals to emails through Graph `/users/{id}`, which needs `User.Read.All` on the app registration; without it the scan still succeeds but `userEmails` stays empty. The CSV importer (`parseEntriesFromCsv`) maps headers through per-vendor presets (Umbrella, Cloudflare Gateway, Zscaler, Netskope, Prisma Access, DNSFilter, NextDNS) layered on a generic preset; add a preset rather than special-casing a vendor in the parser.

## Agent Discovery Architecture

Agents are found separately from AI tools because they carry tools, MCP servers, models and a promotion target. Platform inventory imports (Gap 2 of `docs/plans/agent-discovery.md`) each keep their response mapping pure (`map*` functions, fetch injected) and hand `DiscoveredAgentInput[]` to `applyAgentImport()` (`src/lib/agent-import.ts`), which upserts and returns `{ found, created, updated, error? }`.

| Source | Module | Runs from | Upstream |
| --- | --- | --- | --- |
| `openai_assistants` | `openai-assistant-discovery.ts` | after each successful scheduled OpenAI sync (`runProviderSync`) | `GET /v1/assistants` with the OpenAI admin key. Legacy `AIAgent` rows (name + `department: "OpenAI"`) are passed as `linkedAgentId`. 404/410 (API retired 2026-08-26) = empty import. |
| `chatgpt_gpts` | `gptToDiscoveredAgent` in `chatgpt-enterprise-compliance.ts` | inside `syncChatGPTEnterprise`, after the GPTS stream | Compliance API `/workspaces/{ws}/gpts`. The baseline run (no `chatgpt_gpts` rows in `DiscoveredAgent` yet) sets `suppressAlert`. Counts land in the run metadata under `gpts.discoveredAgents`. |
| `anthropic_managed_agents` | `anthropic-managed-agents.ts` | `agent_platforms` discovery scan | `GET /v1/agents` (`anthropic-beta: managed-agents-2026-04-01`) with `anthropic_managed_agents_api_key`. Archived agents skipped; system prompts never read. |
| `microsoft_copilot` | `microsoft-copilot-agents.ts` | `agent_platforms` discovery scan, opt-in `microsoft_copilot_agents_enabled` | Graph `GET /v1.0/copilot/admin/catalog/packages?$filter=supportedHosts/any(h:h eq 'Copilot')` with the Microsoft 365 Shadow AI app token; needs `CopilotPackages.Read.All` (application) + Agent 365 license. `type: microsoft` skipped. |
| `salesforce_agentforce` | `salesforce-agentforce.ts` | `agent_platforms` discovery scan | Client-credentials token at `<MyDomain>/services/oauth2/token`, then SOQL on `BotDefinition` (retries without `AgentType` on `INVALID_FIELD`) and `BotVersion`. `normalizeSalesforceInstanceUrl` only allows Salesforce hosts. |

`agent_platforms` is a regular `DiscoveryScanSource`: `runScheduledDiscoveryScan` dispatches it to `executeAgentPlatformScan()` (`src/lib/agent-platform-imports.ts`) instead of `executeScan`, which runs the three importers in parallel (each a no-op when unconfigured, never throwing) and writes one `ScanHistory` row (`scanType: "agent_platforms"`; `toolsFound` / `newToolsAdded` / `updatedTools` count agents). It is `failed` only when every configured importer failed. Manual runs: `POST /api/discovered-agents/import` (ADMIN). Connection tests: `/api/settings/test-anthropic-managed-agents`, `/api/settings/test-microsoft-copilot-agents`, `/api/settings/test-salesforce`.

`openai_agents` is reserved but has no importer: OpenAI's saved agents (`POST /v1/agents`, Agents API beta) have no documented list endpoint.

## Endpoint Agent → Agent Discovery

The endpoint agent (`ops/endpoint-agent`, see `docs/plans/endpoint-agent.md`) reports to `POST /api/endpoint-agent/report`; `ingestEndpointReport()` in `src/lib/endpoint-agent.ts` merges observations into `EndpointDetection` and rolls matched app/browser/network/runtime hits into `DiscoveredAITool`. Its `agents` collector adds two report arrays, validated in `src/lib/validations/endpoint-agent.ts`:

- `mcpServers[]` — `{ client, name, transport, host?, loopback, launcher?, package? }`. `client`, `transport` and `launcher` are enums; `name` is a plain identifier (no `/ \ : = @`, no credential shapes; the agent sends `redacted-<8 hex>` otherwise); `host` is the shared bare-hostname type; `package` is lowercase with at most one slash, allowed only as an npm scope for npm launchers or a docker namespace for `docker`, and never for any other launcher. Remote servers carry no launcher/package and stdio servers no host (`superRefine`).
- `agentFrameworks[]` — `{ framework, ecosystem, source, count }`; `framework` is an open `[a-z0-9_]` id so a newer agent cannot fail a whole report, `source` is a location kind enum.

Both default to `[]`, so reports from older agents still validate.

Ingest (`syncAgentDiscoveries` in `endpoint-agent.ts`, pure builders in `src/lib/endpoint-agent-discovery.ts`):

- Each server is also an `EndpointDetection` (`signal = "mcp"`, `evidence = <client>:<host|package|launcher>`), and each framework one with `signal = "framework"`. Neither rolls up into Shadow AI.
- One `DiscoveredAgent` per **(device, MCP client)**, `source = endpoint_agent`, `externalId = sha256("endpoint_agent|<machineId>|mcp_client|<client>")`, `platform` = client label, `mcpServers` = server names, `metadata = { kind: "mcp_client", deviceId, hostname, client, clientLabel, serverCount, observedAt, servers: [{ name, transport, host, loopback, launcher, package, known, risk }] }`. `metadata.servers` is the current config (replaced each report); the `mcpServers` column keeps history, as it does for every source.
- One `DiscoveredAgent` per device for frameworks (`externalId = sha256("endpoint_agent|<machineId>|frameworks")`, `framework` = highest-priority id, `metadata.kind = "agent_frameworks"`), always `low`, never alerts.
- Scoring uses `src/lib/mcp-server-registry.ts` (packages, package prefixes, remote hosts matched by suffix, capability tags): base 30, unrecognized remote host +30, unrecognized package +20, bridge (`mcp-remote`, `supergateway`, …) +15, sensitive capability (filesystem, shell, database, browser, payments, cloud) +15, local script/binary +10, ≥10 servers +5; confidence from `confidenceForScore`. Endpoint rows pass `suppressAlert` unless the score is ≥ 50 or a server is risky, so a fleet rollout does not raise one alert per laptop; drift alerts are deduped by the cumulative `metadata.alertedServerKeys`.
- Drift: before the upsert the stored `metadata.servers` is read, and newly listed risky servers raise a separate `agent_discovery` alert. A report whose `collectedAt` is older than the stored `metadata.observedAt` (a late spool replay) is skipped. After a complete (`ok`, no `reason`) `agents` scan, rows for this device that were not reported have their current server/framework list emptied and score reset — the row itself is kept for the reviewer.
- Revoked devices never reach ingest (`authenticateDevice` rejects them), and replaying an identical report changes nothing but `EndpointDetection.observations`.

Extending: add a client by adding its id to `MCP_CLIENTS` (schema) and `MCP_CLIENT_LABELS`, and its path to `ops/endpoint-agent/internal/collect/agents_paths.go` (or the per-OS file) — **ship the server change first**: items are validated individually, so an unknown client id drops that client's servers (and marks the scan partial) until the console knows it. Add well-known servers to `KNOWN_MCP_SERVERS`; no agent release is needed.

## Shadow AI Enforcement Architecture

Blocking a discovery records a decision; it does not by itself stop anything, because UrNammu is not in the traffic path. Two independent layers do the enforcing:

- `src/lib/shadow-blocklist.ts` — builds the denylist of blocked domains, served by `src/app/api/discovered-tools/blocklist/route.ts` in `text`, `hosts`, `json`, or `pac` format for a DNS sinkhole, proxy, firewall, or CASB to poll. Bearer-token guarded, and **fails closed**: with no token configured the route returns 503 rather than serving unauthenticated.
- `src/lib/identity-enforcement.ts` — disables the app at the identity provider (Google Workspace or Microsoft Entra) so sign-ins stop. Requires the IdP app handle captured at scan time; without one the result is `skipped`, and a missing Graph permission surfaces as `failed` rather than silent success.

The two are complementary, not redundant: identity enforcement only governs apps federated to the IdP, so a tool someone used with a personal account is only catchable by the network feed. When adding enforcement behavior, keep the "record the decision" path separate from the "make it stick" path — that separation is why a block is still auditable when no enforcement layer is configured.

## Endpoint Agent Architecture

The endpoint agent (`ops/endpoint-agent`, Go) is the only source that observes AI use from *inside* a machine. Everything else watches from the outside and shares one blind spot: an off-VPN laptop, a personal-tier account, a desktop app with no SaaS audit trail, and local inference, which produces no network evidence at all.

Server side lives in `src/lib/endpoint-agent.ts` (manifest, enrollment, ingest), `src/lib/validations/endpoint-agent.ts` (the wire contract), `src/lib/endpoint-fleet.ts` (console read models), and `src/app/api/endpoint-agent/*`.

**Detection knowledge stays on the server.** The agent carries no tool list. `buildDetectionManifest()` compiles `ai-tools-registry.ts` into a manifest — allowlisted hostnames, app-name substrings, local-runtime ports — that the agent fetches (ETag-conditional) and filters against locally. Three consequences worth preserving:

- Growing the registry improves every deployed agent with no agent release.
- A hostname that matches nothing known **never leaves the endpoint**. This is what makes the browser collector defensible: it is an allowlist, not a history upload.
- Final classification still runs server-side through `resolveAIToolMatch` / `matchDomain`, so endpoint discoveries are scored exactly like OAuth-scan and DNS ones.

`appPatterns` merges `clientNamePatterns` and `appIdPatterns` into one flat substring list and deliberately **excludes** `publisherPatterns` — those are single vendor words ("google", "microsoft") that would make the agent report most of the software on a corporate laptop. Patterns shorter than 3 characters are dropped for the same reason. The agent's test is meant to be crude; precision is the server's job.

**The wire contract is the privacy boundary.** `validations/endpoint-agent.ts` has no free-text field wide enough to carry a prompt, and its `hostname` type rejects anything containing a slash — so a full URL cannot be smuggled through a domain field even by a compromised agent. When extending the schema, keep that property: add identifiers and counts, never content.

**Per-device tokens.** The org-wide enrollment secret is readable on every managed laptop, so it is treated as low-value — it can enroll a device and nothing else. `enrollDevice()` issues a 256-bit token stored only as a SHA-256 hash. Revocation is terminal by design: a `REVOKED` device is refused re-enrollment, so reinstalling the agent cannot resurrect it, and `PATCH /api/endpoint-agent/devices/[id]` also rotates `tokenHash` to an unmatchable value so the credential is dead even if the status is later flipped back.

**Ingest.** `ingestEndpointReport()` normalizes all four collectors into one shape, upserts `EndpointDetection` on `(device, signal, toolName, evidence)`, then rolls matched observations into `DiscoveredAITool` through the same `discovery-merge.ts` helpers every other source uses. Two rules that are easy to get wrong:

- The rollup keys on the registry's **canonical** domain (`tool.domains[0]`), not the observed hostname — the same thing `discovered-tools-ingest.ts` does. Browser history yields every host a tool touches, so keying on the observed host turned one person using ChatGPT into six `DiscoveredAITool` rows and six identical alerts.
- **Unmatched** observations are deliberately excluded from the rollup. They stay visible on the device page as "Unclassified". One laptop's unrecognized app name is not fleet-wide shadow-AI evidence, and promoting it would bury reviewers.

Client timestamps are clamped (`clampTimestamp`) into a believable window before storage, because endpoint clocks drift and an unclamped value would corrupt `firstSeenAt` ordering permanently — the merge takes the minimum and never walks it back.

**Platform honesty.** The macOS network collector is intentionally unimplemented and reports `unsupported_platform`: there is no unprivileged, stable way to enumerate resolved hostnames on a modern Mac, and reverse-resolving connections yields CDN PTRs that match nothing. Reporting a collector as unsupported is better than shipping one that silently returns zero — the console surfaces per-collector health precisely so under-reporting is visible rather than read as "no AI activity".

## Telemetry Architecture

There are two distinct telemetry pipelines, and mixing them is the most common mistake when extending Oversight.

**Provider-reported usage** — normalized into `UsageBucket` and `CostBucket` from provider admin APIs, gateways, and billing exports:

- `src/lib/oversight-telemetry.ts`
- `src/app/(dashboard)/oversight/page.tsx`
- `src/app/(dashboard)/oversight/usage/page.tsx`
- `src/app/(dashboard)/oversight/people/page.tsx` — Usage by Person (cross-surface per-person rollup; data in `src/lib/people-usage.ts`)
- `src/lib/assistant-daily-stats.ts` + `AssistantDailyStat` — the per-person, per-day columnar layer for the Claude Code (Admin API), Cursor (Admin API), and GitHub Copilot (usage metrics) syncs; Usage by Person and the assistant dashboards read it instead of `UsageBucket.metadata`.
- `src/lib/github-copilot-admin.ts` + `src/lib/github-copilot-metrics.ts` — the GitHub Copilot usage metrics client (report links → pre-signed NDJSON downloads, fetched without the token; seats endpoint) and the pure layer: Zod schemas for the `users-1-day` and `organization-1-day` / `enterprise-1-day` rows (loose objects pinned to the fields UrNammu reads, from GitHub's published example schema), the NDJSON parser (bad lines reported, not fatal), `copilotUserRowToStat`, `copilotOrgDayToTotals`, and the day walk (`planCopilotDayWalk`: whole past UTC days only, newest 28 kept when the window is longer; `isCopilotReportPending` / `resolveCopilotWatermarkWindow`: a 404 inside the two-day publication lag holds the watermark at that day). `syncGitHubCopilotTelemetry` writes `AssistantDailyStat(provider="github_copilot")` with `actorExternalId` = seat email else lower-cased login, one org-total `UsageBucket` per day (`dimensionKey date=…|scope=org|enterprise`), and `ProviderActor` rows per seat (`metadata.lastActivityAt` drives the idle-seat list). Settings `github_copilot_token` (encrypted), `github_copilot_org`, `github_copilot_enterprise`, `github_copilot_managed_system_id`.

Prefer `UsageBucket` and `CostBucket` over reading `APIUsageLog` directly. `APIUsageLog` is the proxy's own write path and is the right source only for proxy-specific views such as Proxy Health.

Because a single request can be recorded by both the proxy and a provider admin API, cost aggregation deduplicates. Reuse the existing exclusion helper (`EXCLUDE_PROXY_DUPLICATES_COST`) rather than summing `CostBucket` naively, or you will double-count proxied spend.

**Cost attribution columns.** `CostBucket` carries the same attribution columns as `UsageBucket` — `apiKeyExternalId`, `apiKeyName`, `workspaceExternalId`, `workspaceName`, `aiSystemId` — so cost-by-system and cost-by-key never need to be joined back through the dimension key. Both models are proxy WRITE models: any column added to one schema must be mirrored in `ai-proxy/prisma/schema.prisma` or `scripts/check-schema-drift.mjs` fails CI. The governed-system resolution is pure logic in `src/lib/system-attribution.ts` (`buildSystemResolver`: per-key map → provider default, with deleted systems dropped); `provider-telemetry.ts` loads it once per sync via `loadSystemResolver` and applies `forKey` to usage rows and `forKeys` (all keys in a workspace/project agree → that system) to cost rows. Anthropic usage is grouped by `model, api_key_id, workspace_id` and cost by `workspace_id, description`; `planAnthropicCostBuckets` is the pure aggregation (cents → USD once, workspace enters the dimension key only when non-null so single-workspace orgs keep their existing keys) and the sync deletes same-day admin-sync cost rows it did not re-write so the pre-workspace rows retire instead of double-counting. The Oversight rollups are SQL aggregates in `src/lib/cost-attribution.ts`. For Anthropic, `ProviderProject` rows are workspaces (legacy `apikey_*` rows are deleted on sync); the Claude Platform dashboard reads key inventory from the latest `keys` raw snapshot instead.

**Proxy token accounting and pricing.** All proxy paths (`src/lib/anthropic-proxy.ts`, `src/lib/openai-proxy.ts` (OpenAI + Azure OpenAI), `src/lib/gemini-proxy.ts`, `src/lib/bedrock-proxy.ts`, and the five Azure functions) share one convention so `proxy_live` rows and admin-sync rows add up the same way: `inputTokens` / `promptTokens` = uncached + cache read + cache creation (all input the provider processed); `cacheReadTokens` / `cacheCreationTokens` are the breakdown. Cost = uncached × input + cacheRead × cacheReadPrice + cacheCreation × cacheWritePrice + output × outputPrice. The pricing tables (Anthropic, OpenAI, Gemini) and the `TokenUsage` helpers live in `src/lib/model-pricing.ts`, **mirrored byte-for-byte** to `ai-proxy/src/lib/pricing.ts` because the Functions project cannot import from the app; `scripts/check-mirror-drift.mjs` (`npm run check:mirror-drift`, in CI) fails when the copies — or the `proxy-providers.ts` and `mcp-tool-governance.ts` mirrors — differ. Matching is exact model id first, then family prefix. An unknown model is never charged a default: `calculateCost` returns `null`, the row stores cost `0`, and `pricingMatched: false` lands in the usage metadata. The OpenAI proxies inject `stream_options.include_usage` when the client omitted it (and strip the extra trailing usage chunk in that case) so streaming chat calls record usage and run response DLP; Responses streams carry usage on `response.completed` and need no injection. Anthropic `/v1/messages/count_tokens` and `/v1/messages/batches` pass through untouched. Proxy rows carry `requestId` and `aiSystemId`, which session traces join on.

**Proxy coverage (Tier 3.7).** Provider dialects are handled by `src/lib/proxy-providers.ts` (mirrored to `ai-proxy/src/lib/proxy-providers.ts`): OpenAI path classification (`/v1/chat/completions`, `/v1/completions`, `/v1/responses`, `/v1/embeddings`; everything else is a pass-through 0-token row with `endpoint` in metadata), Azure OpenAI deployment paths + endpoint validation (`*.openai.azure.com`, `*.cognitiveservices.azure.com`, `*.services.ai.azure.com` only) + the `azure_openai_deployments` map, Gemini `models/{model}:{method}` parsing and `usageMetadata` (promptTokenCount includes `cachedContentTokenCount`; `thoughtsTokenCount` bills as output), Bedrock path/ARN parsing, SigV4 `Authorization` parsing (region from the credential scope, `SignedHeaders` decides what is forwarded) and the `application/vnd.amazon.eventstream` frame splitter whose `chunk` payloads decode back into Anthropic stream events. `canonicalizeRequest(dialect, body)` folds every dialect into `{ model, stream, system, messages[], maxTokens }` and `policyViewOf` renders that as the messages/system/max_tokens body the policy evaluator and `analyzePromptRisk` already read — this is how policy-as-code, MCP allowlists and prompt-risk apply uniformly. The Vercel side shares auth, attribution and `logProxyUsage` through `src/lib/proxy-common.ts` and gained a policy gate (`src/lib/proxy-policy-gate.ts`, a port of the Azure loader/evaluator using `parsePolicyRules`); the Azure side shares the same through `ai-proxy/src/lib/proxy-gate.ts` and reads `azure_openai_*` settings via `settings-loader.ts` with a one-minute cache. `APIUsageLog.provider` values are `claude`, `chatgpt`, `azure_openai`, `gemini`, `bedrock`; `bucketProviderFor` maps them to `anthropic`, `openai`, `azure_openai`, `gemini`, `bedrock` for the normalized buckets. Bedrock v1 is log-only: the raw body and every client-signed header are forwarded byte-for-byte and no credentials are injected.

**Provider sync specifics.** OpenAI usage/cost reads follow the `has_more` / `next_page` cursor (`paginateOpenAI`, page-capped, `truncated` recorded in sync metadata), record `input_cached_tokens` as cache reads, and take request counts from `num_model_requests`. Portkey issues one grouped call per UTC day (`buildPortkeyDayWindows`) to produce per-day per-model usage and cost buckets and per-day per-user usage buckets (`partition=actor`); Portkey costs are treated as cents and a `reconciliation` block in the sync-run metadata compares the graph total against the summed grouped totals. Provider sync runs on a single global `provider_sync_enabled` / `provider_sync_interval_hours`; per-provider schedules are planned (see Planned work).
**Sync windows, watermarks, and backfill.** Every `sync*Telemetry` function in `src/lib/provider-telemetry.ts` takes an explicit `{ from, to }` window; none computes its own. The job layer (`getProviderSyncWindows` in `src/lib/background-jobs.ts`) derives each provider's window from its `ProviderSyncWatermark` row (`provider` PK, `watermark` = last UTC day fully ingested, `earliest` = earliest day ever ingested) via the pure helpers in `src/lib/provider-sync-window.ts`: `from = max(watermark − overlapDays, now − maxLookbackDays)` snapped to UTC midnight, `to = now`; with no watermark the window is capped at `SCHEDULED_MAX_WINDOW_DAYS` (31). Overlap defaults to 2 (`provider_sync_overlap_days`); max lookback is per provider (`PROVIDER_MAX_LOOKBACK_DAYS`: Cursor 30, Anthropic / Claude Code / OpenAI / Gemini 90, gateways 30, GitHub Copilot 365, ChatGPT Enterprise 30 — its Compliance API streams are cursor-based, so the window only labels the run). `finishSyncRun` marks the run SUCCEEDED, writes `metadata.window` / `metadata.pagination` / `metadata.truncated`, and advances the watermark with `advanceWatermark` (never backwards; `earliest` only moves earlier). `POST /api/admin-sync` accepts `{ provider, from, to }` (≤ 31 days) for a targeted window; the Backfill control in `admin-api-settings.tsx` walks a range client-side with `buildBackfillChunks` (7-day chunks, one request each). Every paginated read reports `{ pages, truncated }` — `paginateAnthropic` (usage/cost `next_page`, key/member `last_id`; the usage report defaults to 7 buckets per page, so longer windows must paginate), `paginateOpenAI`, `readHeliconeRequestPages`, `readPortkeyGroupedPages`, the Cursor page caps, `getClaudeCodeReportPaged`, and the Gemini `LIMIT 5000` row cap — and a truncated run raises a `provider_sync_truncated` alert deduplicated per provider for 24h (`raiseTruncationAlert`). The watermark still advances on a truncated run so the schedule makes progress; the alert tells the operator to backfill that window with a narrower range.

**ChatGPT Enterprise Compliance API.** `src/lib/chatgpt-enterprise-admin.ts` is the client (base `https://api.chatgpt.com/v1`, Bearer Admin key, workspace-scoped routes, 429 retry on `Retry-After`, `ChatGPTEnterpriseApiError` carrying the status). `src/lib/chatgpt-enterprise-compliance.ts` is the pure layer and is where the contract lives: JSONL parsing, `event_id` dedupe (the platform is at-least-once), the cursor rules (`resolveLogCursor`: stored `after` watermark, else 7-day initial lookback, never past 30-day retention; `planLogFileBatch`: files in `end_time` order, 40 files / 60 MB per stream per run, the watermark advances only over processed files), `complianceActivityFromEvent` for `AUTH_LOG` / `AUDIT_LOG`, `aggregateConversationMessages` and `aggregateCodexEvents` for the per-user daily counts, and the alert detectors (`detectAdminRoleGrants` from the users export vs. stored `ProviderActor.role`, `detectAdminRoleAuditGrants` from `USER_ROLE_UPDATED` / `INVITE_USERS`, `detectGptsWithActions` from `latest_config.tools[].type === "custom_action"` newer than the GPTS watermark). `syncChatGPTEnterprise` in `provider-telemetry.ts` orchestrates: users → `ProviderActor` (provider `chatgpt`), GPTs → alerts, one pass per log stream with its own watermark, Codex watermarks saved only after the Codex rows are written, a 401/403 on a stream recorded as `skipped` in the run metadata instead of failing the run. Content boundary: `CONVERSATION_MESSAGE` and `CODEX_LOG` bodies are aggregated and discarded — never stored, never logged. Alerts use source `chatgpt_compliance_api` and dedupe on title while an alert is open.
**Per-surface developer-AI telemetry** — OpenTelemetry data landing in dedicated tables (`ClaudeCodeEvent`, `ClaudeCodeMetric`, `CursorMetric`, `CursorSpan`) behind the Claude Code, Cowork, and Cursor pages. Session traces are reconstructed from event timing in `src/lib/claude-code-traces.ts`; spans are **derived**, not client-emitted, so treat durations as approximations.

All of this is metadata only — no prompt text and no code content — and that boundary should be preserved in anything new. Not every surface carries the same fields: the Cursor OTel hook reports no token or cost data, so a spend figure derived from it would be fabricated rather than zero — Cursor tokens and cost come from the Cursor Admin API sync (`provider = "cursor"` buckets) instead.

**Prompt hash correlation.** Dangerous-prompt detection runs on four surfaces (both Vercel proxies, the Azure proxy, and the `claude-code-events` / `cursor-traces` ingest routes) and none of them may persist prompt text. To still correlate the same prompt across surfaces, each computes `promptHash` = first 32 hex chars of `HMAC-SHA256(salt, normalizedPrompt)`, where the prompt is the user-authored text only (`extractUserPromptText` — `system`, assistant, tool and `tool_result` / `tool_use` content excluded, capped at 8000 chars) and normalization is trim → collapse whitespace to single spaces → lower-case. The pure logic lives in `src/lib/prompt-hash.ts`, **mirrored byte-for-byte** to `ai-proxy/src/lib/prompt-hash.ts`; `prompt-risk.ts` uses the same extractor for analysis so the hash always covers exactly the analyzed text. The salt is the `prompt_hash_salt` AppSetting (env fallback `PROMPT_HASH_SALT`, then `NEXTAUTH_SECRET`); it is deliberately a plain (non-encrypted) setting because the Azure proxy reads it with its own Prisma client (`ai-proxy/src/lib/prompt-hash-salt.ts`). With no salt, `promptHash` is `null` — an unsalted hash would be a dictionary-attackable fingerprint. What is stored: `APIUsageLog.promptMetadata.promptHash` on every proxied request (plus `promptMetadata.promptRisk.promptHash` when flagged), `Alert.promptRiskMetadata.promptHash` / `occurrences` / `surfaces` / `actors` / `lastSeenAt` on `dangerous_prompt` alerts, and `attributes["prompt.hash"]` on `ClaudeCodeEvent` / `CursorSpan` rows (the `prompt` content key stays stripped; `dedupeKey` is computed before the hash is added). What is never stored: the prompt, the normalized prompt, or the salt. `createPromptRiskAlert` dedupes by hash first — an `OPEN` `dangerous_prompt` alert with the same hash in the last 24h absorbs the sighting via the pure `mergePromptHashOccurrence` (`src/lib/prompt-risk-dedupe.ts`) instead of creating a second alert; hash-less analyses keep the original 1h same-title dedupe. The Alerts page lists other alerts sharing a hash through `findAlertsByPromptHashes` (`src/lib/prompt-hash-alerts.ts`, one JSON-path query per page).

**Idempotent ingest.** The collector retries a batch whose HTTP call timed out after a partial write, so every ingest route (`claude-code`, `claude-code-events`, `cursor`, `cursor-traces`) derives a content-hash `dedupeKey` per row (unique column; metrics hash timestamp + name + value + unit + sorted attributes, events hash timestamp + event name + session/prompt/sequence + stripped attributes, spans use `traceId` + `spanId`) and inserts with `createMany({ skipDuplicates })`. The 202 body reports `accepted` and `duplicates`. Bodies that flatten to more than 5000 rows (`TELEMETRY_MAX_ROWS`) are rejected with 413 — the collector flushes at 1000, so a 413 means something other than the collector is posting. Hash rules live in `src/lib/validations/otel-dedupe.ts`; if you add a field to a row, decide whether it belongs in the hash.

## Background Jobs

Every scheduled job is its own route under `src/app/api/cron/`, wired as its own entry in `vercel.json` and Bearer-guarded with `CRON_SECRET` via `unauthorizedCronResponse()` in `src/lib/cron-auth.ts`. The orchestration lives in `src/lib/background-jobs.ts`; the pure due-ness logic (and its unit tests) lives in `src/lib/provider-sync-schedule.ts`.

**Hourly, one function per unit of work:**

- `/api/cron/provider-sync/[provider]` — `runScheduledProviderSync()`. One cron entry per `SyncProvider` (`anthropic`, `claude_code`, `cursor`, `github_copilot`, `gemini`, `openai`, `openrouter`, `helicone`, `portkey`, `litellm`, `chatgpt_enterprise`, `anthropic_compliance`, `claude_enterprise`), staggered a few minutes apart, `maxDuration = 300`. Due-ness is computed **per provider** from that provider's latest `SUCCEEDED` `ProviderSyncRun`, with the effective schedule resolved as `provider_sync_<provider>_*` → `provider_sync_*` → built-in default (enabled, 6 h). The OpenAI job also runs Assistants discovery (into `DiscoveredAgent`, source `openai_assistants`) after a successful sync. Every sync function takes `(triggeredByUserId, window)`; the job layer derives `window` from the provider's `ProviderSyncWatermark` (`computeSyncWindow`: watermark minus the overlap days, floored at `PROVIDER_MAX_LOOKBACK_DAYS`, capped at 31 days) and each sync finishes through `finishSyncRun`, which records the window and pagination in the run metadata, advances the watermark, and raises `provider_sync_truncated` when a page cap cut the window short.
  - `anthropic_compliance` (`syncAnthropicCompliance`, `src/lib/anthropic-compliance.ts`; `PROVIDER_MAX_LOOKBACK_DAYS` 30) reads the Anthropic Compliance Activity Feed newest-first with `created_at.gte = window.from` / `created_at.lt = window.to`, and resumes a page-capped first pull from the `after_id` cursor kept in `ProviderSyncWatermark.cursor` (the only column `finishSyncRun` leaves alone) down to the lookback floor. Rows are upserted into `ComplianceActivity` (provider `anthropic`, sharing the table with the ChatGPT Enterprise feed) by upstream id; only ids new to the table go through `evaluateComplianceAlerts` (unknown-actor / off-hours key creation, Compliance API access from a new `api_key_id`, login from a new country) and create `Alert(source="anthropic_compliance")` rows. A resumable truncation (the first pull, or a draining backfill) is reported in the run metadata and result without the `provider_sync_truncated` alert; a capped incremental pull raises it. With a Compliance Access Key, `/v1/compliance/apps/sessions/{local,remote}` metadata is upserted into `ComplianceSession`; transcripts are never requested and content-shaped fields are stripped before storage.
  - `claude_enterprise` (`syncClaudeEnterpriseAnalytics`, `src/lib/claude-enterprise-analytics.ts`; `PROVIDER_MAX_LOOKBACK_DAYS` 31, the Analytics API's range cap) walks each UTC day of the window up to yesterday (today's numbers are not final) and pulls `/v1/organizations/analytics/users?date=` per day, `/summaries` (→ `UsageBucket` rows with `dimensionKey "org_summary|date=…"`), and the per-user `user_usage_report` / `user_cost_report` (→ `UsageBucket` / `CostBucket` per day × email × product × model, `amount` fractional cents → USD). `mergeEnterpriseDailyStats` folds tokens and cost into one `AssistantDailyStat` row per person × day × product (`product` column; the unique key is `(provider, day, actorExternalId, product)`, empty product for single-surface providers). A day whose per-user activity pull failed clamps the window `finishSyncRun` records, so the watermark stops before it and the next run retries. Rate-limited to 60 requests/minute.
- `/api/cron/discovery-scan/[source]` — `runScheduledDiscoveryScan()` for `google_workspace`, `microsoft_365`, `hexnode`, `crowdstrike`, and `agent_platforms` (agent inventory imports → `DiscoveredAgent`, see *Agent Discovery Architecture*), `maxDuration = 300`. Each source first fails its own scans stuck in `running` for 10+ minutes, then scans if enabled, configured, idle, and past its interval.
- `/api/cron/governance-automation` — `runGovernanceAutomationJob()`: review renewals, exception renewals, ownership escalations, and the **usage-after-deactivation** check (`evaluateUsageAfterDeactivation()` in `governance-automation.ts`, pure): deactivated `DirectoryPerson` rows from the last 180 days are matched — by primary email or alias — against the latest `UsageBucket`, `AssistantDailyStat`, and `APIUsageLog` activity, and a `HIGH` alert with source `usage_after_deactivation` is raised when activity postdates `deactivatedAt`, deduped per person per 7 days. A telemetry read failure in this check is logged and reported as 0 rather than failing the other alert families.
- `/api/cron/key-usage-rules` — `runKeyUsageRulesJob()`: never throws; a failed evaluation returns `ok: false` with a 207 so one bad rule shows up in the cron log without a 500.
- `/api/cron/endpoint-agent-sweep` — `markStaleDevices()` in `src/lib/endpoint-agent.ts`: flips `ACTIVE` devices with no accepted report inside `ENDPOINT_STALE_AFTER_MS` (6 h) to `STALE`. This exists because the failure it catches is the dangerous one — a fleet of dead agents makes the console read as "no AI activity" rather than "no data". Stale is not revoked: the token still works and the device flips back on its next report.
- `/api/cron/agent-discovery` — `runProxyAgentDetection()` in `src/lib/proxy-agent-detection.ts`. Two grouped SQL queries over the last 7 days: `APIUsageLog` rows with no `metadata.agentId`, grouped by `(provider, metadata.client.keyHash, userId, aiSystemId)` with the modal `client.framework`, and `AgentToolCall` rows joined on `requestId` under the same key. `scoreCaller()` (pure, unit-tested) applies the signal weights and exclusions; callers at 40+ are upserted as `DiscoveredAgent(source="proxy_traffic")` with `externalId` = sha256 of the group key. Reports `ok: false` with a 207 rather than a 500. The capture half is `fingerprintCaller()` in `src/lib/caller-fingerprint.ts` (mirrored to `ai-proxy/src/lib/caller-fingerprint.ts`, enforced by `check:mirror-drift`), called from `resolveProxyAttribution()` (Vercel) and `resolveAttribution()` (Azure) and written as `metadata.client = { framework, kind, sdk, userAgent (≤160 chars), keyHash }`. `keyHash` is `HMAC-SHA256(prompt-hash salt, "caller-key:" + credential)` truncated to 16 hex; for SigV4 Bedrock calls only the access key id is hashed. Add a framework by appending to `CLIENT_PATTERNS` (first match wins) in both copies.

Splitting the work this way is what makes the acceptance criteria hold: a provider that hangs burns only its own budget, and a healthy provider's success no longer resets the clock for a stalled one. `runProviderSyncJob()` (the manual **Sync now** button) still fans out to every provider at once via the same `runProviderSync()` unit.

**Dedicated crons**, each on its own schedule:

- `/api/cron/directory-sync/[source]` — daily (`10 4 * * *` for `google_workspace`, `20 4 * * *` for `microsoft_365`), `maxDuration = 300`. `runScheduledDirectorySync()` fails that source's runs stuck in `RUNNING` for 30+ minutes, then calls `runDirectorySync()` when `directory_sync_<source>_enabled` is `true` (default **false**), the source's Shadow AI credentials are configured, no run is in flight, and `directory_sync_<source>_interval_hours` (default 24) has elapsed since the last `SUCCEEDED` directory run. Due-ness logic is `resolveDirectorySyncSchedule()` in `provider-sync-schedule.ts`. The manual `POST /api/directory-sync { source }` (`ADMIN`) runs one source immediately regardless of the flag. A full sync upserts every returned person, then deactivates unseen rows for that source — only when at least one page succeeded and the 100-page cap was not hit — and suspends any `ACTIVE` `User` whose directory account just went inactive, writing a `SUSPEND` audit entry attributed to the triggering admin (or the oldest `ADMIN` for the cron).
- `/api/cron/run-report-schedules` — every 15 minutes
- `/api/cron/proxy-health` — every 15 minutes; calls `runProxyHealthSync` in `src/lib/proxy-health-sync.ts` (shared with the manual `POST /api/proxy-health/sync`) with the `system` actor, and skips when Azure Monitor is unconfigured
- `/api/cron/sensitive-scan` — daily
- `/api/cron/provider-security-scan` — daily
- `/api/cron/prune-claude-code-metrics` — daily
- `/api/cron/prune-cursor-metrics` — daily

The two prune jobs exist because the OTel surfaces are high-volume; if you add another telemetry surface, add a retention job with it rather than letting the table grow unbounded.

**Deprecated:** `GET /api/scheduler/maintenance` is kept for one release as a shim. `runScheduledMaintenance()` composes the per-job functions above inside a single 60-second function, logs a deprecation warning, and returns `Deprecation: true`. It is no longer in `vercel.json`; delete it (and `runScheduledMaintenance`) after the next release.

## Settings Strategy

Settings are split by responsibility:

- `Settings > General`
  AI provider and model defaults for in-app AI features, plus the global proxy policy enforcement mode (`off` / `dryrun` / `enforce`).
- `Settings > Provider Admin APIs`
  OpenAI, Anthropic, Gemini billing, and gateway integrations, with anomaly and attribution tuning.
- `Settings > Proxy Setup`
  Proxy secret, generated client config, and attribution headers.
- `Settings > Users & Identity`
  Authentication providers, user-management options, and the per-source **Directory sync** cards (`directory_sync_<source>_enabled`, `directory_sync_<source>_interval_hours`, `directory_sync_include_guests`; env fallbacks are the upper-cased key names). Directory sync deliberately reuses the Shadow AI credentials rather than storing a second copy.
- `Settings > Shadow AI`
  Discovery configuration for every scan source and log import, plus the blocklist feed token and the enforcement readiness summary. The **Agent Platforms** card holds `AGENT_PLATFORM_SETTINGS_KEYS` (`agent_platforms_scan_enabled` / `_interval_hours`, `anthropic_managed_agents_api_key`, `microsoft_copilot_agents_enabled`, `salesforce_instance_url` / `_client_id` / `_client_secret`); the Microsoft import reuses the Microsoft 365 Shadow AI credentials.
- `Settings > Reporting`
  Email delivery for scheduled reports.

Secret values are stored in `AppSetting` and encrypted with `SETTINGS_ENCRYPTION_KEY`. `getSetting()` falls back to the matching environment variable when no database value is present, so UI values always win over env. Do not rotate `SETTINGS_ENCRYPTION_KEY` after data has been written — previously encrypted settings become unreadable.

`prompt_hash_salt` is the one deliberate exception to encryption: the Azure proxy must read it with a plain Prisma client so every surface hashes prompts with the same salt (see Prompt hash correlation). Rotating it changes every future hash, so historical correlation stops at the rotation.

The `Integrations` page reads the same settings data but is deliberately catalog-only. Add configuration UI under `Settings`, then let the tile reflect it.

## Reports Architecture

Reports are definition-driven rather than hand-coded per report:

- `src/lib/reports/data-sources.ts` — the nine sources and their typed, filterable columns. This is the file to touch when exposing new data to reporting. A source is either **model-backed** (`model` = a Prisma delegate; Prisma does the filtering/grouping) or **computed** (`loader` = an async function returning flat rows for the date range; `src/lib/reports/in-memory.ts` filters, sorts, and groups them). `PEOPLE_USAGE` is the computed example — its loader is `loadPeopleUsageReportRows()` in `src/lib/people-usage.ts`.
- `src/lib/reports/query.ts` and `generate.ts` — turn a stored definition into rows, then into an artifact.
- `src/lib/reports/export/` — `pdf.tsx`, `csv.ts`, `json.ts`.
- `src/lib/reports/schedule.ts` and `email.ts` — recurrence and delivery.
- `src/lib/reports/access.ts` — `PRIVATE` / `SHARED` visibility and the author-role checks.

Adding a column to an existing source is a `data-sources.ts` change only; the builder, preview, filters, and every export format pick it up automatically. Adding a new source also needs a value on the `ReportDataSource` Prisma enum (migration), `ReportDataSourceKey` in `types.ts`, and `DATA_SOURCE_VALUES` in `validations/report.ts`. Run artifacts above `MAX_STORED_ARTIFACT_BYTES` (5 MB) are still streamed to the requester but not persisted to run history.

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
- Change to what is hashed or how prompts are normalized:
  Edit `src/lib/prompt-hash.ts`, copy it over `ai-proxy/src/lib/prompt-hash.ts` (byte-identical mirror), extend `prompt-hash.test.ts`, and redeploy the Azure proxy in the same release — a surface on the old rule produces hashes that never match.
- New report column or data source:
  Start in `src/lib/reports/data-sources.ts`.
- New help page:
  Add `docs/help/<key>.md`, register it in `scripts/gen-help-content.mjs`, then run `npm run help:sync`.
- New telemetry surface:
  Model the metric/event tables, add an ingest route, and add a retention prune cron alongside it.

## Planned Work

The next tier of data-collection upgrades — splitting the maintenance route into per-provider crons with per-provider sync settings, and the follow-on collection items — is scoped in [docs/plans/data-collection-tier2.md](./plans/data-collection-tier2.md). Pick items up from there one PR at a time rather than re-deriving the scope.

## Current Caveat

When you add Prisma fields, make sure you:

- update `prisma/schema.prisma`
- create a migration
- run `npx prisma generate`

Some local type errors after schema edits are just stale generated client state and disappear after regeneration.
