# Data collection upgrades — Tier 3 (new coverage)

Status: **in progress** (started 2026-09-16). Tier 1 (#107) and Tier 2
(#108–#113) are merged. Tier 3 adds sources that do not exist yet rather than
fixing ones that do. Each item is its own PR. Items marked *schema* add a
migration that must be applied to production by hand after merge
(`npx prisma migrate deploy`); the Azure proxy must be redeployed for 3.7.

| # | Item | Schema | Needs from the user |
|---|---|---|---|
| 3.1 | Tools registry: 120+ tools, categories, fuzzy matching | yes (category column) | nothing |
| 3.2 | Prompt hash for cross-surface correlation | no | nothing |
| 3.3 | Directory sync (Google Directory + Microsoft Graph users) | yes | Google scope `admin.directory.user.readonly`; Graph `User.Read.All` |
| 3.4 | Anthropic Compliance API + Claude Enterprise Analytics ingest | yes | Compliance Access Key and/or Analytics API key |
| 3.5 | GitHub Copilot usage metrics | yes | GitHub token with `read:org` / `manage_billing:copilot` |
| 3.6 | ChatGPT Enterprise Compliance API ingest | yes | ChatGPT workspace Admin key |
| 3.7 | Proxy coverage: Gemini, Bedrock, Azure OpenAI, OpenAI Responses/Embeddings | no | redeploy `nammu-ai-proxy` |

---

## 3.1 Tools registry expansion, categories, fuzzy matching

**Problem.** `src/lib/ai-tools-registry.ts` has 25 tools and no category. Name
matching is plain case-insensitive `includes()`. Windsurf, Codex CLI, Gemini
CLI, Amazon Q, JetBrains AI, Tabnine, Cody, Devin, Lovable, Replit Agent,
Suno, Pika, Fireflies, Read AI, Gamma, Tome, DeepSeek, Kimi, Qwen, Le Chat,
Character.ai and dozens more are absent, so DNS/OAuth signals for them fall to
the low-confidence heuristic or are missed.

**Change.**
- Add `category: AIToolCategory` to `KnownAITool` with a closed set:
  `chat_assistant`, `coding_assistant`, `agent_platform`, `image_generation`,
  `video_generation`, `audio_voice`, `writing`, `meeting_notes`, `search`,
  `ml_platform`, `data_analysis`, `productivity`, `translation`,
  `customer_support`, `browser_extension`, `other`. Add `riskHints?: string[]`
  (e.g. `trains_on_data`, `consumer_grade`, `china_hosted`) for later scoring.
- Grow the registry to 120+ entries. Domains must be bare hostnames that appear
  in DNS/proxy logs (API hosts, CDN hosts, auth hosts), not marketing URLs.
- Fuzzy name matching: normalize (lowercase, strip punctuation/"ai"/"inc"),
  then token-set overlap plus Damerau-Levenshtein ≤ 1 for tokens ≥ 5 chars.
  Fuzzy hits score +4 (below exact-name +6). Add a `matchReasons` entry
  `fuzzy_name:<token>`.
- Schema: `DiscoveredAITool.category String?` set from the registry on match
  and editable in the UI; `@@index([category])`. Backfill existing rows in
  the migration via a one-shot script (`scripts/backfill-tool-categories.ts`).
- UI: category badge + filter on Shadow AI; category rollup in the summary.
- Tests: every registry entry has ≥1 domain and a category; no domain contains
  `/`; fuzzy cases (`Chat GPT`, `Perplexty`, `mid journey`) match; negatives
  (`google`, `microsoft`) do not.

**Files.** `src/lib/ai-tools-registry.ts` (+test), `src/lib/scan-executor.ts`,
`src/lib/discovered-tools-ingest.ts`, schema + migration, Shadow AI UI, docs.

## 3.2 Prompt hash for cross-surface correlation

**Problem.** Dangerous-prompt detection stores a sanitized ≤220-char excerpt
only. The same risky prompt sent through the proxy, Claude Code, and Cursor
produces three unrelated alerts, and repeat offenders cannot be counted.

**Change.**
- `promptHash` = first 32 hex of sha256 over the normalized prompt (trim,
  collapse whitespace, lowercase). Computed in `analyzePromptRisk`
  (`src/lib/prompt-risk.ts`) and returned on the analysis object. Never store
  the prompt; the hash is one-way and salted with `PROMPT_HASH_SALT`
  (setting, default = `NEXTAUTH_SECRET`) so it cannot be brute-forced from a
  dictionary of common prompts.
- Persist it in: `APIUsageLog.promptMetadata.promptRisk.promptHash`,
  `Alert.metadata.promptHash` for `dangerous_prompt` alerts,
  `ClaudeCodeEvent.attributes["prompt.hash"]`, `CursorSpan.attributes["prompt.hash"]`.
  Mirror the change to `ai-proxy/src/lib/sensitive-detect.ts`.
- Alert dedupe: when a new dangerous-prompt alert has the same hash as an open
  one within 24h, increment `metadata.occurrences` and append the surface
  instead of creating a second alert.
- UI: on the dangerous-prompt alert detail show "Seen N times across
  {surfaces}" and list the other alerts with the same hash.
- Tests: same prompt with different whitespace/case → same hash; different
  salt → different hash; dedupe increments.

**Files.** `src/lib/prompt-risk.ts` (+test), `ai-proxy/src/lib/sensitive-detect.ts`,
`src/app/api/telemetry/*/route.ts`, `src/app/(dashboard)/alerts/dangerous-prompt-detail.tsx`, docs.

## 3.3 Directory sync

**Problem.** There is no identity-provider sync. `User.department` is typed by
hand, offboarding does nothing upstream, people-usage has no alias support, and
Shadow AI user emails cannot be rolled up by department.

**Change.**
- Schema:
  ```prisma
  model DirectoryPerson {
    id            String   @id @default(cuid())
    source        String   // google_workspace | microsoft_365
    externalId    String
    primaryEmail  String
    aliases       String[] @default([])
    displayName   String?
    department    String?
    title         String?
    managerEmail  String?
    orgUnit       String?
    active        Boolean  @default(true)
    deactivatedAt DateTime?
    lastSyncedAt  DateTime
    raw           Json?
    @@unique([source, externalId])
    @@index([primaryEmail])
    @@index([department])
    @@index([active])
  }
  ```
- `src/lib/directory-sync.ts`: Google Directory `users.list` (scope
  `https://www.googleapis.com/auth/admin.directory.user.readonly`, reuse the
  Shadow AI service account + admin email), Microsoft Graph `/users?$select=
  id,mail,userPrincipalName,displayName,department,jobTitle,accountEnabled,
  proxyAddresses&$expand=manager($select=mail)` (`User.Read.All`). Full sync
  per run (page through all users), mark missing users `active=false` with
  `deactivatedAt`.
- Cron `/api/cron/directory-sync/[source]` daily, settings
  `directory_sync_<source>_enabled` / `_interval_hours`, last-run card on
  Settings → Users & Identity, manual "Sync now".
- People-usage (`src/lib/people-usage.ts`): resolve any observed email through
  `aliases` → `primaryEmail` before merging; enrich `department`/`name` from
  the directory before falling back to `User`/`ProviderActor`.
- Shadow AI: department rollup for `DiscoveredAITool.userEmails` via directory.
- Governance signal: alert `usage_after_deactivation` when any usage surface
  records activity for a person whose directory record is inactive (checked
  in the existing key-usage-rules/governance cron).
- Offboarding: when a directory person goes inactive and a platform `User`
  with the same email is ACTIVE, set `SUSPENDED` and audit-log it.

**Files.** schema + migration, new lib + cron route + tests, `vercel.json`,
`src/lib/settings.ts`, `src/lib/people-usage.ts` (+test), Settings UI, docs
(install guide: new Google scope for domain-wide delegation).

## 3.4 Anthropic Compliance API + Claude Enterprise Analytics

**Problem.** The Anthropic Compliance API Activity Feed was enabled on
2026-08-25 but nothing ingests it. The Claude Enterprise Analytics API gives
per-user daily activity across chat, Claude Code, Cowork, Design, and Office
plus per-user cost, none of which UrNammu reads.

**Reference (verified 2026-09-16).**
- Activity Feed: `GET https://api.anthropic.com/v1/compliance/activities`,
  headers `x-api-key`, `anthropic-version: 2023-06-01`. Works with an Admin API
  key (`sk-ant-admin01-…`, feed only) or a Compliance Access Key
  (`sk-ant-api01-…`, scope `read:compliance_activities`). Newest first, cursor
  `after_id` = previous `last_id`, `has_more`, `limit` ≤ 5000, filters
  `activity_types[]`, `actor_ids[]`, `created_at.gte/.lt`. Actor union:
  `user_actor {email_address,user_id,ip_address,user_agent}`, `api_actor
  {api_key_id,ip_address}`, `admin_api_key_actor`, `unauthenticated_user_actor`,
  `scim_directory_sync_actor`. Retained 6 years; not backfilled before
  enablement.
- Sessions (Enterprise only, `read:compliance_user_data`):
  `GET /v1/compliance/apps/sessions/local` (Cowork, Claude Code, Science,
  Office add-ins; `product_surface`, `user.email_address`, `workspace_id`,
  `created_at/updated_at`, filter `updated_at.gte`, `page/next_page`), and
  `/remote` for cloud Cowork. Metadata only is enough for governance; do not
  pull transcripts.
- Enterprise Analytics (Analytics API key, scope `read:analytics`):
  `GET /v1/organizations/analytics/users?date=YYYY-MM-DD` (per-user
  `chat_metrics`, `claude_code_metrics`, `cowork_metrics`, `design_metrics`,
  `office_metrics`, `web_search_count`, `last_activity_date`),
  `/summaries?starting_date=` (DAU/WAU/MAU, seats, pending invites),
  `/user_usage_report` and `/user_cost_report` (`starting_at`, actor
  `{user_id,email,name,deleted}`, tokens incl. cache, `amount` in fractional
  cents, `product`, `model`; cursor `page/next_page`). Data lags ~1 day; cost
  revised up to 30 days. Rate limit 60 rpm per org.

**Change.**
- Settings: `anthropic_compliance_key` (either key type), `anthropic_analytics_key`.
- Schema: `ComplianceActivity { id (upstream id) @id, provider, type,
  occurredAt, organizationId, actorType, actorEmail, actorUserId, actorApiKeyId,
  ipAddress, userAgent, payload Json, ingestedAt }` with
  `@@index([occurredAt])`, `@@index([actorEmail, occurredAt])`, `@@index([type, occurredAt])`;
  `ComplianceSession { id @id, provider, productSurface, userEmail, userExternalId,
  workspaceId, startedAt, lastActivityAt, status, raw Json }`.
- New sync providers `anthropic_compliance` (feed + session metadata, cursor
  stored in `ProviderSyncWatermark`) and `claude_enterprise` (analytics →
  `AssistantDailyStat` rows with `provider="claude_enterprise"` per product,
  `UsageBucket`/`CostBucket` from the user reports with `actorExternalId` =
  email). Add both to `SYNC_PROVIDERS`, `vercel.json`, Integrations tiles.
- Governance use: API-key lifecycle events → `ApiKeyProfile` updates and
  alerts on `api_key_created` outside business hours or by unknown actors;
  login events → identity signal; `compliance_api_accessed` from unknown
  `api_key_id` → alert. Session metadata → Cowork/Claude Code adoption per
  person without OTel, filling the gap for machines the MDM profile missed.
- Oversight: Claude Platform dashboard gains an Enterprise tab (DAU/WAU/MAU,
  seats, per-product active users); people-usage gets `claude_enterprise`
  surfaces.

## 3.5 GitHub Copilot usage metrics

**Reference (verified 2026-09-16).** Report-based API, header
`X-GitHub-Api-Version: 2026-03-10`:
`GET /orgs/{org}/copilot/metrics/reports/organization-1-day?day=YYYY-MM-DD`,
`…/users-1-day`, `…/users-28-day/latest`, `…/repos-1-day`, plus the same
under `/enterprises/{enterprise}/…`. Response is `{download_links: [signed
URLs], report_day}`; each link is an NDJSON file. Token needs `read:org`
(org) or `manage_billing:copilot` / `read:enterprise` (enterprise). Data from
2025-10-10, kept one year, lands within two days. **The NDJSON field list is
not in the docs pages fetched so far; the implementer must download one
report and derive the schema, then pin it in a Zod validator.** Also read the
older `GET /orgs/{org}/copilot/billing/seats` for seat assignment and
`last_activity_at` per user (90-day retention) as the identity join.

**Change.** Settings `github_copilot_token`, `github_copilot_org`,
`github_copilot_enterprise`. Sync provider `github_copilot`: per day pull
`users-1-day` → `AssistantDailyStat(provider="github_copilot")` per user
(login → email via the seats endpoint's `assignee.email` when present,
otherwise store login and let directory sync (3.3) resolve it), and
`organization-1-day` → org totals in `UsageBucket` metadata. Tools registry
gains the Copilot hostnames already present. Cursor/Claude Code dashboards
get a Copilot sibling; people-usage adds the `github_copilot` surface.

## 3.6 ChatGPT Enterprise Compliance API

**Reference.** Now the OpenAI Compliance Logs Platform: workspace-scoped Admin
key created by a workspace owner; resources users, conversations (metadata),
GPTs, projects, memories, plus time-windowed JSONL logs (admin audit, user
authentication, Codex usage). Authoritative routes and schemas live at
`https://chatgpt.com/public/admin/api-reference` (SPA; fetch its OpenAPI JSON
or read it in the browser). Enterprise and Edu workspaces.

**Change.** Settings `chatgpt_enterprise_admin_key`, `chatgpt_workspace_id`.
Sync provider `chatgpt_enterprise`: users → `ProviderActor` (email, role,
status, created); conversations metadata (no content) → per-user daily
message counts into `AssistantDailyStat(provider="chatgpt")`; auth log and
admin audit → `ComplianceActivity(provider="openai")` (reuse 3.4's table).
Codex usage log → `AssistantDailyStat(provider="codex")`. Registry entry for
ChatGPT already exists; add `chatgpt.com` hosts. Alerts: workspace admin role
granted, user added outside directory (3.3), GPT with actions created.

## 3.7 Proxy coverage

**Problem.** The governance proxy handles Anthropic Messages and OpenAI chat
completions only. Gemini, Bedrock, Azure OpenAI, OpenAI Responses, Embeddings,
Images, and Batch bypass policy enforcement and telemetry.

**Change.**
- OpenAI: make the Vercel and Azure OpenAI proxies path-based
  (`/proxy/openai/{*path}`), forwarding any `/v1/*` path; parse usage for
  `chat/completions`, `responses` (`usage.input_tokens/output_tokens/
  input_tokens_details.cached_tokens`), `embeddings` (`usage.prompt_tokens`),
  and record 0-token pass-through rows for the rest with `endpoint` in
  metadata. Streaming for Responses uses `response.completed` event usage.
- Azure OpenAI: same parser, different base (`https://{resource}.openai.azure.com/openai/deployments/{deployment}/…?api-version=`),
  `api-key` header, deployment→model mapping via setting `azure_openai_deployments` (JSON).
- Gemini: `POST /v1beta/models/{model}:generateContent` and
  `:streamGenerateContent`, usage in `usageMetadata.promptTokenCount /
  candidatesTokenCount / cachedContentTokenCount`; header `x-goog-api-key`.
- Bedrock: Messages-API Mantle endpoint (`/model/{modelId}/invoke` and
  `/invoke-with-response-stream`); SigV4 signing with a proxy-held role is a
  separate decision, so v1 accepts client-signed requests and only logs
  (no key injection). Model ids normalized by `normalizeModelId` (already
  strips `us.anthropic.`).
- Pricing table gains Gemini and Azure OpenAI ids. Policy-as-code and MCP
  governance apply uniformly. Mirror files stay byte-identical.
- Docs: proxy setup guide per provider; Azure redeploy.

---

## Sequencing

| Order | Item | Why first |
|---|---|---|
| 1 | 3.1 registry, 3.2 prompt hash, 3.3 directory sync | no external unknowns; 3.3 unblocks identity joins for 3.4–3.6 |
| 2 | 3.4 Anthropic compliance + Enterprise analytics | API verified; feed already enabled in prod |
| 3 | 3.5 Copilot, 3.6 ChatGPT Enterprise | need schema discovery against live APIs |
| 4 | 3.7 proxy coverage | largest; needs Azure redeploy and client cut-over |
