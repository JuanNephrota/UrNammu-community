# UrNammu User Guide

This guide explains how to use UrNammu day-to-day — registering AI systems, running risk assessments, managing compliance, triaging shadow AI, and overseeing provider usage.

For a codebase walkthrough aimed at developers, see [implementation-guide.md](./implementation-guide.md).

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Getting Started](#2-getting-started)
3. [Dashboard (Command Center)](#3-dashboard-command-center)
   - [Executive Dashboard](#3a-executive-dashboard)
4. [AI System Registry](#4-ai-system-registry)
5. [AI Agents](#5-ai-agents)
6. [Risk Center](#6-risk-center)
7. [Compliance](#7-compliance)
8. [Governance Workflows](#8-governance-workflows)
9. [Shadow AI Discovery](#9-shadow-ai-discovery)
10. [Oversight (Telemetry & Cost)](#10-oversight-telemetry--cost)
11. [Alerts](#11-alerts)
12. [Settings Reference](#12-settings-reference)
13. [Integrations](#13-integrations)
14. [Background Automation](#14-background-automation)
15. [Common Workflows (Cookbook)](#15-common-workflows-cookbook)
16. [Troubleshooting / FAQ](#16-troubleshooting--faq)
17. [Glossary](#17-glossary)

---

## 1. Introduction

UrNammu is an enterprise AI governance platform that gives compliance, security, and risk teams centralized oversight of every AI system, agent, and API consumed in the organization. It is designed for **compliance officers, security reviewers, and governance admins** — not end users of AI tools.

### Core Concepts at a Glance

- **AI System** — a managed AI service or application (e.g. "Customer Support Copilot"). The primary governance unit.
- **AI Agent** — an autonomous agent tied to a system, with its own autonomy level and human-oversight rules.
- **Risk Assessment** — a multi-dimensional scoring of a system across bias, security, privacy, fairness, performance, and transparency, with branching questions and issue-level follow-up.
- **Policy** — a governance rule (mapped to EU AI Act, NIST AI RMF, ISO 42001, SOC 2, or custom) that can be assigned to systems.
- **Shadow AI** — unregistered AI tools discovered in the org via OAuth activity, Microsoft 365 apps, or network logs.
- **Oversight** — provider-level telemetry: token usage, cost, anomalies, model drift, dangerous prompt alerts, investigations, and vendor lifecycle.
- **Governance Workflow** — the staged approval flow (Owner → Security → Legal → Compliance) plus exceptions, evidence, incidents, and investigations.

The Glossary at the end of the guide collects these and more.

---

## 2. Getting Started

### Signing In

Open the UrNammu URL provided by your admin. The login page shows every sign-in method that is configured in Settings:

- **Google (Google OAuth)** — the standard production sign-in. Click *Continue with Google*.
- **Microsoft / Entra ID** — appears when the tenant has been configured in Settings → Users & Identity.
- **Dev credentials** — only appears if `ENABLE_DEV_LOGIN=true`. Intended for local development and demo environments.

**The first user to sign in via Google is automatically promoted to `ADMIN`.** All later users default to `VIEWER` until an admin promotes them.

### Getting help inside the app

Every dashboard page has built-in help.

- Click the **?** icon in the top bar to open a side drawer with guidance for the current page.
- Press **`?`** anywhere outside a text input to toggle the same drawer.
- Look for inline **?** icons next to complex form labels and badges (autonomy levels, data sensitivity, compliance status, risk dimensions, policy enforcement, spend-budget scope, etc.) — hover for a one-line explanation.

The full canonical content lives in `docs/help/*.md` and this guide.

### Layout Tour

After signing in you land on the **Dashboard**. The layout has three areas:

- **Sidebar (left)** — the nine modules: Dashboard, Registry, Agents, Shadow AI, Risk Center, Compliance, Oversight, Alerts, Settings.
- **Top bar** — the currently signed-in user and a shortcut menu.
- **Main content** — module pages. Every detail page uses a tabbed layout (Info → Agents → Risk → Compliance → Approval & Governance → Telemetry → Incidents on the Registry detail, for example).

### Roles

| Role | What you can do |
|------|----------------|
| `ADMIN` | Everything: all settings, user management, provider keys, policies, approvals, deletions. |
| `COMPLIANCE_OFFICER` | Create and assign policies, approve governance stages, create exceptions, upload evidence, close incidents. Cannot manage users or provider keys. |
| `VIEWER` | Read-only access across the product. Cannot approve, assign, create, or delete. |

If a button or tab is missing, check your role — most controls hide (rather than disable) for unauthorized roles.

---

## 3. Dashboard (Command Center)

The Dashboard is the daily home screen. It surfaces:

- **System stats** — total AI systems, agents, high-risk systems, discovered tools.
- **Governance queue** — the next-best actions across the portfolio (systems needing assessment, policies waiting on assignment, stages waiting on approval).
- **Compliance overview** — a donut/breakdown across `COMPLIANT`, `PARTIALLY_COMPLIANT`, `NON_COMPLIANT`, `NOT_ASSESSED`.
- **Executive posture chart** — a visual health summary.
- **Risk heat map** — systems vs. the 6 risk dimensions.
- **Open alerts, investigations, and remediation rollups** — the active follow-up queue.
- **Recent activity** — the latest governance actions from the audit log.

### Where to start each role

- **Admins**: review Settings → Provider Admin APIs and Settings → Shadow AI first to confirm telemetry is flowing, then move to the governance queue.
- **Compliance officers**: start in the governance queue (systems needing assessment / approval) and the Alerts panel.
- **Viewers**: use the Registry and Risk Center to read the current state of the portfolio.

---

## 3a. Executive Dashboard

**Sidebar → Executive** is the board-ready view of AI governance posture. Unlike the operational Dashboard (Section 3), the Executive page is designed for C-suite and board reporting with high-level metrics, period-over-period comparisons, and a natural-language briefing.

### Posture Scorecard

The hero element is a **composite governance score from 0 to 100**, computed from five weighted dimensions:

| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| Compliance | 25% | Percentage of compliance mappings that are fully `COMPLIANT`. |
| Risk Posture | 25% | Inverse of the average risk-assessment score (lower risk = higher posture). |
| Governance Coverage | 20% | Percentage of AI systems in `APPROVED` or `DEPLOYED` status. |
| Shadow AI | 15% | Inverse ratio of `DISCOVERED` tools to total discovered tools. |
| Incident Health | 15% | Penalty-based: open incidents, critical alerts, and open alerts reduce the score. |

The scorecard shows a color-coded arc gauge (green ≥ 75, amber 50–74, red < 50) and a **delta badge** comparing the current 30-day score to the prior 30-day period.

### Executive Briefing (Narrative)

A template-driven narrative panel generates 5–6 natural-language paragraphs summarizing:

- **Opening** — overall posture tier (Strong / Moderate / Needs Attention) with point delta.
- **Compliance** — compliant mapping count and rate, with change vs prior period.
- **Risk** — average risk score and HIGH/CRITICAL system count, with trend.
- **Spend** — total AI spend, top provider, and percentage change.
- **Shadow AI** — unregistered and under-review tool counts.
- **Incidents** — open incident and critical alert counts, with directional change.

No AI model is invoked — all text is derived directly from governance data.

### Board Summary Cards

Six KPI cards in a responsive grid, each with a current value and a delta indicator:

- **Governance Score** — composite 0–100 with point delta.
- **Compliance Rate** — percentage with percentage-point delta.
- **Avg Risk Score** — lower is better; delta inverted so positive = improvement.
- **Monthly Spend** — dollar total with percent change.
- **Shadow AI Backlog** — count of DISCOVERED + UNDER_REVIEW tools.
- **Open Incidents** — count with directional delta.

### 12-Month Posture Trend

A multi-series area chart showing three metrics over a rolling 12-month window:

- **Governance Score** (cyan) — monthly coverage-based governance health.
- **Compliance %** (emerald) — compliance mapping rate each month.
- **Risk Health** (amber) — inverted average risk score (higher = healthier).

### Risk Concentration

Two segment heatmaps (reused from the Dashboard) show risk concentration by **department** and by **vendor**, with system count, average risk score, and high-risk count per segment.

---

## 4. AI System Registry

The Registry is the central inventory of every managed AI system. Navigate via **Sidebar → Registry**.

### Registering a New System

1. Click **Register AI System** in the top-right of the Registry page.
2. Fill the form:
   - **Name**, **description**, **version**.
   - **Owner** — the person accountable for the system (User picker).
   - **Department**, **vendor**, **model type**.
   - **Data sensitivity** — `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, or `RESTRICTED`. This drives downstream policy evaluation.
   - **Use case**, **data inputs**, **data outputs**.
   - **Review interval (days)** — how often the system must be re-assessed before an alert fires.
3. **Set approval requirements** — four toggles (Owner / Security / Legal / Compliance) control which stages must sign off before the system can move to `APPROVED`. Leave a stage off if it is not required for this system's risk class.
4. Click **Save**. The system is created with status `DRAFT`.

### System Detail Page

Open a system from the Registry list. The detail page has these tabs:

- **Info** — the registered metadata; edit via the **Edit** button.
- **Linked Agents** — agents pointing to this system, with autonomy badges.
- **Risk Assessment** — the latest scores, assessment history, and open risk issues (`OPEN` / `IN_PROGRESS` / `RESOLVED` / `ACCEPTED`). Create a new assessment from here.
- **Compliance** — policies assigned to this system, each with `COMPLIANT` / `PARTIALLY_COMPLIANT` / `NON_COMPLIANT` / `NOT_ASSESSED`, evidence text, and compliance issues. The *AI Assess* button (admins / compliance officers) runs gap analysis.
- **Approval & Governance** — the staged review history, pending stages, governance exceptions, and evidence artifacts.
- **Telemetry & Cost** — usage buckets linked to this system (30-day window), token consumption trend, cost attribution.
- **Incidents & Alerts** — open and closed governance incidents plus related alerts.

### Lifecycle (status transitions)

`DRAFT` → `UNDER_REVIEW` → `APPROVED` → `DEPLOYED` → `DEPRECATED` → `RETIRED`

Status is updated automatically as governance reviews complete, or manually by admins via the Edit page.

### Archiving & Deleting

- **Archive**: sets the status to `RETIRED`. Reversible in the sense that the record remains available for audit, history, and review.
- **Delete**: hard delete. Requires typing the exact system name to confirm. The delete flow is meant for duplicates or mistakes, and it detaches linked references before removing the record.

---

## 5. AI Agents

Agents represent autonomous (or semi-autonomous) behavior layered on top of a system. Navigate via **Sidebar → Agents**.

### When to register an agent vs a system

- Register a **system** for the AI capability itself (e.g. "Claude-based support assistant").
- Register an **agent** when that capability runs autonomously with defined triggers, tools, or human-review rules. Agents link back to a parent system via **Connected Systems**.

### Autonomy Levels

| Level | Meaning |
|-------|---------|
| `FULL_AUTONOMY` | Agent acts with no human in the loop. Highest scrutiny required. |
| `SUPERVISED` | Agent acts, but a human monitors and can intervene. |
| `HUMAN_IN_THE_LOOP` | Agent proposes; a human approves every action. |
| `HUMAN_ON_THE_LOOP` | Agent acts by default; a human may override during or after. |
| `MANUAL` | Human takes every action; the agent only assists. |

### Human Review Triggers

Agents can declare triggers (JSON list) that force a human step — e.g. "dollar amount > $1 000", "contains PII", "new vendor". These feed the risk review and are shown on the agent detail page.

### AI-Assisted Agent Risk Review

On the agent detail page, **Run Risk Review** calls `/api/ai/assess-agent-risk` with the agent configuration. The response populates:

- A recommended risk tier (`CRITICAL` → `MINIMAL`).
- A written risk summary.
- A list of specific concerns.
- A list of recommendations (often "add a human review trigger for X").

Provider (Anthropic or OpenAI) is whichever is configured in Settings → General.

Generated agent risk reviews are saved, so they remain visible after refresh and can be revisited during later governance work.

---

## 6. Risk Center

**Sidebar → Risk Center** gives a portfolio-level view of risk.

### Overview Page

- **Risk counts** by `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` / `MINIMAL`.
- **Reassessment alerts** — systems whose `nextReviewDate` is approaching or past.
- **Systems without assessments** — work queue for new registrations.
- **Risk heat map** — matrix of systems × dimensions, colored by score.
- **Risk distribution** charts by department and vendor.
- **Control-gap detection** — systems flagged as high-risk but missing mitigating controls.

### Running a Risk Assessment

Start from **Risk Center → New Assessment** or from **Registry → [system] → Risk Assessment → Create Assessment**.

1. **Pick a template (optional)**. Built-in templates prefill scores and questions:
   - *Copilot* (productivity assistant, bounded)
   - *Vendor SaaS* (third-party hosted AI)
   - *Autonomous Agent* (multi-step agent with tools)
   - *Customer-Facing AI* (direct user interaction)
2. **Score the 6 dimensions** (0–100 each). The UI shows an **overall score** derived from them.
   - **Bias** — fairness of outputs across groups.
   - **Security** — vulnerability to attack / model misuse.
   - **Privacy** — exposure of personal / restricted data.
   - **Fairness** — outcome equity and disparate impact.
   - **Performance** — reliability / accuracy.
   - **Transparency** — explainability / traceability.
   For each, enter a **justification** so reviewers can re-evaluate the score later.
3. **Use AI Suggest** (optional). The button calls `/api/ai/classify` and populates recommended scores, confidence levels, and per-dimension rationale. Review and adjust — the AI suggestion is a starting point, not the decision.
4. **Answer branching questions** — the questionnaire expands based on data sensitivity, autonomy, and use case. Collapsible sections keep it scannable.
5. **Review control gaps** — the system shows suggested mitigating controls for each high-score dimension. Mark as addressed (with evidence) or document a remediation plan.
6. **Generate risk issues** — high-risk findings become `RiskAssessmentIssue` records with severity derived from score, status defaulting to `OPEN`. Each issue can then be worked independently, instead of treating the whole assessment as one large remediation item.
7. **Submit**. The system's overall `riskLevel` is updated and the assessment joins the history.

### Reassessment Cadence

Every system has a `reviewIntervalDays` field. When `nextReviewDate` is within `governance_review_notice_days` (default 14), an alert is raised. Overdue reviews escalate after `governance_escalation_overdue_days` (default 7).

---

## 7. Compliance

**Sidebar → Compliance** manages policies, assignments, and the audit trail.

### Creating a Policy

From Compliance → **New Policy**:

1. **Name**, **description**.
2. **Framework** — one of `EU_AI_ACT`, `NIST_AI_RMF`, `ISO_42001`, `SOC2`, `CUSTOM`.
3. **Version** and **status** (`DRAFT` / `ACTIVE` / `ARCHIVED`).
4. **Content** — the long-form policy text.
5. **Structured rules (JSON)** — machine-evaluatable constraints:
   - Allowed / blocked vendors
   - Allowed / blocked departments
   - Max data sensitivity (`PUBLIC` → `RESTRICTED`)
   - Required approval stages (subset of Owner / Security / Legal / Compliance)
   - Max review interval (days)
   - Minimum risk level
   - Model name allow / block patterns (regex)
   - **Enforcement**: `ADVISORY` (flag only) or `BLOCKING` (prevent approval)
   - Whether exceptions are permitted

### Assigning a Policy

From **Policy detail → Assign to Systems**, or **System detail → Compliance → Assign Policy**. Initial status defaults to `NOT_ASSESSED`.

### AI-Powered Gap Analysis

On a policy assignment row, click **AI Assess**. The platform calls `/api/ai/assess-compliance` with the policy rules plus system metadata and existing evidence. The response creates `ComplianceIssue` records (severity, title, detail, remediation) under the assignment. Review each, mark `RESOLVED` / `ACCEPTED` when addressed, and keep `OPEN` / `IN_PROGRESS` as work items.

### Recording Compliance Status & Evidence

On each assignment, edit:
- **Compliance status** — `COMPLIANT` / `PARTIALLY_COMPLIANT` / `NON_COMPLIANT` / `NOT_ASSESSED`.
- **Evidence** — free text describing the controls or artifacts (link to documents via Evidence Artifacts on the Approval & Governance tab).
- **Next review date**.

### What counts as compliance evidence?

Evidence has two surfaces in UrNammu and approvers read both:

1. **Assignment evidence** — the free-text field attached to each policy assignment (inside the Compliance status editor). This is the primary place to record *why* you chose a given status and *how* the system meets (or fails) the policy. Good entries reference specific controls and artifacts rather than restating the policy.

2. **Evidence Artifacts** — structured records attached to the system (Approval & Governance tab → Evidence Artifacts card). Each artifact has a title, category, optional link URL, and optional inline notes. These are the verifiable objects that back up the assignment evidence.

When writing assignment evidence, include at least:

- **Controls** that apply (e.g. vendor contract + DPA, TLS in transit, RBAC, audit logging).
- **Assessments** performed (e.g. bias evaluation, penetration test, red-team review, performance benchmark).
- **Artifacts** on file — and reference them by their Evidence Artifact title so reviewers can click through (e.g. "See *Vendor security review — Acme, 2026-02*").
- **Owners and dates** — who signed off and when.
- **Remaining gaps** — anything not yet in place, with remediation owner and date.

Common evidence-artifact categories (the Category field on Evidence Artifacts auto-suggests these):

| Category | Example |
|----------|---------|
| Security Review | SOC 2 Type II report; vendor security questionnaire results |
| Privacy / DPIA | Data Protection Impact Assessment document |
| Legal Review | MSA, DPA, or contract addenda |
| Model Card | Model documentation from the vendor or internal team |
| Data Use Agreement | Signed agreement governing input/output data |
| Bias Evaluation | Fairness test results, disparate impact analysis |
| Performance Evaluation | Accuracy / reliability benchmark reports |
| Architecture / Design | System design document, threat model |
| Change Management | CAB approval, deployment ticket |
| Vendor Assessment | Risk scorecard, subprocessors review |

### Why evidence matters for approval

A system can only be approved when every policy assignment is out of `NOT_ASSESSED` and `NON_COMPLIANT`. The **Approval Review** card on the Approval & Governance tab lists every unresolved item by policy name, so reviewers know exactly what is blocking approval — for example:

- "Policy *SOC 2 — AI Controls* has not been assessed. Set its compliance status and attach supporting evidence."
- "Policy *EU AI Act — High Risk* is Non-Compliant. Remediate the gap or request an exception before approval."
- "Policy *Internal AI Governance* is marked Compliant but has no evidence text. Describe the controls, testing, or artifacts that support the rating."

Empty-evidence warnings on `COMPLIANT` assignments do not hard-block approval, but they are surfaced to reviewers so a blind approve-through is obvious.

### Compliance Services View

**Compliance → Services** filters systems by compliance status so you can work through everything in `NON_COMPLIANT`, for example.

### Audit Trail

**Compliance → Audit Trail** shows every governance action: creations, updates, approvals, deletions. Filter by actor, action, entity type, or date range. Export as JSON or CSV for external auditors.

---

## 8. Governance Workflows

Governance features live on the **Approval & Governance** tab of each system.

### Staged Approval

When a system is ready for formal sign-off:

1. Set status to `UNDER_REVIEW` (via the Edit page or the approval card).
2. Each required stage (`OWNER`, `SECURITY`, `LEGAL`, `COMPLIANCE`) appears as a `GovernanceReview` waiting on decision.
3. The reviewer for each stage clicks **Approve** or **Request Changes** and must enter a rationale.
4. Once every required stage is approved, the system automatically moves to `APPROVED` and can be promoted to `DEPLOYED`.

Which stages are required is controlled by the `requireOwnerApproval` / `requireSecurityApproval` / `requireLegalApproval` / `requireComplianceApproval` flags on the system.

### Approval Decisions (beyond stages)

The **System Approvals** card records explicit top-level decisions:
- `APPROVED` — formally accepted.
- `CHANGES_REQUESTED` — sent back to the owner.
- `REVOKED` — approval withdrawn (with a new rationale).

### Governance Exceptions

Exceptions are time-bound waivers. Create one via **Approval & Governance → Exceptions → New**:

- **Title** and **rationale** (business justification).
- **Expires at** — a date.
- Status starts `ACTIVE` and flips to `EXPIRED` automatically after the date.
- An admin can mark an exception `REVOKED` early.

Alerts fire `governance_exception_notice_days` (default 14) before expiration so you have time to renew or remediate.

### Evidence Artifacts

The **Evidence Artifacts** card attaches documentation to a system:
- **Title**, **category**, **content** (inline text), **link URL** (external system).
Useful for audit controls, DPIAs, model cards, data-use agreements.

### Governance Incidents

Incidents track notable events (misuse, data exposure, outage). Create from the **Incidents** card:
- **Title**, **summary**, **severity** (`CRITICAL` → `INFO`).
- **Status** follows the Alert lifecycle: `OPEN` → `ACKNOWLEDGED` → `RESOLVED` (or `DISMISSED`).
- Related alerts auto-link. Investigations can be opened against an incident.

---

## 9. Shadow AI Discovery

**Sidebar → Shadow AI** detects unregistered AI tools circulating in your org.

### Discovery Sources

1. **Google Workspace** — scans OAuth activity for AI apps that users have connected.
2. **Microsoft 365** — scans delegated app permissions against known AI tools.
3. **DNS / proxy logs** — CSV upload or JSON API ingestion of network-observed AI domains.

Discovered entries are deduplicated by `toolName + domain`. Each finding becomes a `DiscoveredAITool` record.

### Running a Scan

- **Manual**: click **Scan Google Workspace** or **Scan Microsoft 365** at the top of the page. The scan history updates with a new `ScanHistory` entry (status `running` → `success` / `failed`).
- **Automatic**: configured in Settings → Shadow AI. A cron job at `/api/scheduler/maintenance` triggers scans on the configured interval (default 24 hours).

### Importing DNS / Proxy Logs

Two routes to `POST /api/discovered-tools/ingest`:

- **CSV upload** — file with columns `tool_name, vendor, detected_domain, department, user_count`.
- **JSON body**:
  ```json
  {
    "source": "corp-proxy",
    "entries": [
      { "toolName": "Perplexity", "vendor": "Perplexity AI", "detectedDomain": "perplexity.ai", "department": "Marketing", "userCount": 12 }
    ]
  }
  ```

Each ingestion run is recorded as an `IngestionRun` with processed / matched / new / updated counts.

### Automatic Suppression of Governed Tools

Shadow AI discovery only surfaces tools that are **not** already governed. When a scan or ingestion produces a finding whose `toolName` (optionally narrowed by `vendor`) matches an existing AISystem in the Registry, UrNammu:

- links the discovery to that AISystem (`linkedSystemId`) and sets its status to `REGISTERED`,
- annotates the notes with "Suppressed: matches governed system …",
- and does **not** raise a new shadow-AI alert.

The inverse also runs: when a new AISystem is registered, any pre-existing unlinked discoveries that match its name (and vendor, when present) are back-linked and suppressed in the same transaction.

Suppressed discoveries are hidden from the Shadow AI page by default. Admins who want to audit suppressions can fetch them via `GET /api/discovered-tools?includeSuppressed=true`.

### Triage Workflow

A discovered tool moves through:

`DISCOVERED` → `UNDER_REVIEW` → `REGISTERED` / `APPROVED` / `BLOCKED`

On the tool's row:

- **Link to system** — if the tool is already governed (e.g. you registered it before scanning found it), point the discovery at the existing AISystem. Status becomes `REGISTERED`.
- **Mark approved** — permit its use without adding to the Registry.
- **Mark blocked** — indicate it is not allowed; this is an organizational signal, not a technical block.
- **Add notes** — confidence reasoning, reviewer observations.

New discoveries auto-create high-priority alerts for admins to triage.

---

## 10. Oversight (Telemetry & Cost)

**Sidebar → Oversight** centralizes provider usage, cost, anomaly, model drift, dangerous prompt, vendor, investigation, and Claude Code telemetry.

### How Provider Sync Works

With Anthropic or OpenAI admin keys configured in Settings → Provider Admin APIs, plus optional Google Gemini / Vertex AI billing-export settings, the `/api/scheduler/maintenance` cron pulls oversight data on the configured sync interval and normalizes it into:

- **`UsageBucket`** — tokens / requests per provider / model / project / actor / time bucket.
- **`CostBucket`** — amount and line-item cost, same dimension keys.
- **`ProviderProject`** / **`ProviderActor`** — discovered workspace membership.
- **`ProviderSyncRun`** — a record of each sync attempt (status `RUNNING` / `SUCCEEDED` / `FAILED`).

Each provider is gated on its own credentials. **If a provider's admin key (or billing-export config, for Gemini) is not set, that provider is skipped** — no `ProviderSyncRun` row is created and no upstream API call is made. The manual-sync panel surfaces this explicitly as "Skipped (not configured): …" so it is clear which providers are active and which are simply not configured yet.

**Proxy traffic appears immediately.** Requests routed through the Anthropic or OpenAI proxy (Vercel fallback or Azure Functions) upsert hourly `UsageBucket` / `CostBucket` rows in real time, linked to a synthetic `ProviderSyncRun` with `syncType = "proxy_live"`. You do not need to wait for the admin-API sync interval to see proxy usage on the Oversight dashboard, spend budgets, or per-system Telemetry tab — it shows up on the next page refresh.

If traffic also flows through the built-in OpenAI or Anthropic proxy, Oversight can attach prompt-risk findings to recent activity and alerts using redacted excerpts and category labels.

### Overview Page

- Total tokens and total cost (rolling 7 and 30 days).
- Breakdown by provider / model / project.
- Data-exposure summary — usage attributed to high-sensitivity systems.
- Anomaly, model-drift, and dangerous-prompt findings with recommendations.
- Budget status cards.
- Remediation rollups across alerts, incidents, investigations, and corrective follow-up.

### Usage Page

**Oversight → Usage** drills into normalized telemetry with interactive filter controls:

- **Time range** — pick a start and end date, or use the **7d**, **30d**, **90d**, **YTD** presets to change the window instantly.
- **Provider / Model / Project filters** — narrow the view to a single provider (e.g. Anthropic), model family (e.g. claude-sonnet-4-20250514), or project. Filters populate from the last 90 days of telemetry data.
- **Summary cards** — Token Volume (with input / output breakdown), Requests, Total Cost, Cost per Request, and Monthly Forecast update live when filters change.
- **Usage Trend chart** — daily token volume area chart for the selected period.
- **Cost Breakdown panel** — a stacked bar chart splitting daily cost into **Input Token Cost** (cyan) and **Output Token Cost** (purple), plus stat cards for average cost per request and projected month-end spend with a pacing badge (`On track` / `Trending high` / `Over pace`).
- **Activity table** — per-bucket rows with date, provider, model, attribution, requests, tokens, and cost.
- **Top Models / Projects** — ranked sidebar cards showing the highest-volume models and project attributions.

All data re-fetches client-side when you click **Apply**, so the page stays responsive without a full reload.

### Linking Usage to Systems

The **Link Usage** dialog associates buckets with an AISystem via metadata keys. Once linked:

- The system's Telemetry tab shows the cost / usage trend.
- Data-exposure reports can flag restricted-sensitivity usage.
- Spend budgets scoped to that system become meaningful.

### Spend Budgets

From **Oversight → Spend Budget Manager**:

- **Scope** — `PROVIDER`, `AI_SYSTEM`, or `DEPARTMENT`.
- **Monthly budget** — dollar amount.
- **Warning threshold %** — default 80. Crossing it raises a `cost_anomaly` alert.

### Anomaly Detection

Anomaly thresholds are configured in **Settings → Provider Admin APIs**:

- **Recent window days** (default 7) vs **baseline window days** (default 7).
- Minimum token / cost thresholds to avoid noise.
- Per-dimension sensitivity multipliers (provider / model / project).

When recent usage exceeds baseline × multiplier, a `cost_anomaly` or `model_drift` alert is raised.

### Dangerous Prompt Monitoring

When teams route OpenAI or Anthropic traffic through the UrNammu proxy, Oversight can detect risky prompt categories such as:

- jailbreak and prompt-injection attempts
- credential or secret extraction
- malware or phishing generation
- regulated-data exfiltration
- unsafe autonomy instructions

By default, UrNammu stores redacted excerpts and category labels rather than full prompt bodies. These findings appear in Oversight, the alert inbox, and investigations.

### Vendor Governance

**Oversight → Vendors** tracks each vendor's lifecycle. A `VendorProfile` is auto-created for every vendor name in the Registry. On each profile:

- **Contract status**: `UNKNOWN` / `IN_REVIEW` / `ACTIVE` / `EXPIRED` / `TERMINATED`.
- **Contract dates** — start, renewal, renewal-notice days (default 60).
- **Security review**: `NOT_REVIEWED` / `IN_PROGRESS` / `APPROVED` / `CONDITIONAL` / `REJECTED`.
- **Data residency** (JSON) — allowed regions and notes.
- **Approved use cases** (JSON).
- **Subprocessors** (JSON).

Approaching-renewal alerts fire automatically.

### Investigations

**Oversight → Investigations** is the follow-up queue for alerts and incidents.

Create an investigation from an alert (preferred) or manually:
- **Title**, **summary**, **owner** (user).
- **Linked alert / incident / system** (optional).
- Status: `OPEN` → `IN_PROGRESS` → `RESOLVED`.
- Add **notes** over time, and a **resolution summary** when closing.

### Claude Code Oversight

**Oversight → Claude Code** shows Claude Code-specific telemetry pulled via the Anthropic admin sync: session counts, tool accept/reject breakdown, lines added/removed, commits, PRs, model distribution, estimated cost.

### Provider Posture Comparison

**Oversight → Provider Posture** gives a side-by-side comparison of every AI provider used in the organization. The page shows:

- **Summary cards** — active provider count, total 30-day spend, recent incidents, and high-risk system count.
- **Comparison table** — one row per provider with columns for Total Cost, % of Spend, Tokens, Requests, Systems, High-Risk count, Incidents, Exceptions, Alerts, and a computed **Risk Tier** badge (`LOW` / `MEDIUM` / `HIGH` / `CRITICAL`).
- **Sortable columns** — click any column header to sort ascending or descending. Useful for quickly finding the most expensive provider or the one with the most incidents.

The risk tier is calculated from a weighted score: incidents × 10 + alerts × 3 + high-risk systems × 5 + exceptions × 2. Thresholds: ≥ 30 = CRITICAL, ≥ 15 = HIGH, ≥ 5 = MEDIUM, < 5 = LOW.

---

## 11. Alerts

**Sidebar → Alerts** is the central alert inbox.

### Alert Sources

Every alert has a `source` string indicating what generated it:

| Source | Meaning |
|--------|---------|
| `policy_violation` | A policy rule evaluated to a violation. |
| `risk_reassessment` | A system's `nextReviewDate` is approaching or overdue. |
| `discovery` | New shadow-AI tool discovered. |
| `compliance_gap` | AI compliance analysis found a gap. |
| `incident` | A governance incident was opened. |
| `renewal` | Vendor contract renewal is approaching. |
| `escalation` | A review is overdue past `governance_escalation_overdue_days`. |
| `model_drift` | Usage pattern deviates from baseline. |
| `data_exposure` | Restricted-sensitivity data observed in provider telemetry. |
| `cost_anomaly` | Spend crossed a budget or anomaly threshold. |
| `ownership_escalation` | System has no owner assigned. |
| `dangerous_prompt` | Proxy-scanned traffic matched a risky prompt pattern. |

### Working an Alert

Statuses: `OPEN` → `ACKNOWLEDGED` → `RESOLVED` / `DISMISSED`.

Inline actions per alert:
- **Acknowledge** — marks as seen / being worked.
- **Create Investigation** — opens an Investigation pre-linked to this alert.
- **Dismiss** or **Resolve** — terminal states (dismiss = not a real issue; resolve = addressed).

---

## 12. Settings Reference

Settings live under **Sidebar → Settings**. Most require `ADMIN`.

### 12.1 General

- **AI Provider** — `anthropic` or `openai`. Drives `/api/ai/classify`, `/api/ai/assess-compliance`, `/api/ai/assess-agent-risk`, `/api/ai/summarize`.
- **Model** — e.g. `claude-3.5-sonnet` or `gpt-4`.
- **API key** — encrypted in the database; falls back to env vars (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) if unset.

### 12.2 Provider Admin APIs

Configure organization-level telemetry pulls.

- **Anthropic admin key** (encrypted) + **Test Connection** + enable toggle + sync interval (hours).
- **OpenAI admin key** (encrypted) + **Test Connection** + enable toggle + sync interval.
- **Anomaly detection**: recent window days, baseline window days, min-token threshold, min-cost threshold, per-dimension multipliers.
- **Governance automation**: review-notice days, exception-notice days, escalation-overdue days.

### 12.3 Proxy Setup

Configure the shared `PROXY_SECRET` for the Claude / OpenAI transparent proxy (Azure Functions + Vercel fallback). Docs in this page explain the endpoints developers should route through.

### 12.4 Users & Identity

- **User list** — email, name, role, created date. Admins change roles here.
- **Google OAuth** — client ID, client secret, test button.
- **Microsoft / Entra ID** — tenant ID, client ID, client secret.
- **Local credentials** — enable/disable (uses `ENABLE_DEV_LOGIN`).

### 12.5 Shadow AI

- **Google Workspace**: service account JSON (encrypted), admin email, enable auto-scan, scan interval, lookback days, test connection, last scan status.
- **Microsoft 365**: tenant ID, client ID, client secret, enable auto-scan, scan interval, test connection, last scan status.
- **DNS / proxy import**: a CSV uploader and the JSON endpoint documentation.

---

## 13. Integrations

### Google OAuth (sign-in)

1. In the Google Cloud Console, create an OAuth 2.0 Client (Web application).
2. Authorized redirect URI: `https://<urnammu-host>/api/auth/callback/google`.
3. Copy the client ID and secret into **Settings → Users & Identity**.
4. Click **Test Google Auth**.
5. The first user to sign in is promoted to `ADMIN`.

### Google Workspace (shadow AI discovery)

1. Create a Google Cloud service account with a JSON key.
2. Enable domain-wide delegation for the service account and authorize these scopes in the Workspace admin console:
   - `https://www.googleapis.com/auth/admin.directory.user.readonly`
   - `https://www.googleapis.com/auth/admin.reports.audit.readonly`
3. In **Settings → Shadow AI**, paste the service account JSON and enter the workspace **admin email** (used for delegation impersonation).
4. Click **Test Connection** → **Run Scan**.

### Microsoft Entra ID (sign-in + shadow AI)

1. Register an application in Azure AD.
2. For sign-in: add a redirect URI `https://<urnammu-host>/api/auth/callback/azure-ad`, and grant `openid profile email User.Read`.
3. For shadow AI: grant Graph permissions `AuditLog.Read.All` and `Directory.Read.All` (application permissions with admin consent).
4. Copy tenant ID, client ID, and secret into **Settings → Users & Identity** (auth) and/or **Settings → Shadow AI** (discovery).

### Anthropic Admin Key

1. In the Anthropic console → Organization → Admin Keys, create an admin key.
2. Paste it into **Settings → Provider Admin APIs → Anthropic**.
3. Enable sync and choose an interval. Run **Test Connection**.

### OpenAI Admin Key

1. In the OpenAI dashboard → Organization → Admin Keys, create a key.
2. Paste it into **Settings → Provider Admin APIs → OpenAI** and enable sync.

### DNS / Proxy Ingestion

- **CSV**: upload via **Settings → Shadow AI → DNS / proxy import**, or `POST` the file to `/api/discovered-tools/ingest`.
- **JSON**: `POST /api/discovered-tools/ingest` with the body shape shown in [section 9](#9-shadow-ai-discovery).

---

## 14. Background Automation

UrNammu has a single cron endpoint that runs every hour on Vercel (or external cron) and fans out to individual jobs.

### `GET /api/scheduler/maintenance`

- **Auth**: `Authorization: Bearer $CRON_SECRET` header.
- **Jobs**, each gated by its own enable flag and interval in `AppSetting`:
  - Anthropic telemetry sync
  - OpenAI telemetry sync
  - OpenAI assistant discovery
  - Google Workspace shadow-AI scan
  - Microsoft 365 shadow-AI scan
  - Governance automation (below)

Admins can trigger the endpoint manually for testing (e.g., `curl` with the `CRON_SECRET`).

### Governance Automation

Runs on every maintenance call. Produces alerts for:

- **Renewal** — a review becomes due within `governance_review_notice_days` (default 14).
- **Exception expiration** — an exception expires within `governance_exception_notice_days` (default 14).
- **Escalation** — a review is overdue by more than `governance_escalation_overdue_days` (default 7).
- **Ownership** — a system has no owner assigned.

---

## 15. Common Workflows (Cookbook)

### A. Register and approve a new SaaS AI tool

1. **Registry → Register AI System** — enter vendor-SaaS details, mark data sensitivity, enable Security + Compliance approval stages.
2. **Risk Center → New Assessment** — pick the *Vendor SaaS* template, click **AI Suggest**, refine scores, document justifications, save.
3. **System → Compliance → Assign Policy** — pick applicable EU AI Act / SOC 2 policies. Run **AI Assess** to find gaps. Upload evidence.
4. **System → Approval & Governance** — move status to `UNDER_REVIEW`. Security reviewer and compliance officer each click **Approve** with rationale.
5. Status transitions to `APPROVED`; promote to `DEPLOYED`.

### B. Triage a newly discovered shadow AI tool

1. **Shadow AI** — a new row appears with status `DISCOVERED` and an alert fires.
2. Open the row, review **detection source**, **user count**, **domain**, and **match confidence**.
3. If the tool is already governed → click **Link to System** and pick the existing AISystem. Status becomes `REGISTERED`.
4. If not governed but acceptable → set status to `APPROVED` and (optionally) **Register AI System** to bring it into the full workflow.
5. If disallowed → set status to `BLOCKED` and open an Investigation for the using department.

### C. Investigate a cost anomaly

1. **Alerts** — an alert with source `cost_anomaly` appears.
2. Click **Create Investigation** from the alert; assign an owner.
3. Open the linked UsageBucket in **Oversight → Usage**; filter by the flagged provider / model / project.
4. If legitimate → mark the investigation `RESOLVED` with a summary and dismiss the alert. Consider adjusting the spend budget.
5. If illegitimate → open a `GovernanceIncident` on the affected system and contact the owner.

### D. Run a quarterly policy re-assessment

1. **Compliance → Policies → [policy]** — click **Re-assess across assigned systems**.
2. For each assignment with new `ComplianceIssue` records, work through them in the System's Compliance tab.
3. Update `ComplianceStatus` per assignment.
4. Export the audit trail (**Compliance → Audit Trail → Export CSV**) for the quarter.

### E. Handle an expiring governance exception

1. Alert source `renewal` or `exception_notice` fires 14 days before expiration.
2. **System → Approval & Governance → Exceptions** — review the exception.
3. Option 1: remediate the underlying issue; let the exception expire.
4. Option 2: a compliance officer creates a replacement exception with a new rationale and date.

### F. Onboard a new compliance officer

1. Ask the user to sign in via Google once so the `User` record is created.
2. **Settings → Users & Identity** — change their role to `COMPLIANCE_OFFICER`.
3. Walk them through the Dashboard governance queue, Alerts, and an open system's Approval & Governance tab.

### G. Prepare a board-ready governance report

1. **Executive** — review the posture scorecard and note the composite score and delta.
2. Read the **Executive Briefing** narrative — it summarizes compliance, risk, spend, shadow AI, and incidents in board-appropriate language.
3. Check the **Board Summary Cards** for any red (danger) metrics that need executive attention.
4. Review the **12-Month Posture Trend** chart to identify improving or declining dimensions.
5. Note any risk-concentration hotspots in the Department and Vendor heatmaps.
6. Share the page URL or screenshot the dashboard for the board deck.

### H. Investigate a provider cost spike

1. **Oversight → Usage** — select the **7d** preset to focus on recent activity.
2. Use the **Provider** dropdown to filter to the suspected provider.
3. Review the **Cost Breakdown** panel — check if the spike is input-heavy (bulk ingestion) or output-heavy (generation).
4. Check the **Monthly Forecast** card — if it shows "Over pace", review spend budgets.
5. **Oversight → Provider Posture** — compare the provider's cost % and incident count against others.
6. If the spike is unexpected, create an Investigation from the Alerts inbox.

---

## 16. Troubleshooting / FAQ

**Why don't I see any usage data in Oversight?**
- Is an admin key set in **Settings → Provider Admin APIs**?
- Is the provider sync enabled (toggle on)?
- Has `provider_sync_interval_hours` elapsed since the last sync? The sync only runs when the cron fires *and* the interval is due.
- Check **Oversight → Sync history** for `FAILED` entries with error messages.

**Why can't I approve this system?**
- Your role must be `ADMIN` or `COMPLIANCE_OFFICER` for most stages.
- All required stages (`OWNER`, `SECURITY`, `LEGAL`, `COMPLIANCE`) must have their approvals recorded. Check which are toggled on in Edit.
- If a policy with `BLOCKING` enforcement has open compliance issues, approval is prevented.

**Shadow AI scan returned 0 tools.**
- Confirm the service account has domain-wide delegation in the Google Workspace admin console.
- Confirm the **admin email** in Settings is an actual Workspace super-admin.
- The scanner only looks back `google_scan_lookback_days` days (default 30) — very short windows on quiet tenants can yield nothing.
- Check `ScanHistory` for `failed` with an error message.

**The AI Suggest / AI Assess buttons are disabled or failing.**
- Set an API key in **Settings → General** (or as an env var fallback).
- Test the provider by submitting a simple classify request; check server logs for provider-side errors.

**Evidence upload isn't persisting.**
- UrNammu stores evidence as inline text + link URLs, not as binary uploads. Paste the document URL or a text summary into the artifact.

**First user didn't become an admin.**
- The auto-promotion only fires on Google OAuth. If you signed in with dev credentials, promote the user manually in **Settings → Users & Identity**.

---

## 17. Glossary

| Term | Definition |
|------|-----------|
| **AISystem** | A managed AI service or application requiring governance. |
| **AIAgent** | Autonomous or semi-autonomous agent tied to a system, with its own autonomy level and human-oversight rules. |
| **Risk Assessment** | Multi-dimensional scoring record (6 dimensions + overall) for a system at a point in time. |
| **Risk Issue** | A specific finding raised by a risk assessment (`OPEN` / `IN_PROGRESS` / `RESOLVED` / `ACCEPTED`). |
| **Policy** | Governance rule mapped to a compliance framework, with structured rules and long-form text. |
| **Policy Assignment** | Link between a policy and a system, with `ComplianceStatus` and evidence. |
| **Compliance Issue** | A specific gap identified against a policy assignment. |
| **Governance Review** | A decision at a single stage (`OWNER` / `SECURITY` / `LEGAL` / `COMPLIANCE`). |
| **System Approval** | An explicit top-level decision (`APPROVED` / `CHANGES_REQUESTED` / `REVOKED`). |
| **Governance Exception** | Time-bound waiver from a policy or control, with expiration. |
| **Evidence Artifact** | Documentation attached to a system (control evidence, DPIA, model card, etc). |
| **Governance Incident** | A notable event (misuse, breach, outage) linked to a system. |
| **Shadow AI** | Unregistered / ungoverned AI tool detected in the organization. |
| **DiscoveredAITool** | A shadow-AI finding from Google Workspace, Microsoft 365, or DNS import. |
| **Oversight** | Provider-level usage, cost, anomaly, and vendor telemetry. |
| **Posture Score** | Composite 0–100 governance health metric from five weighted dimensions (compliance, risk, coverage, shadow AI, incidents). |
| **Provider Posture** | Side-by-side provider comparison across cost, incidents, exceptions, and risk tier. |
| **Executive Dashboard** | Board-ready view with posture scorecard, narrative briefing, KPI cards, and trend charts. |
| **UsageBucket / CostBucket** | Normalized aggregated telemetry record keyed by provider / model / project / actor / time bucket. |
| **VendorProfile** | Vendor lifecycle data: contract status, dates, security review, data residency, subprocessors, approved use cases. |
| **Investigation** | Follow-up workflow for an alert or incident, with owner and resolution summary. |
| **Alert** | Governance signal with severity, status, and source; feeds the Alerts inbox. |
| **Audit Log** | Append-only record of every governance action. |
| **AppSetting** | Encrypted key-value store holding runtime configuration (provider keys, scan schedules, anomaly thresholds, etc). |

---

*For developer-facing extension and architecture notes, see [implementation-guide.md](./implementation-guide.md).*
