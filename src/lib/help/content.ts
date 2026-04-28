/**
 * In-app help content. Mirrors the canonical authoring source under
 * `docs/help/*.md` so contributors can edit either place — the markdown files
 * are the source of truth, this map is the runtime bundle.
 *
 * When you change a docs/help/*.md file, also update the matching string here.
 */

export type HelpKey =
  | "dashboard"
  | "registry"
  | "registry-detail"
  | "agents"
  | "risk-center"
  | "compliance"
  | "shadow-ai"
  | "oversight"
  | "alerts"
  | "settings";

export const HELP_TITLES: Record<HelpKey, string> = {
  dashboard: "Dashboard",
  registry: "AI System Registry",
  "registry-detail": "System Detail",
  agents: "AI Agents",
  "risk-center": "Risk Center",
  compliance: "Compliance",
  "shadow-ai": "Shadow AI Discovery",
  oversight: "Oversight",
  alerts: "Alerts",
  settings: "Settings",
};

export const HELP_CONTENT: Record<HelpKey, string> = {
  dashboard: `# Dashboard (Command Center)

The dashboard is your daily home screen for governance. Use it to triage open work across every system, agent, and alert.

## What you're looking at

- **Stat cards** — total systems, agents, high-risk systems, open alerts, shadow AI discoveries, and compliance rate. Each card is **clickable** and navigates to the relevant module page (Registry, Agents, Risk Center, Alerts, Shadow AI, or Compliance).
- **Executive posture chart** — rolling 12-month trend of approved systems vs. ungoverned discoveries.
- **Governance queue** — next-best actions pulled from every system in the registry (systems without assessments, pending approvals, expiring exceptions).
- **Segment risk heat maps** — risk breakdowns by department, vendor, and data sensitivity.
- **Remediation status** — clickable summary cards for open alerts, investigations, compliance issues, risk issues, renewal alerts, and ownership escalations. Each routes to the relevant page.
- **Automated governance recommendations** — AI-generated next-best-action suggestions per system, linked to the registry.

## Where to start

- **Admins**: check **Settings → Provider Admin APIs** and **Settings → Shadow AI** first so telemetry and discovery are flowing.
- **Compliance officers**: work the governance queue top-down and triage open alerts.
- **Viewers**: browse the Registry and Risk Center to read the current state.

## Tips

- Click any stat card or remediation card to drill into that module.
- The **Needs Review** count only includes high-confidence \`DISCOVERED\` shadow-AI tools — low-confidence candidates have their own review queue.
- The **Executive posture chart** reflects overall compliance + risk + approval health; drift shows up here first.
`,

  registry: `# AI System Registry

The registry is your central inventory of every managed AI system.

## Key actions

- **Register AI System** — opens the registration form. Fill owner, department, vendor, data sensitivity, review interval, and required approval stages.
- **Search & filter** — filter by name, department, vendor, risk level, and status.
- **Bulk actions** — archive or permanently delete (with typed-name confirmation).

## Lifecycle

A system moves through: \`DRAFT\` → \`UNDER_REVIEW\` → \`APPROVED\` → \`DEPLOYED\` → \`DEPRECATED\` → \`RETIRED\`. Status is updated automatically as governance reviews complete, or manually on the Edit page.

## Data sensitivity levels

- \`PUBLIC\` — non-sensitive public data.
- \`INTERNAL\` — employee-only operational data.
- \`CONFIDENTIAL\` — sensitive business data; restrict vendor data flows.
- \`RESTRICTED\` — regulated / high-sensitivity data. Exposure alerts will fire on telemetry.

## Approval stages

Toggle which stages must sign off before a system can move to \`APPROVED\`:

- **Owner** — the accountable product / business owner.
- **Security** — security team review.
- **Legal** — contract and regulatory review.
- **Compliance** — final compliance officer sign-off.

Leaving a stage off is appropriate for low-risk systems (e.g. internal copilots). High-sensitivity systems should require all four.
`,

  "registry-detail": `# System Detail

This page is the governance hub for a single AI system. Every tab represents a different dimension of governance.

## Tabs

- **Info** — registered metadata.
- **Linked Agents** — agents pointing to this system with autonomy badges.
- **Risk Assessment** — scores, history, and open risk issues. Create a new assessment from here.
- **Compliance** — assigned policies, compliance status, evidence text, and compliance issues. The *AI Assess* button runs automated gap analysis.
- **Approval & Governance** — staged review history, governance exceptions, and evidence artifacts. The **Approval Review** card lists exactly what is blocking approval.
- **Telemetry & Cost** — usage buckets linked to this system over the last 30 days.
- **Incidents & Alerts** — governance incidents and related alerts.

## Approval readiness

Final approval is gated by:

- A risk assessment on file.
- At least one assigned policy.
- Every policy out of \`NOT_ASSESSED\` and \`NON_COMPLIANT\`.
- No blocking policy-rule violations.
- Every required stage approved.
- A valid next-review date in the future.

The Approval Review card will spell out each unmet condition with a deep link to resolve it.

## Compliance evidence

Evidence has two surfaces and both matter at approval time:

- **Assignment evidence** — the free-text field inside the Compliance status editor; explains *why* the status is what it is.
- **Evidence Artifacts** — structured records on the Approval & Governance tab (title, category, link, notes).

Good assignment evidence references specific controls (vendor SOC 2, DPIA on file, bias evaluation) rather than restating the policy.
`,

  agents: `# AI Agents

Agents represent autonomous (or semi-autonomous) behavior layered on top of a system.

## When to register an agent vs. a system

- Register a **system** for the AI capability (e.g. "Claude-based support assistant").
- Register an **agent** when that capability runs autonomously with defined tools, triggers, or human-review rules. Agents link back to a parent system via **Connected Systems**.

## Autonomy levels

- \`FULL_AUTONOMY\` — agent acts with no human in the loop. Highest scrutiny.
- \`SUPERVISED\` — agent acts, but a human monitors and can intervene.
- \`HUMAN_IN_THE_LOOP\` — agent proposes; a human approves every action.
- \`HUMAN_ON_THE_LOOP\` — agent acts by default; a human may override during or after.
- \`MANUAL\` — human takes every action; the agent only assists.

## Human review triggers

JSON list of conditions that force a human step — e.g. "dollar amount > $1000", "contains PII", "new vendor". Feeds the AI risk review and shows on the agent detail page.

## AI-assisted risk review

On the agent detail page, **Run Risk Review** calls the configured AI provider with the agent's capabilities, autonomy, triggers, and connected systems, and returns a recommended risk tier, written summary, concerns, and recommendations. The AI suggestion is a starting point — the human reviewer makes the final call.
`,

  "risk-center": `# Risk Center

Portfolio-level view of risk across every registered system.

## Reading the page

- **Risk counts** — systems grouped by \`CRITICAL\` / \`HIGH\` / \`MEDIUM\` / \`LOW\` / \`MINIMAL\`.
- **Reassessment alerts** — systems whose \`nextReviewDate\` is approaching or past.
- **Systems without assessments** — work queue for new registrations.
- **Risk heat map** — matrix of systems × dimensions, colored by score.
- **Distribution** — department and vendor breakdowns.
- **Control-gap detection** — systems flagged as high-risk but missing mitigating controls.

## The 6 risk dimensions

Each scored 0–100. Higher = more risk.

- **Bias** — fairness of outputs across groups.
- **Security** — vulnerability to attack or model misuse.
- **Privacy** — exposure of personal or restricted data.
- **Fairness** — outcome equity and disparate impact.
- **Performance** — reliability and accuracy.
- **Transparency** — explainability and traceability.

Each score requires a justification so later reviewers can re-evaluate it.

## Running an assessment

Pick a template (Copilot / Vendor SaaS / Autonomous Agent / Customer-Facing AI) → score the dimensions or click **AI Suggest** → answer branching questions → review control gaps → save. The system's overall risk level updates automatically.

## Reassessment cadence

\`reviewIntervalDays\` on each system controls how often a re-assessment is required. Alerts fire ahead of the due date; overdue reviews escalate automatically.
`,

  compliance: `# Compliance

Manage policies, assignments, and the audit trail.

## Policies

Each policy belongs to a framework — \`EU_AI_ACT\`, \`NIST_AI_RMF\`, \`ISO_42001\`, \`SOC2\`, or \`CUSTOM\` — and has two parts:

- **Content** — long-form policy text.
- **Rules (JSON)** — machine-evaluable constraints: allowed/blocked vendors, max data sensitivity, required approval stages, max review interval, minimum risk level, model name patterns.

## Enforcement

- \`ADVISORY\` — violations are flagged but do not block approval.
- \`BLOCKING\` — violations hard-block the system from moving to \`APPROVED\`.

## Assignments

A \`PolicyAssignment\` links a policy to a system with a compliance status:

- \`COMPLIANT\` — system fully meets policy requirements.
- \`PARTIALLY_COMPLIANT\` — meets some; a remediation plan is expected.
- \`NON_COMPLIANT\` — does not meet; remediate or request an exception.
- \`NOT_ASSESSED\` — has not been evaluated yet.

Approval requires every assignment to be out of \`NOT_ASSESSED\` and \`NON_COMPLIANT\`.

## AI gap analysis

**AI Assess** on an assignment calls the configured AI provider with policy rules + system metadata + existing evidence, and creates structured \`ComplianceIssue\` records (severity, title, detail, remediation).

## Audit trail

**Compliance → Audit Trail** shows every governance action. Filter by actor, action, entity type, or date. Export as JSON or CSV for external auditors.
`,

  "shadow-ai": `# Shadow AI Discovery

Detect AI tools in use in your organization that are not yet in the Registry.

## Discovery sources

- **Google Workspace** — scans OAuth activity logs for AI apps that users have connected.
- **Microsoft 365** — scans delegated app permissions against a known-AI-tools registry.
- **DNS / proxy logs** — CSV upload or JSON API ingestion of network-observed AI domains.

## Confidence scoring

Every discovered tool is assigned a match confidence based on how it was identified:

- **High** (score 10+) — strong match via domain + name or multiple signals.
- **Medium** (score 6–9) — partial match via name or publisher only.
- **Low** (score < 6) — heuristic match via AI keywords (e.g. ".ai" domain, "gpt", "copilot") but no known registry entry.

## Page sections

The page splits discoveries into three sections:

1. **Needs Review** — high-confidence matches and legacy tools. These are confirmed AI tools that need a governance decision: **Convert to Governed System**, **Register & Assess**, **Approve**, or **Block**.
2. **Low-Confidence Candidates** — medium and low-confidence matches. Each shows a confidence badge, score, and match reasons. Actions: **Promote** (move to main queue as high-confidence) or **Dismiss** (permanently suppress with a reason).
3. **Resolved** — tools that have been registered, approved, or blocked.

## Automatic suppression

Discoveries whose name (and vendor, when present) match an existing Registry system are auto-linked and suppressed. Dismissed candidates are also suppressed — the scanner checks the dismissed list before creating new records.

## Scan triggers

- **Manual**: click **Scan Google Workspace** or **Scan Microsoft 365**.
- **Automatic**: configured in Settings → Shadow AI (cron fires hourly, each provider checks its own interval).
`,

  oversight: `# Oversight

Provider-level usage, cost, anomaly, vendor, and investigation telemetry.

## How provider sync works

With an Anthropic admin key, an OpenAI admin key, and/or Google Gemini billing export configured in **Settings → Provider Admin APIs**, the maintenance cron pulls data on each provider's own interval and writes into:

- \`UsageBucket\` — tokens / requests per provider / model / project / actor / time bucket.
- \`CostBucket\` — amount and line-item cost.
- \`ProviderProject\` / \`ProviderActor\` — workspace membership discovered upstream.
- \`ProviderSyncRun\` — a record of each sync attempt.

**If a provider's admin key is not configured, that provider is skipped cleanly** — no sync-run row, no upstream call. The manual-sync panel reports this as "Skipped (not configured): …" so it is clear which providers are actually active.

## Pages

- **Overview** — totals, breakdowns, top cost drivers, anomaly findings.
- **Usage** — drill into normalized buckets; link usage to a system for attribution.
- **Vendors** — vendor profiles with contract lifecycle, security review, data residency, subprocessors, approved use cases.
- **Investigations** — follow-up queue for alerts and incidents.
- **Claude Code** — Claude Code sessions, tool accept/reject, lines added/removed.
- **Provider Posture** — side-by-side provider comparison: cost, tokens, incidents, risk tier.

## Dangerous prompt monitoring

When traffic flows through the proxy, prompts are scanned for 5 risk categories: prompt injection, secret extraction, data exfiltration, malware/phishing generation, and dangerous autonomy. Findings appear as structured alerts with matched signals, sanitized excerpts, and related usage logs. False positives can be marked with exceptions that suppress similar future alerts.

## Proxy attribution

Proxy traffic is attributed via optional headers: \`x-user-email\` (per-user cost tracking), \`x-department\` (cost center), and \`x-ai-system-id\` (link to registry). Configure these in **Settings → Proxy Setup**.

## Spend budgets

Create a budget by **provider**, **system**, or **department**. Monthly budget + warning threshold % (default 80%). Crossing the threshold raises a \`cost_anomaly\` alert.

## Anomaly detection

Thresholds live in **Settings → Provider Admin APIs**: recent vs. baseline windows, min token/cost thresholds, per-dimension sensitivity multipliers. When recent usage exceeds baseline × multiplier, a \`cost_anomaly\` or \`model_drift\` alert fires.
`,

  alerts: `# Alerts

Centralized alert inbox for governance signals.

## Lifecycle

\`OPEN\` → \`ACKNOWLEDGED\` → \`RESOLVED\` / \`DISMISSED\`

- **Acknowledge** — marks as seen / being worked.
- **Create Investigation** — opens an Investigation pre-linked to this alert.
- **Resolve** — addressed.
- **Dismiss** — not a real issue (for non-prompt-risk alerts).
- **False Positive** — for dangerous prompt alerts only. Requires a reason and optionally creates suppression exceptions.

## Alert sources

- \`policy_violation\` — a policy rule evaluated to a violation.
- \`risk_reassessment\` — a system's \`nextReviewDate\` is approaching or overdue.
- \`discovery\` — new shadow-AI tool discovered.
- \`compliance_gap\` — AI compliance analysis found a gap.
- \`incident\` — a governance incident was opened.
- \`renewal\` — vendor contract renewal is approaching.
- \`escalation\` — a review is overdue past the escalation threshold.
- \`model_drift\` — usage pattern deviates from baseline.
- \`data_exposure\` — restricted-sensitivity data observed in provider telemetry.
- \`cost_anomaly\` — spend crossed a budget or anomaly threshold.
- \`ownership_escalation\` — system has no owner assigned.
- \`dangerous_prompt\` — proxy-scanned traffic matched a risky prompt pattern.

## Dangerous prompt alerts

When traffic flows through the proxy, prompts are analyzed for jailbreak attempts, credential extraction, data exfiltration, malware generation, and unsafe autonomy patterns. These alerts show structured investigation detail:

- **Provider & model badges** — which AI provider and model were used.
- **Category badges** — which risk rules triggered, color-coded by severity.
- **Matched signals** — the exact phrases that matched, shown as code elements.
- **Sanitized excerpt** — a redacted snippet of the prompt text (full prompts are never stored).
- **Related usage logs** — expandable panel showing flagged API calls near the alert.

## False positive marking

If a dangerous prompt alert is benign (e.g. legitimate security testing), click **False Positive**:

1. Enter a reason explaining why it is a false positive.
2. Optionally check **Create exception** to suppress similar future alerts for the matched categories.
3. The alert is dismissed and tagged with a "False Positive" badge.

Manage exceptions at **Alerts → Manage prompt risk exceptions**. Exceptions can be deactivated or reactivated. The system only suppresses alert creation — usage is still logged for audit.

## Tuning the detection engine

The dangerous-prompt engine is rule-based and fully tunable at **Alerts → Tune detection rules**. Each rule has:

- A stable **key** (\`prompt_injection\`, \`secret_extraction\`, etc.) — this is the identifier referenced by exceptions, so it is **immutable** once created.
- A **label** and optional **description**.
- A **severity** — \`critical\` → CRITICAL alerts, \`warning\` → HIGH alerts.
- Up to 10 **regex patterns**, matched case-insensitively against user-authored prompt text only (assistant, tool, and system content are never scanned).

Five built-in rules are seeded on install. Built-ins can be edited, disabled, or reset to their original definition, but cannot be deleted. Custom rules can be created with fresh keys and deleted when no longer needed.

Patterns are validated on save: they must compile as JavaScript regex, fit within 500 chars, and not contain obvious ReDoS shapes (e.g. \`(.*)+\`). A short probe string is run against each pattern; patterns that take more than 50 ms are rejected.

Use the **Test a prompt** panel on the rules page to dry-run a prompt against the current enabled ruleset without creating an alert. Rule changes take effect within 30 seconds (runtime cache) or immediately on mutation.

## Severity

\`CRITICAL\` / \`HIGH\` / \`MEDIUM\` / \`LOW\` / \`INFO\` — drives the badge color and sort order.
`,

  settings: `# Settings

Most settings require \`ADMIN\`. Secret values are encrypted in the database with \`SETTINGS_ENCRYPTION_KEY\`.

## Sections

- **General** — choose the AI provider (Anthropic / OpenAI) and model used for in-app AI features (risk suggestion, compliance gap analysis, agent risk review, summarization).
- **Provider Admin APIs** — admin keys for org telemetry: Anthropic, OpenAI, Google Gemini billing export. Each has its own enable toggle and sync interval. Anomaly thresholds and governance-automation notice days live here too.
- **Proxy Setup** — shared \`PROXY_SECRET\` for the transparent Claude / OpenAI proxy. Generates ready-to-paste config for Claude Code (managed settings or per-user). Supports attribution headers: \`x-user-email\`, \`x-department\`, \`x-ai-system-id\`. For per-user attribution in Claude Code, developers add \`export PROXY_USER_EMAIL="$(git config user.email)"\` to their shell profile.
- **Users & Identity** — manage users and roles. Configure Google OAuth and Microsoft / Entra ID sign-in.
- **Shadow AI** — Google Workspace service account + admin email; Microsoft 365 Graph app credentials. DNS / proxy import lives here too.

## Roles

- \`ADMIN\` — everything.
- \`COMPLIANCE_OFFICER\` — create / assign policies, approve stages, create exceptions, upload evidence, close incidents.
- \`VIEWER\` — read-only.

## Tips

- The first user to sign in via Google OAuth is auto-promoted to \`ADMIN\`. Subsequent users default to \`VIEWER\`.
- Settings UI values **win over** environment variables. Env vars are the fallback when the DB value is absent.
- Do **not** rotate \`SETTINGS_ENCRYPTION_KEY\` in place — encrypted settings will become unreadable.
`,
};

/**
 * Map a Next.js pathname to a help key. Falls back to "dashboard".
 * Order matters — most specific routes come first.
 */
export function helpKeyForPath(pathname: string): HelpKey {
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/registry/") && pathname !== "/registry/new") return "registry-detail";
  if (pathname.startsWith("/registry")) return "registry";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/risk-center")) return "risk-center";
  if (pathname.startsWith("/compliance")) return "compliance";
  if (pathname.startsWith("/shadow-ai")) return "shadow-ai";
  if (pathname.startsWith("/oversight")) return "oversight";
  if (pathname.startsWith("/alerts")) return "alerts";
  if (pathname.startsWith("/settings")) return "settings";
  return "dashboard";
}
