# Agentic governance lifecycle — closing the loop around the proxy

Source: IBM Think, "Agentic AI governance playbook" (2026). The article's
thesis is that governing agents means moving "from validating the answer to
controlling the actions", with controls embedded at runtime rather than
applied at a single review checkpoint, across a six-phase lifecycle
(plan/design → data → build → test → deploy/monitor → retire).

UrNammu already covers the article's **deploy and monitor** phase well: MCP
server and tool allowlists in monitor/enforce mode, dry-run denials,
never-seen-tool alerts, proxy-side agent detection, the Discovered Agents
queue, platform imports, and the heuristic + AI risk review. What is missing
is the rest of the lifecycle around that runtime control. This plan lists the
gaps in the article's order and the PRs that close them.

Status legend: ☐ not started · ◐ in progress · ☑ shipped.

## 1. ☑ Kill switch and runtime status gating (PR: `feat/agent-kill-switch`)

The article: "control needs to be continuous and designed"; the autonomous
agent risk template already told reviewers to "verify kill switches", but
setting an agent to RETIRED only changed a badge — both proxies loaded only
the MCP allowlist columns.

Shipped:

- `AIAgent.suspendedAt / suspendedById / suspendedReason` (migration
  `20260930120000_agent_kill_switch`).
- `src/lib/agent-runtime-gate.ts` (mirrored into `ai-proxy/src/lib/`, guarded
  by `check-mirror-drift.mjs`): pure verdict. Suspended → blocked
  (`agent_suspended`); `status === "RETIRED"` → blocked (`agent_retired`);
  every other status forwards, including DRAFT (agents registered from the
  discovery queue start there and must be able to send `x-agent-id`) and
  DEPRECATED (still running while phased out).
- Both proxies evaluate the verdict right after attribution, for every
  provider path (Anthropic, OpenAI, Azure OpenAI, Gemini, Bedrock). A blocked
  request gets `403 { error: { type: "agent_blocked", violations[] } }` and an
  enforced `PolicyDenial` row, visible under Compliance → Denials. The gate
  ignores `mcpEnforcement`. The Azure loader caches agent state for 30 s, so
  a suspension takes effect within that window there; the Vercel proxy reads
  per request.
- `POST / DELETE /api/agents/[id]/suspend` (ADMIN, COMPLIANCE_OFFICER), audit
  actions `SUSPEND` / `RESUME`, and a Suspend / Resume control plus a
  "traffic blocked" banner on the agent detail page; a SUSPENDED badge on the
  registry cards.

Not in scope here: alerts when a suspended agent keeps calling (the denial
rows already show it), and blocking traffic that carries no `x-agent-id`
(that is the discovery problem, handled by `docs/plans/agent-discovery.md`).

## 2. ☑ Agent charter and approval gate (PR: `feat/agent-charter-approval`)

The article: define purpose, scope, decision boundaries, access limits, risk
classification, ownership and approval workflow *before* development, or
"later controls will just react to problems instead of preventing them".

Today an agent has a description, capabilities, an access-level string and an
autonomy level. Every governance table (`SystemApproval`, `GovernanceReview`,
`GovernanceException`, `EvidenceArtifact`, `GovernanceIncident`) keys on
`aiSystemId` only, so an agent can go DRAFT → DEPLOYED with no sign-off.

Shipped (decision: agent-scoped twin tables, not polymorphic — every existing
`aiSystem` include and the notifications feed stay non-nullable; the UI is
shared instead, via an `endpoint` prop on the two reviewer cards):

- Charter on `AIAgent`: `purpose`, `inScopeActions[]`, `outOfScopeActions[]`,
  `decisionBoundaries`, `successCriteria`; `require*Approval` ×4,
  `reviewIntervalDays`, `nextReviewDate`. `AgentApproval`,
  `AgentGovernanceReview` (migration `20260930150000_agent_charter_approval`).
- `src/lib/agent-governance.ts`: charter status, blockers (hard/soft),
  workflow summary, checklist. Hard: charter incomplete, suspended,
  FULL_AUTONOMY without enforce+allowlist, HIGH/CRITICAL with no risk basis
  (parent assessment or agent risk review), missing stage review, no/overdue
  review date. Soft: optional charter fields, SUPERVISED without enforcement,
  human-review contradictions, unapproved observed tools, no parent system.
- `POST /api/agents/[id]/approval` (refuses APPROVED on hard blockers;
  approval restarts the review clock), `POST /api/agents/[id]/governance-review`,
  and the `PUT` gate: no transition into APPROVED/DEPLOYED without an approval.
- Detail page: checklist, workflow card, charter card, approval + stage
  review cards. Form: charter and approval-requirement sections.

Deferred to item 4: evidence artifacts for agents and the notifications feed.

## 3. ☐ Structured human-review triggers enforced at the proxy (authority)

The article's central claim: "authority limits enforced technically".
`humanReviewTriggers` is free-text JSON that feeds the AI review and the
detail page; nothing evaluates it at runtime.

Proposed:

- Structured trigger grammar: `{ tool, argumentPath, op, value }`,
  `{ dataClass }`, `{ connectedSystem }`, evaluated against `tool_use` /
  `mcp_call` input arguments in both proxies, reusing the monitor/enforce
  pattern and the `PolicyDenial` sink from `mcp-tool-governance.ts`.
- Enforce mode for a matched trigger returns 403 with a `human_review_required`
  violation and raises a HIGH alert; monitor mode records a dry-run denial.
- Migrate existing free-text triggers to a `{ note }` entry so nothing is lost.

## 4. ☐ Ownership, escalation, incidents and retirement

The article: responsibility split across business, technology and risk roles;
"well-defined incident response protocols"; "controlled agent and
infrastructure shutdown … secure disposal … documentation".

Proposed:

- `technicalOwnerId`, `riskOwnerId`, `escalationContact` on `AIAgent`.
- `GovernanceIncident.agentId` so an incident can reference an agent and
  offer the Suspend action from item 1 in one click.
- Extend `workflow-notifications.ts` (system-only today) to agent approvals,
  overdue reviews and incidents.
- Retirement checklist (reusing `ChecklistItem`): proxy gate confirmed
  (item 1), API key profiles revoked, removed from other agents' allowlists,
  tool profiles archived, data disposal attested, final audit export.

## 5. ☐ Behavioural baselines and a shared approved-tool catalog

The article: "abnormal pattern identification"; "find and reuse … approved
agents and tools".

Proposed:

- Per-agent baseline from `AgentToolCall` and `APIUsageLog` (volume, model
  set, hours of activity, denial rate) with drift alerts; new-tool alerts
  already exist.
- Org-level approved MCP server/tool catalog in `mcp-server-registry.ts` that
  agents inherit, with per-agent narrowing.

## 6. ☐ Agent governance posture card

The article's six governance-by-design dimensions — ownership, authority,
decision making, control, boundaries, responsibilities — scored per agent from
the fields above, on the detail page and rolled up into the executive view.
Depends on 2–4.

## Testing and validation (not building)

The article's phase 4 (evaluation under adversarial conditions) is evidence
UrNammu should demand, not a harness it should build: allow `EvidenceArtifact`
on agents with categories for evaluation results, red-team results and
boundary verification, and make them approval blockers for HIGH/CRITICAL or
FULL_AUTONOMY agents (folds into item 2). External evaluators produce the
artifacts.
