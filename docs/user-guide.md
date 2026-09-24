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
   - [EU AI Act Classification](#eu-ai-act-classification)
5. [AI Agents](#5-ai-agents)
   - [MCP Tool Governance](#mcp-tool-governance)
6. [Risk Center](#6-risk-center)
7. [Compliance](#7-compliance)
   - [Framework Control Catalog & Crosswalk](#framework-control-catalog--crosswalk)
   - [Policy-as-Code Runtime Enforcement](#policy-as-code-runtime-enforcement)
   - [Policy Denials Viewer](#policy-denials-viewer)
8. [Governance Workflows](#8-governance-workflows)
9. [Shadow AI Discovery](#9-shadow-ai-discovery)
    - [Enforcing a Block](#enforcing-a-block)
10. [Oversight (Telemetry & Cost)](#10-oversight-telemetry--cost)
    - [Claude Platform / API](#claude-platform--api)
    - [Claude Code Oversight](#claude-code-oversight)
    - [Session Traces](#session-traces)
    - [Cowork Oversight](#cowork-oversight)
    - [Cursor Oversight](#cursor-oversight)
    - [Proxy Health](#proxy-health)
    - [Provider Security & Privacy Scan](#provider-security--privacy-scan)
    - [Sensitive Scan](#10a-sensitive-scan)
    - [Endpoint Agent](#endpoint-agent)
11. [Reports](#11-reports)
12. [Alerts](#12-alerts)
    - [Key Usage Rules](#key-usage-rules)
13. [Settings Reference](#13-settings-reference)
14. [Integrations](#14-integrations)
15. [Background Automation](#15-background-automation)
16. [Common Workflows (Cookbook)](#16-common-workflows-cookbook)
17. [Troubleshooting / FAQ](#17-troubleshooting--faq)
18. [Glossary](#18-glossary)

---

## 1. Introduction

UrNammu is an enterprise AI governance platform that gives compliance, security, and risk teams centralized oversight of every AI system, agent, and API consumed in the organization. It is designed for **compliance officers, security reviewers, and governance admins** — not end users of AI tools.

### Core Concepts at a Glance

- **AI System** — a managed AI service or application (e.g. "Customer Support Copilot"). The primary governance unit.
- **AI Agent** — an autonomous agent tied to a system, with its own autonomy level and human-oversight rules.
- **Risk Assessment** — a multi-dimensional scoring of a system across bias, security, privacy, fairness, performance, and transparency, with branching questions and issue-level follow-up.
- **Policy** — a governance rule (mapped to EU AI Act, NIST AI RMF, ISO 42001, SOC 2, or custom) that can be assigned to systems. Policies can also carry machine-readable rules that are enforced at the proxy at runtime (advisory or blocking).
- **Shadow AI** — unregistered AI tools discovered in the org via Google Workspace OAuth activity, Microsoft 365 apps, Hexnode-managed devices, or DNS/proxy/Netskope network logs.
- **Oversight** — provider-level telemetry: token usage, cost, anomalies, model drift, dangerous prompt alerts, investigations, and vendor lifecycle — plus per-surface dashboards for Claude Platform/API, Claude Code, Cowork, and Cursor.
- **Governance Workflow** — the staged approval flow (Owner → Security → Legal → Compliance) plus exceptions, evidence, incidents, and investigations.
- **Report** — a saved, schedulable export built from any governance data source (systems, risk, compliance, usage, alerts, shadow AI, audit) in PDF/CSV/JSON.
- **Integration** — a connected third party that feeds UrNammu telemetry or identity (provider admin APIs, AI gateways, MDM, observability, SSO).

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

- **Sidebar (left)** — modules grouped into four sections:
  - **Overview** — Dashboard, Executive, Reports
  - **Registry** — AI Systems, AI Agents
  - **Governance** — Shadow AI, Risk Center, AI Oversight, Investigations, Vendor Governance, Claude Platform, Claude Code, Cowork, Cursor, Compliance
  - **System** — Alerts, Proxy Health, Integrations, Settings
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

- **System stats** — total AI systems, agents, high-risk systems, open alerts, shadow AI discoveries, and compliance rate. Each stat card is clickable and navigates to the relevant module (Registry, Agents, Risk Center, Alerts, Shadow AI, or Compliance).
- **Governance queue** — the next-best actions across the portfolio (systems needing assessment, policies waiting on assignment, stages waiting on approval).
- **Executive posture chart** — a rolling 12-month governance trend showing approved systems vs. ungoverned discoveries.
- **Segment risk heat maps** — risk breakdowns by department, vendor, and data sensitivity.
- **Remediation status** — clickable summary cards for open alerts, investigations, compliance issues, risk issues, renewal alerts, and ownership escalations. Each routes to the relevant page.
- **Automated governance recommendations** — AI-generated next-best-action suggestions per system, linked to the registry.

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

### Filtering the Registry

The registry table has a filter bar above it with five dropdowns:

- **Department** — filter by the departments in use.
- **Risk level** — `CRITICAL` → `MINIMAL` (sorted by severity).
- **Status** — `DRAFT` → `RETIRED` (sorted by lifecycle order).
- **Data sensitivity** — `RESTRICTED` → `PUBLIC`.
- **Vendor** — filter by the vendors present in the data.

Dropdowns only show values that actually appear in your data — options that would produce an empty result are hidden. Filters compose as AND and combine with the existing name search. A **Clear all** button appears when any filter is active, together with a "Showing N of M systems" counter.

### Registering a New System

Click **Register AI System** in the top-right of the Registry page (admins and compliance officers). Registration is a four-step guided flow:

1. **Basics** — system name, owning department, what it does, use case and version. Type the name and click **Autofill with AI** (sparkle icon) to have the AI assistant look the tool up and fill in the description, use case, model type, data inputs and outputs, risk level and data sensitivity, and the vendor if you haven't entered one. Some of those fields are on later steps, so check them as you go. Continuing from this step creates the system as a `DRAFT`, with you as the owner.
2. **Data & tech** — vendor (use "Internal" for systems built in-house), model type, the most sensitive data it touches (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL` or `RESTRICTED`, which drives policy evaluation and the risk questions), and data inputs and outputs.
3. **Governance** — an initial risk level (the risk assessment replaces it), status, how often it is re-reviewed, an optional next review date (blank means today plus the interval), and which sign-offs are required: Owner, Security, Legal, Compliance. Leave a stage off if this system's risk class doesn't need it.
4. **Review** — a summary and what comes next. **Start risk assessment** opens the assessment with this system selected. If the vendor has no governance profile yet, there's a link to add one.

Each step saves when you move on. If you stop partway, the system's **Governance checklist** links back to the step you left off on (`/registry/[id]/setup?step=…`). **Edit** on the system page still opens the single-page form with every field.

> **Note** — the Autofill button requires the AI provider to be configured under **Settings → General**. If no provider is set, the button will surface a clear error message pointing there.

### System Detail Page

Open a system from the Registry list. The **Overview** tab opens with a **Governance checklist**: describe the system; document vendor, model and data; clear the vendor (external vendors only: the vendor needs a profile with an approved or conditional security review); complete a risk assessment; classify under the EU AI Act; assign policies; upload evidence; complete the required governance reviews; and record the approval decision. Each open item links to where you complete it, and the **Next step** button jumps to the first one. The checklist tracks progress; the **Recommended Next Actions** card further down prioritizes what to fix. The tabs are:

- **Overview** — the checklist, registered metadata and use case, the EU AI Act classification, the approval decision and staged review history, governance exceptions, evidence artifacts, incidents, telemetry attribution, and recommendations. Edit metadata via the **Edit** button.
- **Agents (n)** — agents pointing to this system, with autonomy badges.
- **Risk (n)** — the latest scores, assessment history, and open risk issues (`OPEN` / `IN_PROGRESS` / `RESOLVED` / `ACCEPTED`). **New assessment** opens a guided assessment for this system.
- **Compliance (n)** — policies assigned to this system, each with `COMPLIANT` / `PARTIALLY_COMPLIANT` / `NON_COMPLIANT` / `NOT_ASSESSED`, evidence text, and compliance issues. The *AI Assess* button (admins / compliance officers) runs gap analysis.
- **Audit Trail** — every recorded action on this system.

### EU AI Act Classification

Every system carries an **EU AI Act Classification** card on its Overview tab. Until the wizard has been run it shows *Not yet classified* and the Approval Review card lists a warning; afterwards it shows the risk tier, your role, the timeline, and the applicable articles.

**Running the wizard.** Click **Run classification** (or **Update classification**). The steps are:

| Step | What it decides |
|---|---|
| Your role | Provider, deployer, or both. Providers carry Arts. 9–17, 43, 49, 72; deployers carry Arts. 26–27. |
| Prohibited practices | Any Art. 5 match makes the tier **Prohibited** and hard-blocks approval. |
| Annex I products | Safety components of regulated products are high-risk under Art. 6(1), with the August 2027 timeline. |
| Annex III use cases | Biometrics, critical infrastructure, education, employment, essential services, law enforcement, migration, justice. Any match is high-risk under Art. 6(2). |
| Art. 6(3) derogation | Only shown when an Annex III area is selected. Narrow procedural, preparatory, human-improving or pattern-detection tasks that do **not** profile people are exempt. The claim must be documented (Art. 6(4)). |
| Transparency triggers | Chatbots, synthetic content, emotion recognition, deep fakes, public-interest text. Adds Art. 50 regardless of tier; on its own gives **Limited risk**. |
| General-purpose AI | Whether the system is built on a foundation model (keep the provider's Art. 53 documentation) and, for providers, whether you provide one. |
| Fundamental rights impact | Only for high-risk deployers: public body, public services, credit scoring, or life/health insurance pricing triggers an Art. 27 FRIA. |
| Review & save | Shows the tier, rationale, warnings and every obligation with the reason it applies. Add notes for the record. |

The right-hand panel previews the outcome as you go. The server re-derives the tier from your answers on save, so the stored result always matches the stored answers.

**What saving does.**

- Stores the classification with rationale, notes, who classified it and when. Changes are audit-logged with the before/after tier.
- Creates a `NOT_ASSESSED` **Framework Controls** entry for each applicable EU AI Act article that the system does not already have, so the obligations appear on the Compliance tab ready to evidence.
- Raises an alert (source `eu_ai_act`) for **High-risk** (HIGH) or **Prohibited** (CRITICAL) outcomes, and resolves it if a later re-classification lowers the tier.

**Effect on approval.** A **Prohibited** classification is a hard blocker. An unclassified system, or a high-risk system with applicable articles still unassessed, shows as a warning in the Approval Review card and a governance recommendation, but does not block approval on its own. The Executive Dashboard reports how many systems are classified and how many are high-risk.

**Timelines.** The wizard shows the regulation's application dates: prohibitions and AI literacy from 2 February 2025, GPAI provider duties from 2 August 2025, transparency and Annex III high-risk from 2 August 2026, Annex I high-risk from 2 August 2027. Pending EU amendments may move the high-risk dates; the classification logic is unaffected.

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

### MCP Tool Governance

Agents increasingly act through Model Context Protocol (MCP) servers. UrNammu governs that surface at the proxy: it records which servers each agent declares and which tools the model actually invokes, checks both against a per-agent allowlist, and can block or narrow requests.

**Attribution.** Send the proxy header `x-agent-id: <agent id>` on the agent's model calls (the id is shown on the agent's MCP Tool Governance card). The agent's parent system is used for `x-ai-system-id` attribution automatically when that header is absent.

**Allowlists** (agent edit page → *MCP Tool Governance*):

| Field | Grammar |
|---|---|
| Allowed MCP servers | Server `name` as declared in the request, its URL host, a full URL, or a wildcard such as `*.example.com`. |
| Allowed MCP tools | `tool` (any server), `server/tool`, or `server/*`. |
| Enforcement | **Monitor** (default) or **Enforce**. |

An empty list means "not configured" and allows everything for that dimension while still recording activity, so you can observe first and tighten later.

**What the proxy does.**

- *Declared servers* (Anthropic `mcp_servers[]`, OpenAI Responses `tools[type=mcp]`) are checked against the server allowlist before forwarding. In Monitor mode a dry-run denial is recorded and the request proceeds; in Enforce mode the proxy returns `403` with the violating server named. Denials appear under **Compliance → Blocked Queries** with rule `mcp_server_not_allowed`.
- *Tool narrowing* (Enforce only): for each server the tool allowlist names specific tools for, the proxy sets `tool_configuration.allowed_tools` (Anthropic) or `allowed_tools` (OpenAI) to the intersection of what the request asked for and what the allowlist permits, so the provider never offers unlisted tools to the model.
- *Observed invocations* (`mcp_tool_use`, provider `server_tool_use`, client `tool_use`, OpenAI `mcp_call` / `tool_calls`) are recorded per call, in both streaming and non-streaming responses, and profiled per agent with first-seen and last-seen timestamps. Only MCP tools are judged against the tool allowlist; provider and client tools are recorded for visibility.

**Alerts** (source `mcp_tool_governance`): HIGH when an agent invokes an MCP tool outside its allowlist, MEDIUM the first time a new server or tool is seen for an agent. Both dedupe for 24 hours per agent and tool.

**Where to look.** The agent detail page carries a **MCP Tool Governance** card with a blast-radius strip (access level, parent system, connected systems, capabilities, servers and tools seen), the allowlists, and every observed server and tool with an **Approve** button for unapproved rows. **Oversight → MCP Activity** shows the same across all agents plus the last hundred tool calls. Session traces annotate proxy spans with the number of tool calls observed.

### Discovered Agents

**Agents → Discovered** is the review queue for AI agents UrNammu has seen but nobody registered. Each entry records where it was found, why it looks like an agent (scored signals), and the tools, MCP servers, models and users observed. The tab badge counts entries that still need review.

Sources:

- **Proxy traffic.** Every proxied request now records a *client fingerprint* in its usage metadata: the agent framework or SDK named by its `User-Agent` / `x-stainless-*` headers, and a salted hash of the credential it used (the key itself is never stored). Hourly, `/api/cron/agent-discovery` groups the last 7 days of traffic that carried **no** `x-agent-id` by caller (provider, credential hash, user, system) and scores each caller:

  | Signal | Points |
  |---|---|
  | Agent framework in the `User-Agent` (Claude Agent SDK, OpenAI Agents SDK, LangGraph, CrewAI, AutoGen, Pydantic AI, Semantic Kernel, Mastra, Strands, Google ADK, smolagents) | 40 |
  | LLM orchestration library (LangChain, LlamaIndex, Vercel AI SDK, LiteLLM) | 20 |
  | The model returned tool calls | 30 |
  | MCP tools were invoked | 15 |
  | 20+ tool calls in the window | 10 |
  | Active in 12+ distinct hours | 10 |
  | No user identity (service credential) | 5 |

  Callers scoring 40 or more are queued; confidence is high at 70+, medium at 50+, low otherwise. Callers with fewer than 5 requests, with no identity at all, or whose traffic is mostly an interactive coding assistant (Claude Code, Cursor, Copilot, Codex CLI, Cline, Continue, Windsurf, Aider, Zed) are skipped, since those are governed as tools. **Run proxy detection** on the tab runs the job immediately. Framework detection depends on what each client puts in its `User-Agent`, so a framework that sends only the vendor SDK's default is found by its tool-use signals instead.

**Reviewing.** **Register agent** creates a `DRAFT` agent from the entry (description, observed tools as capabilities, observed MCP servers seeded into the MCP server allowlist in Monitor mode) and marks the entry `REGISTERED`. **Start review**, **Approve without registering**, **Mark blocked** and **Reopen** change only the review status. Marking an agent blocked records the decision; it does not stop its traffic. Every change is audit-logged.

The first time an entry appears, an alert with source `agent_discovery` is raised. Later sightings update the entry (last seen, request count, tools) without new alerts, whatever its status.

**Getting a detected agent attributed.** After registering, have the agent send `x-agent-id: <agent id>` on its proxy calls. From then on its traffic is governed by the agent's MCP allowlists, and detection ignores it.

#### Platform imports

Platform imports fill the queue from the places people build agents:

| Platform | Source | What is imported | Setup |
|---|---|---|---|
| OpenAI Assistants | `openai_assistants` | Name, description, model, tool types (function names) | Automatic after each OpenAI sync (Settings → Provider Admin APIs). Assistants an earlier release wrote straight into the registry are linked to that agent, not duplicated. OpenAI retired the Assistants API on 2026-08-26, so this is normally empty now. |
| ChatGPT Enterprise custom GPTs | `chatgpt_gpts` | Name, owner, editors, tool types, custom-action domains, sharing | Automatic with the ChatGPT Enterprise compliance sync. The first sync imports existing GPTs without an alert per GPT. |
| Anthropic Managed Agents | `anthropic_managed_agents` | Name, description, model, tool types, custom tool names, MCP servers | Settings → Shadow AI → Agent Platforms → workspace API key |
| Microsoft 365 Copilot / Copilot Studio | `microsoft_copilot` | Name, description, publisher, package type, platform, availability and deployment scope, blocked flag | Settings → Shadow AI → Agent Platforms → enable; needs `CopilotPackages.Read.All` on the Microsoft 365 app and an Agent 365 license |
| Salesforce Agentforce | `salesforce_agentforce` | Name, description, agent type, active version | Settings → Shadow AI → Agent Platforms → My Domain URL + connected app client credentials |

The last three run together as the **Agent platforms** discovery source: enable **Auto-import** on the card (default every 24 hours) or click **Import Now**. Each platform is skipped until configured, and one platform failing does not stop the others — the card shows the last run's counts and any per-platform error. No system prompts, instructions, knowledge files or conversation content are ever imported.

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

Start from **Risk Center → New Assessment** or from **Registry → [system] → Risk → New assessment**, which opens the assessment with that system already selected. The assessment is a five-step guided flow. A progress bar across the top shows where you are, and you can click back to any earlier step.

1. **System** — pick the AI system. Its current posture, evidence count, approval state and linked agents are shown. Then either click **Generate Assessment with AI**, which calls `/api/ai/classify` and fills in scores, per-dimension justifications, notes and issues from the system's description (the system needs a description first), or apply a template that prefills scores and justifications:
   - *Copilot* (productivity assistant, bounded)
   - *Vendor SaaS* (third-party hosted AI)
   - *Autonomous Agent* (multi-step agent with tools)
   - *Customer-Facing AI* (direct user interaction)
   Both are starting points, and you adjust everything in the next steps.
2. **Context** — assessment focus areas, the recommended risk tier, control gaps found in the system record (missing policies, evidence or approvals), and the **contextual review questions**. The questions depend on the system's data sensitivity, use case and agents, and every one must be answered before you can continue. Systems with linked agents also show an agent risk overlay.
3. **Scores** — score the six dimensions from 0 to 100 (higher is riskier). The overall score is their average.
   - **Bias** — fairness of outputs across groups.
   - **Security** — vulnerability to attack / model misuse.
   - **Privacy** — exposure of personal / restricted data.
   - **Fairness** — outcome equity and disparate impact.
   - **Performance** — reliability / accuracy.
   - **Transparency** — explainability / traceability.
   A justification is optional below 60 and required at 60 or above. The justification box opens automatically once a score reaches 40.
4. **Mitigation** — optionally record **residual scores**, the risk left after your controls, which appear next to the inherent scores on the radar and trend charts. This step also lists the **assessment issues**: high-risk dimensions become `RiskAssessmentIssue` records with a severity derived from the score and status `OPEN`, so each can be worked on its own.
5. **Review** — the inherent score, recommended tier, issue count and every dimension score, plus overall notes. **Submit Assessment** saves it, updates the system's `riskLevel`, and opens the system's Risk tab.

The assessment is saved only when you submit, because submitting changes the system's risk level. If you try to leave with unsaved answers, the browser warns you first.

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

### Editing a Policy

From the **policy detail page**, click **Edit Policy** (pencil icon in the header) to revise the policy after creation. The edit form is the same structure as the create form and is pre-populated from the stored policy — every field is editable, including:

- Name, description, framework, version, status
- Policy content (long-form text)
- All machine-readable rules (vendors, sensitivities, stages, departments, model patterns, allowed statuses, review-interval / risk thresholds, enforcement, exceptions)

Every edit is captured in the audit trail with the editor's user ID so reviewers can see who changed what. Assignments and compliance statuses are preserved across edits — only the policy definition changes. Role: ADMIN or COMPLIANCE_OFFICER.

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

### Framework Control Catalog & Crosswalk

Policies are your own documents. The **framework control catalog** is the external yardstick: the actual requirements of each framework, seeded into the database so you can attest to them one by one.

| Framework | What is seeded |
|---|---|
| NIST AI RMF 1.0 | The 19 categories under Govern, Map, Measure, Manage |
| ISO/IEC 42001:2023 | The 38 Annex A controls (A.2.2 – A.10.4) |
| EU AI Act | 19 articles carrying provider or deployer obligations (Art. 4, 5, 9–17, 26, 27, 43, 49, 50, 53, 72, 73) |
| SOC 2 (TSC 2017) | CC1–CC9, A1, C1, PI1, P1–P8 |

**Assessing a system.** Open the system, switch to the **Compliance** tab, and scroll to **Framework Controls**. Pick a framework tile, then click a control's status badge to record Compliant / Partially Compliant / Non-Compliant with evidence. Each rating is stored per system and per control, and every change is written to the audit trail.

**Crosswalk inheritance.** The catalog ships with a curated crosswalk of about a hundred links between frameworks (for example NIST *GOVERN 1* ↔ ISO *A.2.2* ↔ EU AI Act *Art. 17*). When a control is marked **Compliant**, its crosswalked peers show as **Inherited** in the other frameworks and count toward their coverage. Inheritance is a single hop and only flows from a direct Compliant rating; a Partially Compliant rating never propagates. Recording a direct rating on the inheriting control overrides the inherited status for that control only.

**Coverage.** The coverage percentage is compliant plus inherited controls divided by the framework's control count. Partial ratings are shown in the bar but do not count toward coverage, so a half-finished framework does not read as half done.

**Org-wide view.** **Compliance → Framework Coverage** (or the *Browse Controls* button on the Compliance page) shows average coverage per framework across the systems that have at least one direct rating in it, and each framework page lists its controls with descriptions, crosswalk links, and how many in-scope systems satisfy each one.

**AI gap analysis.** The **AI Gap Analysis** button on the Framework Controls card sends the current control statuses to the configured AI provider and returns prioritised gaps with suggested remediation. It is advisory and saves nothing; use it to decide where to look next, then record your own ratings.

### Compliance Services View

**Compliance → Services** filters systems by compliance status so you can work through everything in `NON_COMPLIANT`, for example.

### Audit Trail

**Compliance → Audit Trail** shows every governance action: creations, updates, approvals, deletions. Filter by actor, action, entity type, or date range. Export as JSON or CSV for external auditors.

### Policy-as-Code Runtime Enforcement

Policies aren't only documentation — a policy's machine-readable rules (blocked models, prompt patterns, token / rate / cost limits) can be **enforced at the proxy** before a request reaches the AI provider. This is governed by a single org-wide mode, set in **Settings → General** (or **Settings → Policy Enforcement**):

| Mode | Behavior |
|------|----------|
| **Off** (default) | Policies are ignored at runtime. Every request passes. Safe default for rollout. |
| **Dry run** | Policies are evaluated and violations are **logged as denials**, but the request still forwards to the provider. Use this to measure impact before turning enforcement on. |
| **Enforce** | A violation of a **blocking** policy returns HTTP `403` and the request never reaches the provider. |

Each policy is independently marked **Blocking** (returns 403 on violation in Enforce mode) or **Advisory** (always logs a denial but lets the request through). The proxy re-reads policy state roughly every 30 seconds, so changes propagate without a redeploy.

### Policy Denials Viewer

**Compliance → Denials** is the log of every request that was blocked or flagged by runtime enforcement (and content blocks from dangerous-prompt detection).

- **Filters** — source (policy vs. dangerous-prompt content block), AI System, policy, and date range (last 7 days by default).
- **Each row** shows timestamp, source badge, system, provider/model, matched policy IDs, denial reason, and user email.
- **Detail page** — click a denial to see which rule fired, all matching policies, and request context.
- **Export** — download the filtered list as CSV for audit.

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
2. **Microsoft 365** — scans delegated app permissions against known AI tools. Resolving the granting principals to email addresses (via Graph `/users/{id}`) requires `User.Read.All` in addition to the audit/directory/application read permissions; without it, discoveries are still created but their user emails stay empty.
3. **Hexnode UEM/MDM** — scans the app inventory of enrolled/managed devices and cross-references installed apps against known AI tools.
4. **CrowdStrike Falcon** — endpoint discovery for AI tools observed running on Falcon-protected hosts.
5. **DNS / proxy logs** — CSV upload of native gateway exports (with vendor presets) or JSON API ingestion of network-observed AI domains.
6. **Netskope** — real-time log-shipper ingestion of Netskope event JSON (no manual upload needed).
7. **Agent platforms** — not a tool scan: imports the agents built on Anthropic Managed Agents, Microsoft 365 Copilot / Copilot Studio and Salesforce Agentforce into the agent review queue ([Discovered Agents](#platform-imports)). Configured on the **Agent Platforms** card in Settings → Shadow AI.
8. **Endpoint agent** — a signed binary pushed by MDM to managed macOS and Windows machines ([Endpoints](#endpoint-agent)). It observes from *inside* the endpoint, so it is the only source that catches a laptop off the VPN, a personal-tier account, a desktop app with no SaaS audit trail, or a model being served locally.

The identity-based sources (Google, Microsoft) only see apps federated to your IdP. A tool someone signed into with a personal account is invisible to them and can only be caught by device inventory, network logs, or the endpoint agent — the sources are complementary, not redundant. Network-based sources in turn only see traffic that crosses your network, which is why the endpoint agent exists: a remote laptop and a locally-served model produce no network evidence at all.

Discovered entries are deduplicated by `toolName + domain`. Each finding becomes a `DiscoveredAITool` record.

**Observation details.** Every record stores what the scans observed — `userEmails`, OAuth `scopes`, `firstSeenAt`, and `lastSeenAt` — as queryable fields (they used to live only in the notes text). The Shadow AI page shows first/last seen, a chip per user email, and the granted scopes under each tool. The user count follows one rule: a rescan from the **same** detection source replaces the count (so it can go down when access is revoked or devices retire), while a **different** source only raises it — two partial views combine as a maximum. Only values that look like email addresses land in `userEmails`; device names or bare usernames from network logs still count toward `userCount`.

### Running a Scan

- **Manual**: click **Scan All Sources** at the top of the page. A single button runs every configured source (Google Workspace, Microsoft 365, Hexnode, CrowdStrike) in sequence, showing live per-source progress (e.g. "Scanning Google Workspace (1/4)…") and a result summary per source. Each source writes its own `ScanHistory` entry (status `running` → `success` / `failed`). Sources that aren't configured are skipped.
- **Automatic**: configured in Settings → Shadow AI per source. Each source has its own hourly cron at `/api/cron/discovery-scan/<source>` that scans once the source's configured interval has elapsed (default 24 hours), so a slow scan of one source never delays another.

### Importing DNS / Proxy Logs

The importer takes raw DNS or web-proxy log exports — you do not pre-classify tools; UrNammu matches the observed hostnames against its AI tools registry of 160+ known tools (plus AI-keyword heuristics for low-confidence candidates). When several registry hosts match, the most specific wins — `labs.openai.com` resolves to DALL·E, not to the broader ChatGPT entry that owns `openai.com`.

**CSV / TXT upload** — **Shadow AI → Import CSV** (or `POST /api/discovered-tools/import` as multipart `file` + `source`). Pick the export's vendor so the right column names are recognized: `umbrella` (Cisco Umbrella), `cloudflare_gateway`, `zscaler`, `netskope`, `prisma_access`, `dnsfilter`, `nextdns`, or the generic `dns_proxy` / `firewall` / `siem` / `other`. The header row is matched case-insensitively against each preset's aliases; the generic preset understands:

| Field | Header aliases (generic preset) |
|-------|-------------------------------|
| domain (required) | `domain`, `host`, `hostname`, `destination`, `destination fqdn`, `url`, `query`, `fqdn` |
| user | `user`, `email`, `username`, `source_user`, `identity`, `user email` |
| device (fallback identity) | `device name`, `device`, `computername`, `computer name`, `client name`, `host name` |
| department | `department`, `dept`, `group`, `team`, `organizational unit` |
| count | `count`, `hits`, `requests`, `queries`, `repeatcnt` |
| timestamp | `timestamp`, `@timestamp`, `time`, `date`, `datetime`, `event time`, `start time`, `receive time`, `last seen`, `first seen` |

Vendor presets add that product's own names (for example Umbrella's `most granular identity`, Zscaler's `destination host`, Prisma Access's `srcuser` / `repeatcnt`). URLs are reduced to a bare lowercase hostname before matching. A file with no header row is treated as one domain per line. Timestamps may be ISO 8601 or epoch seconds/milliseconds and drive each tool's **first seen / last seen**; without a timestamp column the import time is used.

**JSON body** — `POST /api/discovered-tools/ingest`:
  ```json
  {
    "source": "zscaler",
    "entries": [
      { "domain": "perplexity.ai", "user": "jane@example.com", "department": "Marketing", "count": 12, "timestamp": "2026-09-15T14:02:11Z" }
    ]
  }
  ```
  Or the shorthand `{ "domains": ["perplexity.ai", "api.openai.com"] }` when you only have hostnames.

Each ingestion run is recorded as an `IngestionRun` with processed / matched / new / updated counts.

**Netskope log shipper.** Instead of manual CSV uploads, a Netskope tenant can stream events straight in by POSTing native Netskope event JSON (page / application / alert events) to `/api/discovered-tools/ingest/netskope`. The endpoint is secured with the shared proxy secret as a Bearer token and auto-extracts domain, user, department, hit count, and the event `timestamp` (epoch seconds or ISO) from the Netskope event fields. Configure the webhook in **Settings → Shadow AI → Netskope**.

### Automatic Suppression of Governed Tools

Shadow AI discovery only surfaces tools that are **not** already governed. When a scan or ingestion produces a finding whose `toolName` (optionally narrowed by `vendor`) matches an existing AISystem in the Registry, UrNammu:

- links the discovery to that AISystem (`linkedSystemId`) and sets its status to `REGISTERED`,
- annotates the notes with "Suppressed: matches governed system …",
- and does **not** raise a new shadow-AI alert.

The inverse also runs: when a new AISystem is registered, any pre-existing unlinked discoveries that match its name (and vendor, when present) are back-linked and suppressed in the same transaction.

Suppressed discoveries are hidden from the Shadow AI page by default. Admins who want to audit suppressions can fetch them via `GET /api/discovered-tools?includeSuppressed=true`.

### Tool Categories

Every entry in the known-AI-tools registry carries a **category**, and a discovery inherits it when it matches the registry (`DiscoveredAITool.category`). The set is closed:

| Category id | Label | Examples |
|-------------|-------|----------|
| `chat_assistant` | Chat Assistant | ChatGPT, Claude, Gemini, DeepSeek, Grok |
| `coding_assistant` | Coding Assistant | GitHub Copilot, Cursor, Windsurf, Devin, Cline |
| `agent_platform` | Agent Platform | Zapier Agents, n8n, Relevance AI, Manus |
| `image_generation` | Image Generation | Midjourney, Stability AI, Ideogram, DALL·E |
| `video_generation` | Video Generation | Runway, Pika, Luma, HeyGen, Synthesia, Sora |
| `audio_voice` | Audio & Voice | ElevenLabs, Suno, Descript, Deepgram |
| `writing` | Writing | Grammarly, Jasper, Copy.ai, QuillBot |
| `meeting_notes` | Meeting Notes | Otter, Fireflies, Read AI, Fathom, Gong |
| `search` | Search & Research | Perplexity, Glean, Consensus, Elicit |
| `ml_platform` | ML Platform | Hugging Face, Replicate, Groq, OpenRouter, Azure OpenAI |
| `data_analysis` | Data Analysis | Julius, Hex Magic, ThoughtSpot Sage |
| `productivity` | Productivity | Notion AI, Gamma, Canva Magic Studio |
| `translation` | Translation | DeepL, Lilt, Smartling |
| `customer_support` | Customer Support | Intercom Fin, Ada, Sierra, Decagon |
| `browser_extension` | Browser Extension | Monica, Merlin, Sider, HARPA, MaxAI |
| `other` | Other | anything that fits none of the above |

On the Shadow AI page:

- A **category badge** appears beside each tool name in every section. Discoveries that matched nothing in the registry show **Uncategorized**.
- The **By Category** panel rolls up discoveries per category. Click a chip, or use the **Filter** select, to narrow the Needs Review, Low-Confidence and Resolved sections to one category (**Uncategorized** is its own filter). The rollup itself always reflects the whole page.
- The **Category** select on a Needs Review card lets a reviewer set or clear the category by hand. It goes through `PUT /api/discovered-tools/{id}` with `{ "category": "<id>" | null }`, is validated against the closed set, and writes an `UPDATE_CATEGORY` audit entry. `GET /api/discovered-tools?category=<id>` (or `=uncategorized`) filters server-side.

Rows created before categories existed have `category = NULL`. Scans and imports backfill it the next time they observe the tool (never overwriting a value already present), or an administrator fills every row at once:

```bash
npx tsx scripts/backfill-tool-categories.ts --dry-run   # report what would change
npx tsx scripts/backfill-tool-categories.ts             # write categories
```

The registry also carries **risk hints** per tool — `trains_on_data`, `consumer_grade`, `china_hosted`, `no_enterprise_tier` — as reviewer context for the approve/block decision. They are informational and do not change scores.

### Confidence Scoring

Every discovered tool is assigned a match confidence level based on how it was identified:

| Confidence | Score Range | Meaning |
|-----------|-------------|---------|
| **High** | 10+ | Strong match — domain + name or multiple signals confirmed |
| **Medium** | 6–9 | Partial match — name or publisher matched but not domain |
| **Low** | < 6 | Heuristic match — AI keywords detected (e.g. `.ai` domain, "gpt", "copilot") but no known registry match, or a fuzzy name match alone |

Signals and their weights: exact name pattern **+6**, fuzzy name **+4**, publisher **+4**, domain **+8**, OAuth scope referencing a domain **+3**, app/bundle id **+5**. On an equal score the more specific match wins (a longer name pattern or a longer domain), so "OpenAI Codex" resolves to Codex rather than ChatGPT.

**Fuzzy name matching.** App names from device inventories and OAuth grants rarely match the registry letter-for-letter, so names are also compared loosely:

- Both sides are normalized — lowercased, punctuation dropped, and the filler tokens `ai`, `inc`, `llc`, `app`, `the` removed — and compared token by token.
- Every token of the registry pattern must be covered by a token of the observed name, either exactly or within one edit (Damerau-Levenshtein distance ≤ 1: one insertion, deletion, substitution or adjacent swap) for tokens of five or more characters. Adjacent observed tokens are also tried joined, so "mid journey" covers `midjourney` and "Co-pilot" covers `copilot`.
- A single plain-English word is never enough on its own (`beautiful`, `continue`, `meta`, …); such tools need their multi-word pattern, their domain, or their app id.
- A fuzzy hit adds a `fuzzy_name:<observed tokens>` entry to the match reasons, e.g. `fuzzy_name:perplexty`.
- The publisher/vendor name is never fuzzy-matched. A bare vendor ("Google", "Microsoft") can still register as a publisher signal, but the device-inventory scanners (Hexnode, CrowdStrike) reject publisher-only matches, so Word is not flagged as Copilot.

Confidence, score, and match reasons are stored on each `DiscoveredAITool` record and displayed in the UI.

### Triage Workflow

A discovered tool moves through:

`DISCOVERED` → `UNDER_REVIEW` → `REGISTERED` / `APPROVED` / `BLOCKED`

The Shadow AI page splits discoveries into three sections:

1. **Needs Review** — high-confidence matches and legacy tools (no confidence data). These are confirmed AI tools that need a governance decision.
2. **Low-Confidence Candidates** — medium and low-confidence matches from heuristic detection. Each candidate shows its confidence badge, numeric score, and match reasons. Actions:
   - **Promote** — confirms the tool as a real AI discovery and moves it to the main "Needs Review" queue with high confidence.
   - **Dismiss** — removes the tool from the queue with a required reason. Creates a `DismissedCandidate` record that prevents the tool from resurfacing on future scans. Dismissed candidates are shown as a count at the bottom of the page.
3. **Resolved** — tools that have been registered, approved, or blocked. A tool marked **Blocked** shows an **Unblock** action here, which moves it back to `UNDER_REVIEW` for re-evaluation — useful for reversing an accidental block or a policy change without deleting the record.

**Guided review.** Each row in "Needs Review" has a **Review** button, and **Start triage** in the section header opens the first tool in the queue. The review has three steps:

1. **Understand** — the vendor, domain, category, how it was found, first and last seen, the users observed, the OAuth scopes granted (broad ones such as Drive, Gmail, Calendar or Mail are highlighted), why it was matched, registry flags (for example "the consumer tier trains on prompts" or "data is processed in China"), and the vendor's governance status. **Start review** moves the tool to `UNDER_REVIEW` so colleagues can see someone is handling it.
2. **Assess** — three questions: the most sensitive data people put into it, whether there is a real business need, and whether an already-approved tool does the same job. "Don't know" is a valid answer.
3. **Decide** — a suggested outcome with its reasons, then your choice:
   - **Register as an AI system** — **Register with guided setup** opens the registration wizard pre-filled from the discovery. **Quick register & assess** creates the system directly and opens the risk assessment.
   - **Approve without registering**, **Block** or **Dismiss** — each needs a short reason. The reason and your three answers are stored in the audit log with the status change.

   The suggestion is block when the vendor's security review was rejected, when there is no business need, when an approved alternative exists and company data is involved, or when customer data goes into a tool flagged for training on prompts or China hosting. It is register when customer data is involved, nobody knows what data goes in, or the tool holds broad OAuth scopes. It is approve only when there is a business need and no company data. Everything else defaults to register.

After a decision the review shows what happened. For a block, that means whether the domain is on the blocklist feed and what the identity-provider enforcement did. **Next in queue** moves straight to the next tool.

The quick actions stay on each row for reviewers who already know the answer:

- **Convert to Governed System** — opens the guided registration with every field pre-populated (see *AI-assisted auto-fill* below).
- **Register & Assess** — auto-creates an AISystem with AI-inferred fields (use case, model type, data inputs / outputs, risk level, sensitivity) and routes directly to the risk assessment form.
- **Approve** — permit its use without adding to the Registry.
- **Block** — mark the tool as not allowed. This records the decision *and*, where an enforcement layer is configured, actually enforces it — see [Enforcing a Block](#enforcing-a-block) below.
- **Dismiss** — suppress the discovery with a required reason (e.g. "false positive", "approved shadow usage", "not an AI tool"). Same mechanism as low-confidence dismissal — a `DismissedCandidate` record is created and future scans will not resurface it.

New high-confidence discoveries auto-create alerts for admins to triage. Dismissed candidates are permanently suppressed — the scan executor checks the `DismissedCandidate` table before creating new records.

### Enforcing a Block

UrNammu is not in your network path, so a `BLOCKED` status only stops something if one of two enforcement layers is wired up. Both are optional and they cover different gaps.

**Network layer — blocklist feed.** Blocked tools' domains are published on an authenticated feed that an external control polls and enforces:

```
GET /api/discovered-tools/blocklist?format=hosts
Authorization: Bearer <feed token>
```

Formats: `text` (bare domains, default), `hosts` (`0.0.0.0 domain`), `json` (with metadata), and `pac` (proxy auto-config). Point a DNS sinkhole, proxy ACL, firewall URL list, or CASB at it. Responses are briefly cacheable but must revalidate, so an unblock propagates in about a minute.

Generate the token in **Settings → Shadow AI**. The feed **fails closed**: with no token set it returns `503` rather than serving an unauthenticated list of what your organization blocks.

**Identity layer — disable the app at the IdP.** Where a tool is federated to Google Workspace or Microsoft 365 and the scan captured an app handle, blocking disables the app so sign-ins stop. Outcomes you may see:

| Result | Meaning |
|--------|---------|
| `blocked` / `unblocked` | Access disabled or restored at the IdP. |
| `skipped` | No app handle was captured, so there is nothing to target. |
| `not_configured` | That provider integration is not set up. |
| `unsupported` | The provider cannot be enforced programmatically yet. |
| `failed` | The IdP call errored — most often a missing admin permission. |

Microsoft app-disable requires admin consent for the app-management Graph permission. Without it you get `failed`, not silence.

**Settings → Shadow AI** shows a readiness summary for both layers. If neither is configured, a block remains a documented, auditable decision — and nothing more. Knowing which of those two situations you are in matters.

### AI-assisted auto-fill on conversion

When you click **Convert to Governed System** or **Register & Assess** on a discovered tool, UrNammu uses the configured AI provider to infer governance-relevant fields from the tool name, vendor, and domain:

- Description
- Use case
- Model type (e.g. "LLM", "Code completion", "Image generation", "RAG platform")
- Data inputs / outputs
- Risk level (`CRITICAL` … `MINIMAL`)
- Data sensitivity (`RESTRICTED` … `PUBLIC`)

While the AI assistant is working, a floating "**Analyzing {toolName}**..." banner appears in the bottom-right of the Shadow AI page and the button label flips to "Analyzing..." / "Classifying..." (disabled to prevent double-clicks). The banner auto-dismisses when the destination page loads.

For the **Convert to Governed System** path (and **Register with guided setup** in the guided review), the registration wizard opens with every inferred field pre-populated and a green "**AI-assisted**" banner at the top showing the model's reasoning. You can review and edit anything as you go through the steps, and the discovery is linked to the system when the first step saves.

For the **Register & Assess** path, the system is created directly with the AI-inferred values. The audit log records which fields were AI-inferred plus the model's reasoning, so reviewers always know what was human- vs machine-decided.

If the AI provider isn't configured, times out (12-second limit), or returns unparseable output, the create flow falls back to the previous defaults (generic description, blank optional fields, `MEDIUM` risk, `INTERNAL` sensitivity) — the operation never fails because of AI issues.

---

## 10. Oversight (Telemetry & Cost)

**Sidebar → Governance → AI Oversight** centralizes provider usage, cost, anomaly, model drift, dangerous prompt, vendor, and investigation telemetry. The Governance group also carries a cross-surface **Usage by Person** view and dedicated **per-surface** dashboards — **Claude Platform / API**, **Claude Code**, **Cowork**, and **Cursor** — described below.

### How Provider Sync Works

With Anthropic, OpenAI, or Cursor admin keys or a GitHub Copilot token configured in Settings → Provider Admin APIs, a ChatGPT Enterprise Admin key and the Anthropic Compliance and Claude Enterprise Analytics keys on the Integrations page, plus optional Google Gemini / Vertex AI billing-export settings and any AI gateway keys, each provider's own cron at `/api/cron/provider-sync/<provider>` pulls oversight data once that provider's sync interval has elapsed since its last successful run, and normalizes it into:

- **`UsageBucket`** — tokens / requests per provider / model / project / actor / time bucket.
- **`CostBucket`** — amount and line-item cost, same dimension keys, plus the same attribution columns as `UsageBucket` (API key, workspace, governed system) so cost can be rolled up by system and by key.
- **`AssistantDailyStat`** — one row per person per day (per product for Claude Enterprise) for the assistants (Claude Code analytics from the Anthropic Admin API, Cursor from the Cursor Admin API, GitHub Copilot from the Copilot usage metrics reports, Claude Enterprise chat / Claude Code / Cowork / Design / Office from the Analytics API) and for ChatGPT Enterprise (`chatgpt`: messages sent and conversations per day; `codex`: prompts, sessions, tool calls, tokens, cost): sessions, requests, lines added / removed / accepted, commits, PRs, tool accept / reject, tokens, and cost as columns. This is what the Claude Code, Cursor, and GitHub Copilot dashboards, Usage by Person, and the Usage by Person report read. The syncs still write the older per-day `UsageBucket` rows with the same data as metadata JSON for one more release.
- **`ComplianceActivity`** — immutable auth, admin-audit, and API-key lifecycle events from provider compliance feeds (ChatGPT Enterprise `AUTH_LOG` / `AUDIT_LOG`, provider `openai`; the Anthropic Compliance API activity feed, provider `anthropic`), keyed by the upstream event id. Metadata only: actor, IP, user agent, action, and action data — never message content.
- **`ComplianceSession`** — Claude app session metadata from the Anthropic Compliance API (product surface, person, workspace, timestamps) — never transcripts.
- **`ProviderSyncWatermark`** — one row per provider or incremental stream (for example `cursor`, or `chatgpt_enterprise:AUTH_LOG`) recording the instant the provider or stream has been ingested through, so each scheduled run resumes where the last one stopped and Backfill knows how far back history already reaches; the Anthropic compliance feed also keeps its `after_id` cursor here while a page-capped first pull drains.
- **`ProviderProject`** / **`ProviderActor`** — discovered workspaces (Anthropic Console workspaces, OpenAI projects, LiteLLM teams) and members.
- **`ProviderSyncRun`** — a record of each sync attempt (status `RUNNING` / `SUCCEEDED` / `FAILED`).
- **`ComplianceActivity`** / **`ComplianceSession`** — the Anthropic Compliance API activity feed and Claude app session metadata (see below).
- **`ProviderSyncWatermark`** — per provider, how far the incremental pull has reached and the earliest day ingested.

Each provider is gated on its own credentials. **If a provider's admin key (or billing-export config, for Gemini) is not set, that provider is skipped** — no `ProviderSyncRun` row is created and no upstream API call is made. The manual-sync panel surfaces this explicitly as "Skipped (not configured): …" so it is clear which providers are active and which are simply not configured yet.

**Incremental windows.** Every sync pulls an explicit `{ from, to }` window rather than a fixed "last 7 days". The window is derived from the provider's **watermark** (`ProviderSyncWatermark` — the last UTC day fully ingested, plus the earliest day ever ingested):

- `from = max(watermark − overlap days, now − max lookback)`, snapped to UTC midnight; `to = now`.
- **Overlap** (default 2 days, `provider_sync_overlap_days`) re-pulls the most recent days so late-arriving usage and cost corrections are picked up.
- **Max lookback** is per provider: Cursor 30 days (its API retention), Anthropic / Claude Code / OpenAI / Gemini 90 days, gateways (Helicone, OpenRouter, Portkey, LiteLLM) 30 days.
- A provider with **no watermark yet** (fresh install) starts at `now − min(max lookback, 31 days)`, so a new database captures Cursor's full 30-day history on its first scheduled run. Deeper history is pulled with **Backfill**.
- The watermark advances only after a run succeeds, so a failed run is retried over the same window next time. Bucket writes are idempotent upserts, so overlapping windows never double count — deleting a week of `UsageBucket` rows and re-running the sync restores them.

**Backfill.** **Settings → Provider Admin APIs → Sync History & Backfill** shows each provider's "history from" / watermark dates and lets an admin pull older history: pick a provider and a UTC date range, and the browser walks the range in 7-day chunks, one `POST /api/admin-sync { provider, from, to }` per chunk (so no single request outruns its function budget), with a per-chunk log and a Cancel button. A single request may cover at most 31 days. Backfilling an older range never moves the watermark backwards; it only extends "history from".

**Truncation.** Every paginated upstream read reports `{ pages, truncated }` into the sync run's `metadata.pagination` — Anthropic usage/cost reports and key/member lists (`has_more`), OpenAI `next_page`, Helicone 20 × 500-row pages, Portkey 20 × 100-row pages per day, Cursor daily-usage (50 pages) and usage-events (200 pages), Claude Code analytics (50 pages per day), and the Gemini BigQuery `LIMIT 5000`. When a cap is hit the run is marked `truncated: true` and a **`provider_sync_truncated`** alert (MEDIUM) is raised, deduplicated per provider for 24 hours. The window is under-counted; re-run a Backfill over a narrower range for that period.

What each sync contributes:

- **Anthropic Admin API** — organization usage per model, API key, and **workspace**, cost per workspace, model, and cost type (the Anthropic cost report cannot be grouped by API key, so per-key spend is available only at workspace granularity; the organization's default workspace is labelled "Default workspace"), the workspace list (stored as `ProviderProject` rows), plus the **Claude Code analytics** feed (per-developer sessions, lines, commits, estimated cost) used by Usage by Person when a machine has no OTel data.
- **OpenAI Admin API** — usage per model / project with prompt-cache hits recorded as `cacheReadTokens` (OpenAI's `input_cached_tokens`), request counts (`num_model_requests`), and cost. Both the usage and cost endpoints are paginated; the sync follows the cursor up to a page cap and records the page count and any truncation in the sync-run metadata (see **Truncation** above).
- **Cursor Admin API** — per-user, per-day requests, tokens, accepted lines, and charged spend. Cursor's OTel hook does not carry tokens or cost; this sync is where they come from.
- **GitHub Copilot usage metrics** — the report-based API (`X-GitHub-Api-Version: 2026-03-10`): `users-1-day` → one `AssistantDailyStat` per developer per day (`requests` = explicit interactions, `linesAdded` / `linesAccepted` = Copilot-produced lines that landed, `linesRemoved`, `toolAccepted` = accepted generations, CLI / Copilot-app sessions and tokens; feature, IDE, model, language, third-party-agent breakdowns and `ai_credits_used` in metadata); `organization-1-day` (or `enterprise-1-day`) → one `UsageBucket` per day with DAU / WAU / MAU and pull-request metrics in metadata; `GET …/copilot/billing/seats` → `ProviderActor` rows with `last_activity_at`. The actor is the seat's email when GitHub exposes one, otherwise the lower-cased login. The sync walks day by day from the watermark — never the current (partial) UTC day, at most 28 days per run (older days in a longer window are reported as skipped/truncated so Backfill can pull them) — and a day GitHub has not published yet (reports land within two full days) is recorded as *pending* and holds the watermark back so it is retried next run. Copilot is seat-licensed: `estimatedCost` is always null and no `CostBucket` is written.
- **ChatGPT Enterprise Compliance API** — workspace users (`ProviderActor`, provider `chatgpt`, with role and status), auth and admin-audit events (`ComplianceActivity`), per-user daily ChatGPT message counts and Codex activity (`AssistantDailyStat` providers `chatgpt` and `codex`), and alerts for admin-role grants and new GPTs with custom actions. Log streams (`AUTH_LOG`, `AUDIT_LOG`, `CONVERSATION_MESSAGE`, `CODEX_LOG`, `CODEX_TURN`) each keep their own cursor; a stream the key is not scoped for is skipped and listed under `unauthorizedStreams` in the sync-run metadata. Conversation and prompt content is never read into UrNammu — only counts, identifiers, models, and token totals.
- **Portkey** — one `UsageBucket` + `CostBucket` per day per model, and one `UsageBucket` per day per user (dimension key `partition=actor`). Portkey reports cost in cents; the sync converts to USD and stores a `reconciliation` block (graph total vs. summed per-model and per-user totals) in the sync-run metadata so the unit assumption can be checked against the Portkey console.
- **Helicone, OpenRouter, LiteLLM** — gateway request and cost records normalized into the same buckets.
- **Gemini / Vertex AI** — spend and best-effort project attribution from the BigQuery billing export.
- **Anthropic Compliance API** — the organization's Activity Feed (API-key lifecycle, logins, Compliance API reads, SCIM syncs) as `ComplianceActivity` rows keyed by upstream id, and — with a Compliance Access Key holding `read:compliance_user_data` — Claude Code, Cowork, and Office add-in session metadata as `ComplianceSession` rows (product surface, person, workspace, timestamps; transcripts are never pulled). The feed is newest-first, so each run re-reads everything newer than its watermark with a 6-hour overlap and resumes any page-capped backfill from the stored cursor. Governance rules over new activities raise `anthropic_compliance` alerts: API key created by an actor UrNammu has never seen, API key created outside 07:00–19:00 in the organization timezone (`org_timezone`), Compliance API read from a key never seen before, and a login from a new country when the feed reports one. New keys are also registered as `ApiKeyProfile` rows for the key-usage rules. The Admin API key serves the feed on its own; the dedicated key adds sessions.
- **Claude Enterprise Analytics API** — per-user daily activity per product (Claude.ai chat, Claude Code, Cowork, Design, Office add-ins) into `AssistantDailyStat` (`provider = "claude_enterprise"`, one row per person × day × product), DAU / WAU / MAU / seats / pending invites per day into `UsageBucket` (`dimensionKey "org_summary|…"`), and the per-user usage and cost reports into `UsageBucket` / `CostBucket` with the person's email as the actor (cost arrives in fractional cents and is stored in USD). Data lags about a day and cost is revised for up to 30 days, so each run re-pulls the 3 days behind its watermark up to yesterday.

**Proxy traffic appears immediately.** Requests routed through the Anthropic or OpenAI proxy (Vercel fallback or Azure Functions) upsert hourly `UsageBucket` / `CostBucket` rows in real time, linked to a synthetic `ProviderSyncRun` with `syncType = "proxy_live"`. You do not need to wait for the admin-API sync interval to see proxy usage on the Oversight dashboard, spend budgets, or per-system Telemetry tab — it shows up on the next page refresh.

**Proxy token accounting.** All four proxy paths (Vercel Anthropic, Vercel OpenAI, Azure Anthropic, Azure OpenAI) record prompt-cache tokens with one convention: `inputTokens` / `promptTokens` is **all** input (uncached + cache read + cache creation) and `cacheReadTokens` / `cacheCreationTokens` are the breakdown. Cost = uncached × input price + cache read × cache-read price + cache creation × cache-write price + output × output price, from a single pricing table (exact model id first, then model family). A model missing from the table is **not** charged a default: cost is stored as `0` and the usage row's metadata carries `pricingMatched: false`, so an unpriced model shows up as a $0 row you can spot rather than a wrong number. OpenAI **streaming** calls through the proxy now record usage and run response DLP (the proxy requests OpenAI's trailing usage chunk when the client did not ask for it, and strips it again before it reaches the client). Proxy rows also carry the provider `requestId` and the attributed `aiSystemId`, which session traces join on. Anthropic `/v1/messages/count_tokens` and `/v1/messages/batches` pass through without producing usage rows.

If traffic also flows through the built-in OpenAI or Anthropic proxy, Oversight can attach prompt-risk findings to recent activity and alerts using redacted excerpts and category labels.

### Overview Page

- Total tokens and total cost (rolling 7 and 30 days).
- Breakdown by provider / model / project.
- Data-exposure summary — usage attributed to high-sensitivity systems.
- Anomaly, model-drift, and dangerous-prompt findings with recommendations.
- Budget status cards.
- Remediation rollups across alerts, incidents, investigations, and corrective follow-up.
- **Cost by Governed System (30 days)** — provider-reported spend rolled up by the registered AI system it resolves to, with the share of total spend that is attributed and an "Unattributed" remainder. Mappings are configured in Settings → Provider Admin APIs → Usage Attribution (see [13.2](#132-provider-admin-apis)).
- **Cost by API Key (30 days)** — per-key spend where the provider reports it (OpenAI, LiteLLM, and the gateways). Anthropic reports spend per workspace, so its rows are workspaces (badge `workspace`). Each row shows the governed system it maps to, or `unmapped`.

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

Each dangerous prompt alert stores structured metadata: provider, model, department, user, matched categories, matched signal phrases, and a sanitized excerpt (full prompt bodies are never stored). On the Alerts page, dangerous prompt alerts render this as a structured investigation card with:

- **Provider and model badges** for at-a-glance context
- **Category badges** color-coded by severity (critical vs. warning)
- **Matched signals** shown as highlighted code elements — the exact phrases that triggered the rule
- **Sanitized excerpt** in a monospace block for context
- **Related API usage logs** — an expandable panel showing flagged APIUsageLog records within a ±5 minute window
- **Same prompt, other sightings** — when the identical prompt (matched by a salted hash, never the text) was seen again while the alert was open, the card reads "Seen N times across …" with the surfaces (API proxy, Claude Code, Cursor) and people involved, and lists other alerts that carry the same prompt. Repeats within 24 hours fold into the open alert instead of raising a new one.

### False Positive Marking

When investigating a dangerous prompt alert, if the signal is benign (e.g. a legitimate security test, developer workflow, or overly broad pattern match), you can mark it as a **false positive**:

1. Click **False Positive** on the alert (replaces the Dismiss button for prompt risk alerts).
2. Enter a **reason** explaining why this is a false positive.
3. Optionally check **Create exception** to suppress similar future alerts. This creates a `PromptRiskException` for each matched rule category.
4. The alert is automatically dismissed and tagged with a "False Positive" badge in the history.

Exceptions are managed at **Alerts → Manage prompt risk exceptions** (`/alerts/exceptions`). Each exception can be deactivated or reactivated. Exceptions suppress alert creation only — the full prompt risk analysis is still logged on every APIUsageLog record for audit purposes. An alert is only suppressed when all its matched categories are covered by active exceptions.

### Tuning Detection Rules

The dangerous-prompt engine is fully tunable at **Alerts → Tune detection rules** (`/alerts/prompt-rules`). Admins can edit built-in rules, create custom ones, and dry-run prompts against the live ruleset before saving changes.

Five built-in rules are seeded on install:

| Key | Default Severity | What it matches |
| --- | --- | --- |
| `prompt_injection` | warning | jailbreak and system-prompt exfiltration attempts |
| `secret_extraction` | critical | credential / API-key / secret extraction |
| `data_exfiltration` | critical | attempts to pull restricted or regulated data |
| `malware_or_phishing` | critical | malware, phishing, or attack-tool generation |
| `dangerous_autonomy` | warning | unsafe autonomy, unchecked tool use, escalation |

Each rule has:

- A stable **key** (e.g. `prompt_injection`) — referenced by `PromptRiskException` rows, so it is **immutable** once created.
- A **label** shown to reviewers and a free-form **description**.
- A **severity** — `critical` produces `CRITICAL` alerts, `warning` produces `HIGH` alerts.
- Up to **10 regex patterns**, matched case-insensitively against user-authored prompt text only. Assistant, tool, and system content are never scanned.

**Built-ins** can be edited, disabled, or reset to their original definition, but cannot be deleted. The "Reset" action restores the seeded label, severity, and patterns from snapshot columns on the rule row.

**Custom rules** can be created with fresh keys (lowercase alphanumeric + underscore, 3–40 chars) and deleted when no longer needed.

#### Pattern Safety

Patterns are validated on save:

- Each pattern must compile as a JavaScript regex.
- Each pattern is limited to 500 characters.
- Obvious ReDoS shapes (e.g. `(.*)+`, `(\w+)+`, `(a|a)+`) are rejected.
- A short probe string is run against each pattern; any pattern that takes longer than 50 ms is rejected.

#### Rule Propagation

The proxy loads active rules via a 30-second in-memory cache. Mutations (create, update, delete, reset, enable/disable) invalidate the cache immediately, so new rules take effect on the next proxy request. In the worst case — no mutations — a rule change takes at most 30 seconds to propagate.

#### Test a Prompt

The **Test a prompt** panel on the rules page dry-runs a prompt against the current enabled ruleset without creating an alert. It wraps the input as a user message and applies the same extractor guards the proxy uses, so the result exactly mirrors what would happen at runtime. Use it to:

- Confirm a new pattern fires on intended prompts.
- Verify an edited built-in still catches the baseline cases.
- Check that an exception, disabled rule, or redacted phrase no longer triggers.

### Vendor Governance

**Oversight → Vendors** tracks each AI vendor's contract, security review and risk. A vendor appears on the list as soon as an AI system or a shadow AI discovery names it, but it has no governance profile until someone sets one up. Each row shows onboarding progress and a **Continue setup** (or **Set up profile**) button that opens the next step.

**Adding a vendor.** Click **Add vendor** (admins and compliance officers). The first step asks for the name, website, a short description and, optionally, the contract owner. Suggestions come from vendor names already used by systems and discoveries, so use the same spelling and they link up. If the vendor already has a profile, the wizard opens it instead of creating a duplicate.

**Completing the profile.** The setup wizard walks through five steps. Each step saves when you move on, so you can stop and come back:

1. **Identity** — website and description. The vendor name can't be changed afterwards, because systems and discoveries link to it by name.
2. **Contract** — owner, status (`UNKNOWN` / `IN_REVIEW` / `ACTIVE` / `EXPIRED` / `TERMINATED`), start and renewal dates, and the renewal-notice window (default 60 days).
3. **Data** — data residency regions and subprocessors.
4. **Use cases** — approved use cases (the use cases of systems already using the vendor are offered as suggestions) and any conditions.
5. **Review** — a summary with each step marked complete or with gaps.

**Vendor risk questionnaire.** On the vendor page, **Start questionnaire** opens 19 questions in five sections: security assurance (SOC 2, ISO 27001, pen testing, breach notice), data handling (training on your data, retention, encryption, human review, residency), access & monitoring (SSO, SCIM, audit logs), AI-specific controls (model disclosure, subprocessors, safety filtering, AI governance framework) and legal (DPA, BAA, IP indemnity). Each answer is Yes / Partly / No / Don't know, plus Not applicable where it makes sense, with an optional evidence note. Answers save as you move between sections, and a running score (0–100, higher is riskier) updates as you go. Unanswered questions count as "Don't know", so skipping never lowers the score. A risky or "Don't know" answer to a key control (training on your data, encryption, DPA), or leaving one unanswered, puts the vendor at HIGH or above, whatever the total.

The last step lists the findings, suggests a decision and asks you to **Approve**, **Approve with conditions** (conditions required) or **Reject**. Completing the questionnaire locks it and sets the vendor's security review status to your decision. Starting one moves a never-reviewed vendor to `IN_PROGRESS`. To re-assess later, start a new questionnaire; earlier ones stay in the vendor's history. A HIGH or CRITICAL questionnaire result adds to the vendor's composite risk score.

**Vendor page.** Clicking a vendor opens its page. It has an onboarding checklist (identity, contract owner, contract status and renewal date, data, use cases, a questionnaire completed within the last 12 months, and a security review decision), the profile, risk drivers, the AI systems using the vendor, flagged unapproved use cases and the questionnaire history. Each unfinished checklist item links straight to the step that completes it. Viewers see the same page read-only.

Renewal alerts fire automatically once a vendor enters its renewal-notice window.

### Investigations

**Oversight → Investigations** is the follow-up queue for alerts and incidents.

Create an investigation from an alert (preferred) or manually:
- **Title**, **summary**, **owner** (user).
- **Linked alert / incident / system** (optional).
- Status: `OPEN` → `IN_PROGRESS` → `RESOLVED`.
- Add **notes** over time, and a **resolution summary** when closing.

### Claude Platform / API

**Governance → Claude Platform** has two tabs. **Console & API** is the organization-level view of direct Anthropic API usage, sourced from the **Anthropic Admin API sync** (normalized into `UsageBucket` / `CostBucket`, with discovered API keys and org members). It shows:

- Stat cards: total cost, total tokens (with cache broken out), cache-hit rate, requests, active API keys, and org members.
- Daily usage & cost trend (30 days).
- Cost by model and cost by line item (uncached input, cache read, cache creation, output).
- Tokens by model table.
- **Cost by workspace** — spend per Anthropic Console workspace (the default workspace appears as "Default workspace"); the **Active API Keys** card notes how many workspaces the keys span.
- **Usage by API key** — per-key token counts, requests, and active/inactive status.
- **Organization members** list with roles.
- A sync-health banner (last successful sync, fresh/stale, errors).

The **Enterprise** tab (`/oversight/claude-platform?tab=enterprise`) covers the Claude Enterprise seats, from the Analytics and Compliance API syncs:

- Stat cards: daily / weekly / monthly active users and the date they refer to, seats (with pending invites or the share of seats active this month), Enterprise cost and people with activity in the window, and open `anthropic_compliance` alerts (the tab label carries a count).
- **Daily active users** — the last 14 days of DAU with WAU alongside.
- **Active users by product** — 30-day and 7-day active users, messages, and cost for Claude.ai chat, Claude Code, Cowork, Design, and the Office add-ins.
- **Top people by Enterprise cost** — with active days and the products they used; the full per-person picture is in Usage by Person.
- **Claude app sessions** — sessions and people per product surface from the Compliance API session metadata (needs a Compliance Access Key with `read:compliance_user_data`).
- **Activity feed** — count per activity type over the window and the newest activity time.
- **Sync health** for both the analytics and the compliance syncs, including how far back history goes.

### Claude Code Oversight

**Governance → Claude Code** shows telemetry from **Claude Code itself**, collected over OpenTelemetry (OTLP/HTTP) from MDM-deployed Claude Code hooks rather than the admin API. (See [Background Automation](#15-background-automation) and the install guide for the OTel pipeline.) It shows:

- **Live telemetry (last 60 minutes)** — data points, active sessions, active users, cost, and input/output/cache tokens.
- **Usage & event activity** — tool accept/reject rate, completions, and a decision breakdown.
- **Cost attribution** — per-user and per-model cost summaries estimated from token metrics.
- **OTel event log** — recent user prompts, tool invocations, completions, and API errors.
- **Users (last 7 days)** — per-developer sessions, lines, commits, PRs, accept rate, tokens, and estimated cost from OTel. Developers with no OTel data in the window are filled in from the Anthropic Admin API analytics sync (`AssistantDailyStat`) and marked *est.*, so people whose machines are not instrumented still appear. OTel wins whenever both exist for a person.
- **User filter** — scope the whole page to a single developer (`?user=email`); the dropdown is populated from the last 7 days.

Prompt and code text are stripped at ingest — only metadata, decisions, and dangerous-prompt verdicts are stored. Click through to the full audit log below.

#### Claude Code Audit Log

**Governance → Claude Code → (Recent events / "View all")** opens a searchable, filterable, paginated table of individual OTel events (default 30-day retention):

- Columns: timestamp, event name, risk severity & category, surface/entrypoint, user email, detail excerpt, and session ID.
- Search by user, session, tool, model, error type, decision, or event name.
- Filter by event type, risk level (flagged/critical/warning), and surface.

#### Session Traces

**Governance → Claude Code → Session Traces** reconstructs an individual session as turns, model calls, and tool use in execution order, rendered as a waterfall. It answers "what actually happened in this session", which the flat event log cannot.

- Each span carries a status of `ok`, `error`, `denied`, or `flagged`, so a denied tool call or a policy block is visible in place.
- Turns are summarized, and long idle gaps are compressed in the rendering so a session someone left open over lunch stays readable.
- Traces cover a rolling 30-day window and are paginated.

Two caveats worth knowing before you use durations as evidence:

- Spans are **derived from event timing**, not emitted as spans by the client. Treat them as close approximations, not instrumented measurements.
- As everywhere in this pipeline, traces are metadata only — no prompt text and no code content.

### Cowork Oversight

**Governance → Cowork** is the same analytics view as Claude Code, scoped to the **Claude Cowork / Desktop (local-agent) surface** only. Use it to see Cowork session activity, decisions, per-user cost, and recent events separately from terminal Claude Code usage.

### GitHub Copilot Oversight

**Governance → GitHub Copilot** shows the last 28 days of Copilot activity from the usage metrics sync (Copilot has no OTel hook; everything here comes from the reports). It shows:

- Stat cards: active developers vs assigned seats, lines accepted (with lines suggested), acceptance rate (accepted ÷ generated code activities), and interactions (with CLI / Copilot-app tokens and AI credits when reported).
- **Organization adoption** — the latest synced organization day: daily / weekly / monthly active users, chat and agent users (28d), seats, and the AI adoption phase distribution across developers.
- **Pull requests** — created, created by Copilot, merged, Copilot-authored merges, reviewed by Copilot, and applied review suggestions summed over the window, plus the latest day's median minutes to merge.
- Breakdowns **by feature** (`code_completion`, `chat_panel_agent_mode`, `agent_edit`, `copilot_cli`, …), **by IDE**, **by model**, and **by language**, each with lines accepted, acceptance rate, and user count.
- **Third-party agents via Copilot** — agent apps (Claude, Codex, …) used through the Copilot seat; check they are registered AI systems.
- **Developers** — per-developer lines, prompts, acceptance rate, active days, last active day, IDEs, and adoption phase (clickable to filter). Developers keyed by GitHub login (no seat email) appear as `@login`.
- **Idle seats** — assigned seats with no activity for 30+ days (from the seats endpoint's `last_activity_at`), candidates for reclaiming or an access review.
- **Daily activity** — the last 14 synced days with the sync status, watermark, and any days GitHub has not published yet.

### Cursor Oversight

**Governance → Cursor** shows Cursor telemetry from the Cursor OTel hook (spans + metrics), plus tokens, requests, spend, and "lines produced" data from the **Cursor Admin API** when configured. The OTel hook itself carries no token or cost data, so without the Admin API sync this page is activity-only. It shows:

- Stat cards: live spans (60m), active sessions/users (7d), tool calls, risk flags, and spend (7d).
- Top tools, activity by hook event, and most-active users (clickable to filter).
- Span durations (average / slowest) and recent prompt-risk verdicts.
- **Lines produced (7d)** — per-user accepted/added/deleted lines and active days (requires the Cursor Admin API team key).
- Recent spans list.

The Cursor Admin API sync writes one `AssistantDailyStat` row per developer per day — requests, lines added / deleted / accepted, whether Cursor marked the seat active, tokens, and charged spend from the usage-events feed. **Lines produced** and **Usage by Person** read those columns; a seat with no active days in the window is left out rather than shown as zeros.

### Usage by Person

**Governance → Usage by Person** is the cross-surface answer to "who is using what, and what does it cost?" — one row per human, merged by lower-cased email, across:

- **Claude Code** and **Cowork** — live OTel metrics. Cowork is the Claude Desktop `local-agent` surface; everything else counts as Claude Code, so the two columns never overlap. When a person has no OTel data in the window, the Anthropic Admin API analytics sync (`AssistantDailyStat`) fills in sessions, lines, commits, and an estimated cost (marked *est.*), so people whose machines are not instrumented still appear.
- **Claude Enterprise** — the Claude Enterprise Analytics API sync (`AssistantDailyStat`, provider `claude_enterprise`): active days, messages, tokens, and cost across Claude.ai chat, Cowork, Design, and the Office add-ins (about a day behind). The Claude Code product is deliberately left out of this column because Claude Code already has its own; cost shows as *n/a* until the per-user cost report has landed for the window. The surface chip opens the Claude Platform Enterprise tab.
- **Cursor** — the Cursor Admin API sync (`AssistantDailyStat`): requests, tokens, accepted lines, active days (only days Cursor marks the seat active), and per-user spend. When the usage-events feed returned nothing for the synced window, Cursor cost shows as *n/a* rather than zero.
- **GitHub Copilot** — the Copilot usage metrics sync (`AssistantDailyStat`): interactions, CLI / Copilot-app tokens, accepted lines, and active days. Copilot is seat-licensed, so it never contributes to a person's cost. A person is matched by the seat's email when GitHub exposes one; seats keyed only by GitHub login stay in *unattributed* until an identity source maps the login to an email.
- **API (proxy)** — Anthropic and OpenAI calls made through the governance proxy, attributed by the `x-user-email` header, plus a count of flagged requests.

The page shows:

- **Stat cards** — people with activity, attributed cost, average cost per person, and **unattributed cost** (usage with no email identity: anonymous proxy calls, API-key actors, un-tagged OTel clients). Unattributed usage is kept out of the table and totalled separately so the per-person figures never silently absorb it.
- **By surface** — cost, people, and tokens per surface, with any unattributed remainder called out.
- **People table** — sortable and searchable (name, email, department), with a surface chip per person that opens the corresponding dashboard filtered to them, and **Download CSV** for the full column set (per-surface cost, tokens, sessions, lines, commits, requests, flags, last active).
- **Window** — 7 / 30 / 90 days.
- **Save as report** (`ADMIN` / `COMPLIANCE_OFFICER`) — creates a report from the *Usage by Person* template so the same data can be exported as PDF/CSV/JSON and scheduled for email delivery (see [Reports](#11-reports)).

When a **directory sync** is enabled (Settings → Users & Identity), every observed email is first resolved through the identity provider's alias map, so one person seen under two addresses is one row keyed by their primary address, and name and department come from the directory. Otherwise they come from the person's UrNammu user profile when one exists, then the provider's member directory. Each row carries a directory status (`active` / `deactivated` / `unknown`, also a CSV column); a **Deactivated** badge marks someone whose directory account is disabled but who still shows usage — the same condition that raises a `usage_after_deactivation` alert. Anthropic Console usage is reported per API key, not per person, and is intentionally excluded — use **Claude Platform** for that view.

### Proxy Health

**System → Proxy Health** is a live-ops board for the Azure Functions AI proxy. It auto-refreshes every ~15 seconds and keeps a 1-hour history.

- **Heartbeat tiles** (from Azure Monitor): invocation count, HTTP 2xx/4xx/5xx distribution, average response time, last sync error, and time-since-last-activity (turns "stale" after an hour of silence).
- **Live 15-minute counters** (read straight from the database, independent of Azure Monitor): API usage count, flagged count, and policy-denial count.
- **Sparklines** of invocations, 5xx errors, and response time over the last hour.
- **Recent API logs** — the 10 most recent proxy requests with provider, model, department, tokens, cost, flag status, and user.

Azure Monitor snapshots are pulled every 15 minutes by the `/api/cron/proxy-health` job and on demand with the admin **Sync now** button. The metrics card header shows **Last synced N min ago**, turning amber when a scheduled run appears to have been missed and red after an hour without a snapshot. Configure the subscription/resource group/function-app/region and service-principal credentials in **Settings → Integrations → Azure Monitor**; until all three identifiers are set the scheduled job skips.

### Provider Posture Comparison

**Oversight → Provider Posture** gives a side-by-side comparison of every AI provider used in the organization. The page shows:

- **Summary cards** — active provider count, total 30-day spend, recent incidents, and high-risk system count.
- **Comparison table** — one row per provider with columns for Total Cost, % of Spend, Tokens, Requests, Systems, High-Risk count, Incidents, Exceptions, Alerts, and a computed **Risk Tier** badge (`LOW` / `MEDIUM` / `HIGH` / `CRITICAL`).
- **Sortable columns** — click any column header to sort ascending or descending. Useful for quickly finding the most expensive provider or the one with the most incidents.

The risk tier is calculated from a weighted score: incidents × 10 + alerts × 3 + high-risk systems × 5 + exceptions × 2. Thresholds: ≥ 30 = CRITICAL, ≥ 15 = HIGH, ≥ 5 = MEDIUM, < 5 = LOW.

### Provider Security & Privacy Scan

**Oversight → Provider Security** audits how each configured provider is *set up*, rather than how much it is used. Where Provider Posture asks "what is this provider costing and breaking", this asks "is this provider configured in a way we could defend in a review".

Each provider is evaluated against a rule set, with each result reported as `pass`, `warn`, `fail`, or `UNKNOWN`:

| Rule | Checks |
|------|--------|
| `credentials_encrypted` | Stored credentials are encrypted at rest. |
| `live_credential` | The configured credential actually authenticates. |
| `tls_endpoint` | The endpoint uses TLS. |
| `proxy_secret` | A proxy access secret is configured. |
| `no_training_on_data` | Submitted data is not used for model training. |
| `data_retention` | Prompt/response retention is controlled, or zero/short retention is available. |
| `data_residency` | Data residency is configured. |
| `security_review` | A security review is recorded for the vendor. |
| `contract_status` | Contract posture is current. |
| `subprocessors` | Subprocessors are documented. |

`UNKNOWN` is meaningful and is not the same as a pass: it means the scan could not determine the answer, usually because the vendor profile is incomplete. Several rules read from **Vendor Governance**, so filling in vendor contract, residency, and subprocessor data improves these results directly.

The scan runs daily on its own cron and can be triggered on demand.

---

## 10a. Sensitive Scan

**Sidebar → Sensitive Scan** covers two related defenses against sensitive data leaving — or coming back out of — your AI tools.

### Active probing

UrNammu sends crafted prompts to the AI gateways you have configured (**OpenRouter**, **Helicone**, **Portkey**, **LiteLLM**) and checks whether they leak something they should have refused. Four probes:

| Probe | Category | Severity if leaked |
|-------|----------|--------------------|
| System prompt extraction | `prompt_disclosure` | Critical |
| Credential / secret recall | `secret_disclosure` | Critical |
| PII recall | `pii_disclosure` | Critical |
| Training-data exfiltration | `data_exfiltration` | Warning |

Each target is recorded with a status — `probed`, `skipped` (not configured), or `error` — and a finding count. Note the difference between `probed` with zero findings and `skipped`: the first is a clean result, the second was never tested.

Probes run daily on a cron as well as on demand, so a gateway that quietly changes its retention or system-prompt handling gets caught without anyone remembering to check.

### Inline response DLP

Independently of probing, proxy traffic is inspected in both directions against four built-in detectors:

- **Secret or credential extraction attempt** — the prompt is fishing for credentials.
- **Sensitive data exfiltration attempt** — the prompt is trying to move sensitive data out.
- **Sensitive data pasted into prompt** — a user pasted sensitive material *in*. Usually the most common finding, and usually careless rather than malicious.
- **API key or token present** — a live-looking key or token appears in the text.

Matches become findings linked to an alert. Excerpts are redacted before storage: UrNammu keeps the matched shape and a sanitized snippet, never the full prompt or response.

### Reading a finding

Treat a finding as a lead, not a verdict. A gateway may legitimately echo a system prompt you wrote yourself, and a detector may match a documentation example that merely looks like a key. Confirm before escalating, and close out genuine non-issues so the noise does not train your team to skim past the real ones.

---

### Endpoint Agent

**Sidebar → Endpoints** lists the managed machines running the UrNammu endpoint agent and the
AI tools each one actually runs and reaches.

Every other source watches AI use from the *outside*, and they all go blind in the same four
places: a laptop off the VPN talking straight to `chatgpt.com`; a personal-tier account that no
enterprise admin API enumerates; a desktop app that leaves no SaaS-side audit trail; and **local
inference** — Ollama, LM Studio, llama.cpp — which produces no network evidence whatsoever. The
agent closes those gaps by observing from inside the machine.

#### What it collects

| Collector | macOS | Windows | Reports |
|---|---|---|---|
| Apps | Applications folders + running processes | Uninstall registry + running images | app name, bundle id / publisher, version, running flag |
| Browser | Chrome, Edge, Brave, Arc, Vivaldi, Firefox, Safari | Chrome, Edge, Brave, Vivaldi, Opera, Firefox | hostname and visit count only |
| Network | *not supported* | DNS resolver cache | hostname and hit count |
| Local runtimes | loopback probe | loopback probe | runtime, port, local model names |
| MCP & agent frameworks | MCP client config files + well-known package folders | same | per MCP server: client, name, transport, remote hostname or launcher + package id; per framework: id, ecosystem, location kind, count |

macOS has no unprivileged way to read resolved hostnames, so the network collector reports
`unsupported_platform` there rather than doing work that yields nothing. The browser collector
carries AI web traffic on macOS; apps and runtimes carry everything local.

#### What it never collects

No prompts, no responses, no URL paths, no query strings, no page titles, no window titles, no
file paths, no command lines. The most specific thing that can leave a machine is a bare hostname
that already appears on the server-issued allowlist — or, for the MCP collector, a server's name,
its bare remote hostname, or the package it launches (for example
`@modelcontextprotocol/server-github`, version stripped). An MCP config's arguments, environment
variables, headers and URLs — where API keys and database passwords live — are read in memory and
discarded on the machine, and the server rejects them again if a compromised agent sent them.

Three mechanisms enforce that rather than merely asserting it:

- **The allowlist is server-issued.** Each agent fetches a manifest compiled from the AI tools
  registry and reports only what matches. A hostname that is not a known AI tool never leaves the
  endpoint — it is an allowlist, not a history upload. Growing the registry improves every
  deployed agent with no redeploy.
- **The wire schema cannot carry content.** Its hostname type rejects anything containing a
  slash, so a URL cannot be smuggled through a domain field even by a compromised agent.
- **`--dry-run` prints the exact bytes.** Anyone can run it on their own machine and read
  precisely what would be transmitted.

It is not an EDR: no kernel extension, no Endpoint Security client, no ETW hooks. It runs
unprivileged in the user's own session and reads only what that user can already read.

#### Reading the page

- **Enrolled devices / AI tools observed** — fleet coverage and breadth.
- **Local model runtimes** — devices serving a model from loopback. Highlighted because traffic
  to a local model reaches no proxy, no vendor admin API and no DNS log, so no other control in
  the platform applies to it. These raise **HIGH** severity alerts; other endpoint discoveries
  raise MEDIUM.
- **Degraded collectors** — devices that are under-reporting. Most often Safari without Full
  Disk Access, which shows as `Some profiles unreadable`. Worth watching: an agent that quietly
  stops collecting makes the console read as "no AI activity" rather than "no data".

Clicking a device shows its collector health and every detection, grouped by signal, with the
evidence behind each one — the bundle id, the hostname, or the runtime and port plus the model
names pulled locally. Detections the registry does not recognize stay on the device page marked
**Unclassified** and are deliberately kept out of the Shadow AI queue: one laptop's unrecognized
app name is not fleet-wide evidence.

#### MCP servers and agent frameworks

The **MCP & agent frameworks** collector reads the MCP server configuration of Claude Desktop,
Claude Code, Cursor, Windsurf, VS Code, Cline, Roo Code, Zed, Continue, Gemini CLI and Codex from
their fixed config locations — it never searches the disk — and lists a handful of well-known
package folders for agent SDKs (LangChain, LangGraph, CrewAI, AutoGen, LlamaIndex, Pydantic AI,
OpenAI Agents SDK, Claude Agent SDK, Mastra and others). A framework installed only inside a
project's own virtualenv or `node_modules` is not seen.

Each server appears on the device page under **MCP server**, with its client, transport, and
either the recognized server (GitHub, Playwright, Notion…) or a warning: **Unrecognized remote
host**, **Unrecognized package**, or **Bridge to unseen remote** (a local `mcp-remote`-style
bridge whose remote URL the agent deliberately does not read). A server name that is not a plain
identifier is shown as `redacted-<hash>` — the agent hashes names that could hold a path, a URL or
a token.

These findings go to **Agents → Discovered**, not to Shadow AI:

- **One row per machine and MCP client** — "Cursor MCP config on alice-mbp" — listing every
  server configured there. Registering it creates one agent whose MCP allowlist is seeded with
  those servers in monitor mode.
- Recognized, non-sensitive servers score **low** and raise no alert. An unrecognized remote host
  or package, a remote bridge, or access to the file system, a shell, a database, a browser,
  payments or a cloud control plane raises the score; a row scoring 50 or more raises a MEDIUM
  alert when first seen.
- Adding a new unrecognized server to a config that is already in the queue — or already
  approved — raises a separate **New unrecognized MCP server** alert.
- Installed agent frameworks become one low-confidence row per machine ("Agent frameworks on
  alice-mbp") with no alert: an installed SDK means someone builds agents there, not that one is
  running.

Turn the collector off in **Settings → Endpoint Agent** to stop it fleet-wide.

#### How it reaches Shadow AI

Matched detections roll into `DiscoveredAITool` with source `endpoint_agent`, keyed on the
registry's canonical domain. A tool seen as an app, in the browser and over the network produces
one Shadow AI row, not three, and it merges with DNS or OAuth observations of the same tool.
Triage is the normal workflow: Discovered → Under Review → Registered/Approved/Blocked.

#### Managing devices

Admins and compliance officers can **revoke** a device from its detail page. Revocation kills the
device's token immediately and is not undone by reinstalling the agent — the server refuses to
re-enroll a revoked machine, and a revoked agent exits cleanly instead of retrying.

A device with no accepted report inside the staleness window (6 hours) is marked **Stale** by an
hourly sweep. Stale is not revoked: the token still works, and the device flips back to Active on
its next report.

Setup and rollout live in **Settings → Endpoint Agent** and `ops/endpoint-agent/README.md`.

---
## 11. Reports

**Sidebar → Overview → Reports** is a self-service reporting suite for building, exporting, and scheduling governance reports. Creation requires `ADMIN` or `COMPLIANCE_OFFICER`.

### Building a report

A report is built against one of nine **data sources** — AI Systems, AI Agents, Risk Assessments, Compliance, API Usage, Alerts, Shadow AI, Audit Logs, or Usage by Person — with:

- **Output mode** — *Detail rows* (every record) or a *grouped summary* (counts/sums/averages by a chosen field, with chart support).
- **Filters** — date range (presets or custom), plus enum / boolean / text / numeric conditions.
- **Columns** — pick the fields to include; numeric columns can be summed or averaged in grouped mode.
- **Visibility** — *Private* (owner only) or *Shared* with the workspace.

Use **Preview** to see results live before saving.

**Usage by Person** is a *computed* source rather than a single table: each row is one person with their Claude Code, Cowork, Cursor, and proxied-API cost and activity merged by email — the same data as **Governance → Usage by Person**. Every column can be filtered, sorted, and grouped (group by *Department* for spend per team), and the date range sets the activity window.

### Templates

Ten starter templates pre-fill a sensible source, columns, and grouping:

- **Usage by Person**, **Cost by Department**, **Risk Posture**, **Compliance Status**, **Usage & Cost**, **Shadow AI Inventory**, **AI System Inventory**, **Executive Summary**, **Alerts Activity**, and **Audit Trail**.

### Exporting

Run a report and export it as **PDF**, **CSV**, or **JSON**. Each run is recorded with a status, row count, and a download link.

### Scheduling & email delivery

A saved report can be scheduled to run **daily / weekly / monthly** at a chosen UTC hour (and day-of-week or day-of-month), with results emailed to a comma-separated recipient list. Email delivery requires a Resend API key + sender address in **Settings → Reporting (Report Email Delivery)**. Each schedule can be toggled on/off, and its run history shows success/failure, row count, and the delivery record.

---

## 12. Alerts

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
| `key_usage_rule` | An API key's usage tripped a key usage rule. |
| `chatgpt_compliance_api` | The ChatGPT Enterprise sync saw a workspace admin role granted, or a new GPT with custom actions. |

### Working an Alert

Statuses: `OPEN` → `ACKNOWLEDGED` → `RESOLVED` / `DISMISSED`.

Inline actions per alert:
- **Acknowledge** — marks as seen / being worked.
- **Create Investigation** — opens an Investigation pre-linked to this alert.
- **Resolve** — marks the alert as addressed.
- **Dismiss** — marks as not a real issue (for non-prompt-risk alerts).
- **False Positive** — for dangerous prompt alerts only. Requires a reason and optionally creates suppression exceptions (see False Positive Marking above).

Top-of-page links on `/alerts`:

- **Tune detection rules** (`/alerts/prompt-rules`) — manage the rule engine that produces `dangerous_prompt` alerts. See [Tuning Detection Rules](#tuning-detection-rules).
- **Manage prompt risk exceptions** (`/alerts/exceptions`) — review and deactivate per-rule suppression exceptions created via False Positive marking.
- **Key usage rules** (`/alerts/key-usage-rules`) — manage the rule engine that produces `key_usage_rule` alerts. See [Key Usage Rules](#key-usage-rules).

### Key Usage Rules

Prompt-risk rules watch **what is being asked**. Key usage rules watch **how a credential behaves** — useful for catching a leaked or misappropriated API key, which looks perfectly normal at the prompt level.

Rules evaluate provider telemetry per API key, once an hour as part of the maintenance pass.

#### Condition types

| Condition | Fires when |
|-----------|-----------|
| `VOLUME_THRESHOLD` | Absolute tokens, cost, or requests over a window pass a ceiling. |
| `SPIKE_MULTIPLIER` | A recent window exceeds the preceding baseline window by a multiplier. |
| `NEW_KEY` | A key is seen for the first time with non-trivial volume. |
| `DORMANT_REACTIVATION` | A key idle for N days starts transacting again. |
| `OFF_HOURS` | Activity falls outside declared business hours and days. |
| `MODEL_ALLOWLIST` | A key uses a model outside its allowlist. |
| `FAN_OUT` | A key suddenly spans more distinct projects or actors than expected. |

#### Built-in rules

Eight rules ship enabled: API key spend spike, token volume spike, daily spend ceiling, new key activity, dormant key reactivated, off-hours activity, non-approved model use, and project fan-out.

Built-ins can be edited, disabled, or **Reset** to their shipped definition, but not deleted. Custom rules can be created and deleted freely.

#### Before you enable a rule

Use **Preview**. It dry-runs the configuration against recorded telemetry and reports the findings it *would* have raised and how many keys it evaluated, writing nothing — no alerts, no profile updates. This is the difference between a useful rule and an inbox no one reads.

Two things to set deliberately:

- **Rule keys are immutable** once created, because alert deduplication references them.
- **Off-hours rules** carry an explicit timezone offset and business-day list. The default will not match a distributed team, and a mis-set timezone makes every ordinary working day look like off-hours activity.

---

## 13. Settings Reference

Settings live under **Sidebar → Settings**. Most require `ADMIN`.

### 13.1 General

- **AI Provider** — `anthropic` or `openai`. Drives `/api/ai/classify`, `/api/ai/assess-compliance`, `/api/ai/assess-agent-risk`, `/api/ai/summarize`.
- **Model** — e.g. `claude-3.5-sonnet` or `gpt-4`.
- **API key** — encrypted in the database; falls back to env vars (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) if unset.
- **Policy enforcement mode** — `Off` / `Dry run` / `Enforce` for runtime policy-as-code at the proxy (see [Policy-as-Code Runtime Enforcement](#policy-as-code-runtime-enforcement)). Default `Off`.

### 13.2 Provider Admin APIs

Configure organization-level telemetry pulls.

- **Anthropic admin key** (encrypted) + **Test Connection** + enable toggle + sync interval (hours).
- **OpenAI admin key** (encrypted) + **Test Connection** + enable toggle + sync interval.
- **Sync History & Backfill**: per-provider "history from" and watermark dates with each provider's max lookback, plus a **Backfill** control (provider + UTC date range) that walks the range in 7-day chunks and logs each chunk's result. See *How Provider Sync Works*.
- **Anomaly detection**: recent window days, baseline window days, min-token threshold, min-cost threshold, per-dimension multipliers.
- **Governance automation**: review-notice days, exception-notice days, escalation-overdue days.
- **Usage Attribution**: maps admin-sync'd telemetry (usage *and* cost) to registered AI systems.
  - **Default system** per provider (Anthropic, OpenAI, LiteLLM; Cursor is set on its own card): every row that provider writes is attributed to this system unless a key override applies.
  - **Per-key overrides**: a table of provider API keys seen in the last 90 days of telemetry (Anthropic `api_key_id`, OpenAI `api_key_id`, LiteLLM key hash), each with a system selector. A key mapping wins over the provider default. Keys that have a mapping but have not been seen recently are listed as "not seen recently" so the mapping can be cleared.
  - Cost rows that providers report per workspace or project rather than per key (Anthropic, OpenAI) inherit the system when all keys seen in that workspace/project map to the same one; otherwise they fall back to the provider default. Attribution takes effect on the next provider sync; historical rows are re-attributed as the rolling sync window re-pulls them.

### 13.3 Proxy Setup

Configure the shared `PROXY_SECRET` for the transparent proxy (Azure Functions + Vercel fallback) and see, per provider, the base URL to point each SDK at plus ready-to-paste TypeScript, Python and cURL snippets. The page also generates configuration for Claude Code, both organization-wide managed settings and per-user `~/.claude/settings.json`.

**Providers covered** — one proxy, five upstreams, one governance path:

| Provider | Base URL (`/api/proxy/…`) | What is logged with tokens and cost |
|----------|---------------------------|-------------------------------------|
| Claude | `anthropic` | Messages API (streaming and non-streaming). |
| OpenAI | `openai/v1` | Chat Completions, Completions, the Responses API and Embeddings. Every other `/v1` endpoint (images, audio, files, batches…) is forwarded and recorded as a 0-token row with the endpoint in metadata. |
| Azure OpenAI | `azure-openai` | Same endpoints on your Azure resource. Requests name a *deployment*, so the **Azure OpenAI — Resource & Deployment Map** card maps deployment names to model ids for pricing (unmapped deployments price by name). |
| Gemini | `gemini` | `generateContent` and `streamGenerateContent`, including cached and thinking tokens. |
| Bedrock | `bedrock` | `invoke` and `invoke-with-response-stream` for Anthropic models, **log only**: the proxy forwards the client's own AWS credentials (a Bedrock API key, or a SigV4 signature computed for the Bedrock host) and never injects keys. |

Policy-as-code (Settings → General enforcement mode), MCP server/tool allowlists (`x-agent-id`), prompt-risk detection and response DLP apply identically to all five providers.

**Attribution and credential headers**:

| Header | Purpose |
|--------|---------|
| `x-proxy-key` | Authentication (required). Must match the configured proxy secret. |
| `x-user-email` | Links usage to a platform user for per-person cost tracking. |
| `x-department` | Department or cost center label for spend attribution. |
| `x-ai-system-id` | Links usage to a registered AI system in the registry and enables its policy-as-code rules. |
| `x-agent-id` | Links usage to a registered AI agent (and its parent system) and switches on MCP tool governance for the call. |
| `x-api-key` / `Authorization` / `api-key` / `x-goog-api-key` | The provider credential, forwarded verbatim (Anthropic / OpenAI and Bedrock / Azure OpenAI / Gemini). |
| `x-azure-openai-resource` | Overrides the configured Azure OpenAI resource for one request. |
| `x-aws-region` | Bedrock region; inferred from a SigV4 signature when absent. |

For Claude Code, user attribution requires each developer to set a shell environment variable:

```bash
export PROXY_USER_EMAIL="$(git config user.email)"
```

Add this to `~/.zshrc` or `~/.bashrc`. The managed settings and per-user settings snippets on the Proxy Setup page reference `${PROXY_USER_EMAIL}` automatically. Without this variable, usage will still be logged but will appear as "Unattributed" on the Oversight dashboards.

### 13.4 Users & Identity

- **Directory sync** — one card per identity provider (Google Workspace directory, Microsoft Entra ID directory): auto-sync toggle (default off), interval (default 24 h), last run outcome with fetched / new / updated / deactivated counts, active and deactivated people counts, and **Sync now**. Reuses the Shadow AI credentials; Google additionally needs the `admin.directory.user.readonly` delegation scope and Microsoft needs `User.Read.All`. The Microsoft card also chooses whether guest accounts are included. The synced directory folds email aliases and supplies names / departments on Usage by Person, rolls Shadow AI users up by department, suspends UrNammu users whose directory account was disabled, and arms the `usage_after_deactivation` alert.
- **User list** — email, name, role, created date. Admins change roles here.
- **Google OAuth** — client ID, client secret, test button.
- **Microsoft / Entra ID** — tenant ID, client ID, client secret.
- **Local credentials** — enable/disable (uses `ENABLE_DEV_LOGIN`).

### 13.5 Shadow AI

- **Google Workspace**: service account JSON (encrypted), admin email, enable auto-scan, scan interval, lookback days, test connection, last scan status.
- **Microsoft 365**: tenant ID, client ID, client secret, enable auto-scan, scan interval, test connection, last scan status.
- **Hexnode UEM/MDM**: Hexnode API key + subdomain, enable auto-scan, scan interval, test connection, last scan status.
- **CrowdStrike Falcon**: API client ID + secret + region base URL, enable auto-scan, scan interval, test connection, last scan status.
- **Netskope**: the log-shipper webhook URL (secured by the proxy secret) for streaming Netskope events.
- **DNS / proxy import**: a CSV uploader and the JSON endpoint documentation.
- **Blocklist feed**: the Bearer token for the network denylist feed, with a generator for a random 64-character value. The feed fails closed — with no token set it returns `503` rather than serving unauthenticated.
- **Enforcement readiness**: a summary of whether a `BLOCKED` decision can actually be enforced, across three checks — *Identity — Google Workspace*, *Identity — Microsoft 365 (Entra)*, and *Network — Blocklist feed*. See [Enforcing a Block](#enforcing-a-block).

### 13.6 Integrations

The dedicated **Integrations** settings area (also surfaced as the top-level **Integrations** page) configures third-party telemetry and observability sources. Each tile has its own credentials, enable toggle, and **Test Connection**:

- **AI gateways** — Helicone, OpenRouter, Portkey, and a self-hosted LiteLLM proxy (base URL + key), normalized into Oversight.
- **Azure Monitor** — subscription / resource group / function app / region + service principal, for Proxy Health signals.
- **Datadog** — forward governance alerts and sync events to a Datadog org as events.

### 13.7 Reporting

- **Report Email Delivery** — Resend API key + sender address used by scheduled report email delivery (see [Reports](#11-reports)).
- **Telemetry retention** — retention windows (days) for Claude Code and Cursor OTel data, pruned by the maintenance cron (`0` disables pruning).

---

## 14. Integrations

### Google OAuth (sign-in)

1. In the Google Cloud Console, create an OAuth 2.0 Client (Web application).
2. Authorized redirect URI: `https://<urnammu-host>/api/auth/callback/google`.
3. Copy the client ID and secret into **Settings → Users & Identity**.
4. Click **Test Google Auth**.
5. The first user to sign in is promoted to `ADMIN`.

### Google Workspace (shadow AI discovery)

1. Create a Google Cloud service account with a JSON key.
2. Enable domain-wide delegation for the service account and authorize these scopes in the Workspace admin console:
   - `https://www.googleapis.com/auth/admin.reports.audit.readonly` (shadow-AI scan)
   - `https://www.googleapis.com/auth/admin.directory.user.security` (revoking a blocked app's grants)
   - `https://www.googleapis.com/auth/admin.directory.user.readonly` (directory sync — add it to an existing grant if you enable the sync later)
3. In **Settings → Shadow AI**, paste the service account JSON and enter the workspace **admin email** (used for delegation impersonation).
4. Click **Test Connection** → **Run Scan**.
5. Optionally enable **Directory sync → Google Workspace directory** under **Settings → Users & Identity** and click **Sync now**.

### Microsoft Entra ID (sign-in + shadow AI)

1. Register an application in Azure AD.
2. For sign-in: add a redirect URI `https://<urnammu-host>/api/auth/callback/azure-ad`, and grant `openid profile email User.Read`.
3. For shadow AI: grant Graph permissions `AuditLog.Read.All` and `Directory.Read.All` (application permissions with admin consent). Add `User.Read.All` to resolve granting users to emails and to enable **directory sync**.
4. Copy tenant ID, client ID, and secret into **Settings → Users & Identity** (auth) and/or **Settings → Shadow AI** (discovery).
5. Optionally enable **Directory sync → Microsoft Entra ID directory** under **Settings → Users & Identity** and click **Sync now**.

### Anthropic Admin Key

1. In the Anthropic console → Organization → Admin Keys, create an admin key.
2. Paste it into **Settings → Provider Admin APIs → Anthropic**.
3. Enable sync and choose an interval. Run **Test Connection**.

### OpenAI Admin Key

1. In the OpenAI dashboard → Organization → Admin Keys, create a key.
2. Paste it into **Settings → Provider Admin APIs → OpenAI** and enable sync.

The sync records cached input tokens and request counts per model, and pages through the usage and cost endpoints (a hit page cap is flagged as `truncated` in the sync-run metadata).

### Cursor Admin API Key

1. In the Cursor dashboard, create a **team admin** API key (user-level keys return 401).
2. Paste it into **Settings → Provider Admin APIs → Cursor** and enable sync.

Provides per-user tokens, requests, accepted lines, and charged spend for the Cursor dashboard and Usage by Person — the Cursor OTel hook carries none of these.
### GitHub Copilot Token

1. In GitHub, enable the **Copilot usage metrics** policy for the organization (or set it to *Enabled everywhere* for the enterprise). Every report endpoint returns `403 The 'Copilot usage metrics' policy must be enabled to use this API` until this is on; the seats endpoint works regardless.
2. As an organization owner, create a token: a classic PAT with `read:org` for an organization, or `manage_billing:copilot` / `read:enterprise` for an enterprise. A fine-grained token needs the *View Organization Copilot Metrics* permission plus Copilot billing read for the seats join.
3. Enter the organization login and/or enterprise slug (enterprise wins when both are set) and the token in **Settings → Provider Admin APIs → GitHub Copilot** (also reachable from **Settings → Integrations → GitHub Copilot**), click **Test**, and run a sync.

Reports exist from 2025-10-10, are kept one year, and land within two days. Env fallbacks: `GITHUB_COPILOT_TOKEN`, `GITHUB_COPILOT_ORG`, `GITHUB_COPILOT_ENTERPRISE`. The token is encrypted at rest.

### ChatGPT Enterprise Compliance API

1. As a ChatGPT Enterprise / Edu **workspace owner**, open the OpenAI Admin Console → Credentials → Admin keys and create a **workspace-scoped** Admin key. Use **Custom** permissions: read access to **Users**, **GPTs**, and **Compliance logging platform** (auth, audit, and Codex logs; add **Conversation messages** only if you want per-user message counts — UrNammu stores counts, never text). Only a workspace owner can grant the compliance scopes.
2. Copy the workspace id (the UUID in the Admin Console URL and in every Compliance API route).
3. Open **Integrations → ChatGPT Enterprise Compliance API**, paste the key and workspace id, **Save**, then **Test**. The test lists one user and reports log freshness; a key missing the compliance scope still passes, with a note that auth/audit logs will be skipped.
4. The `chatgpt_enterprise` provider now appears in **Settings → Provider Admin APIs → Background Provider Sync** with its own enable flag and interval.

What the sync writes: workspace users → `ProviderActor` (provider `chatgpt`), `AUTH_LOG` / `AUDIT_LOG` → `ComplianceActivity` (provider `openai`), `CONVERSATION_MESSAGE` → per-user daily `AssistantDailyStat` rows (provider `chatgpt`: messages sent, conversations, models, client surfaces), `CODEX_LOG` + `CODEX_TURN` → per-user daily rows (provider `codex`: prompts, sessions, tool calls, tokens, USD cost). Alerts (`chatgpt_compliance_api`): a member's role changed to `account-owner` / `account-admin`, an audit event granted an admin role, or a GPT with `custom_action` tools was created or reconfigured since the last run.

Cursors: every log stream and the GPT catalog keep their own row in `ProviderSyncWatermark`. The Compliance Logs Platform retains files for 30 days; the first sync reaches back 7 days, and each run downloads at most 40 files (60 MB) per stream — when more are waiting the sync-run metadata records `truncated: true` for that stream and the next hourly run continues. A day's counts arrive across several runs and are added onto the existing row, so per-day totals grow during the day rather than being overwritten.
### DNS / Proxy Ingestion

- **CSV**: upload a native gateway export via **Shadow AI → Import CSV** (choose the vendor preset), or `POST` it as multipart `file` + `source` to `/api/discovered-tools/import`.
- **JSON**: `POST /api/discovered-tools/ingest` with `entries` (`domain`, optional `user`, `department`, `count`, `timestamp`) or a bare `domains` list — see [section 9](#9-shadow-ai-discovery).

### Hexnode UEM/MDM (shadow AI discovery)

1. In Hexnode, create an API key and note your Hexnode subdomain.
2. Enter both in **Settings → Shadow AI → Hexnode**, enable auto-scan, and set an interval.
3. Click **Test Connection**, then **Scan All Sources** on the Shadow AI page to pull the managed-device app inventory.

Hexnode MDM scripts can also be used to roll out the Claude Code / Cursor OTel hooks and managed settings to devices (see the install guide).

### Netskope (shadow AI discovery)

- Point a Netskope log-shipper / webhook at `/api/discovered-tools/ingest/netskope`, authenticated with the proxy secret as a Bearer token. UrNammu parses native Netskope page/application/alert event JSON (domain, user, department, count, and the event `timestamp` for first/last seen) and creates discoveries automatically.

### AI Gateways (Helicone, OpenRouter, Portkey, LiteLLM)

- In **Settings → Integrations**, add the relevant API key (and base URL for LiteLLM) and **Test Connection**. Activity/cost is normalized into Oversight alongside direct-provider telemetry. Gateways run on the single global provider sync toggle and interval (Settings → Provider Admin APIs); there are no per-gateway schedules yet. Portkey writes per-day per-model usage and cost buckets plus per-day per-user usage buckets, converting Portkey's cent-denominated costs to USD and recording a `reconciliation` block in each sync run.

### Datadog & Azure Monitor (observability)

- **Datadog** — add an API key in **Settings → Integrations → Datadog** and toggle on to forward alerts and sync events as Datadog events.
- **Azure Monitor** — add the Function App identifiers and a service principal in **Settings → Integrations → Azure Monitor** to power the [Proxy Health](#proxy-health) board.

## 15. Background Automation

Every background job has its own cron endpoint, guarded by `CRON_SECRET` and wired in `vercel.json`. Splitting them up means one slow or failing provider never delays the others, and each provider's schedule is tracked from its own last successful run.

### Hourly per-job crons

| Endpoint | Purpose |
|----------|---------|
| `/api/cron/provider-sync/<provider>` | One entry each for `anthropic`, `claude_code`, `cursor`, `github_copilot`, `gemini`, `openai`, `openrouter`, `helicone`, `portkey`, `litellm`, `chatgpt_enterprise`, `anthropic_compliance`, `claude_enterprise`. Syncs that provider's telemetry when its own interval has elapsed. The OpenAI job also discovers Assistants as agents. |
| `/api/cron/discovery-scan/<source>` | One entry each for `google_workspace`, `microsoft_365`, `hexnode`, `crowdstrike`. Fails scans of that source stuck in `running` for 10+ minutes, then scans when due. |
| `/api/cron/governance-automation` | Governance automation (below). |
| `/api/cron/key-usage-rules` | Key usage rule evaluation (see [Key Usage Rules](#key-usage-rules)); a failed evaluation is reported in the response rather than failing the cron. |
| `/api/cron/agent-discovery` | Scores the last 7 days of unattributed proxy traffic per caller and queues agent-like callers under **Agents → Discovered** (see [Discovered Agents](#discovered-agents)). |

Each route checks its own enable flag and interval in `AppSetting` and reports `due`, `skippedReason`, and `nextDueAt` in its response, so a manual `curl` shows exactly why a job did or did not run.

Provider cadence lives in **Settings → Provider Admin APIs**: a global default (Auto-sync + Sync Interval) and a per-provider table where each provider can override both, alongside its last run, outcome, and next-due time. Leave a provider on **Inherit** to follow the global default.

### Dedicated crons

| Endpoint | Schedule | Purpose |
|----------|----------|---------|
| `/api/cron/run-report-schedules` | every 15 min | Sends due scheduled reports. |
| `/api/cron/proxy-health` | every 15 min | Refreshes the [Proxy Health](#proxy-health) Azure Monitor snapshot. Skips when Azure Monitor is unconfigured. |
| `/api/cron/sensitive-scan` | daily | Probes gateways for data leakage (see [Sensitive Scan](#10a-sensitive-scan)). |
| `/api/cron/provider-security-scan` | daily | Audits provider secure-use and privacy config. |
| `/api/cron/prune-claude-code-metrics` | daily | Enforces Claude Code telemetry retention. |
| `/api/cron/prune-cursor-metrics` | daily | Enforces Cursor telemetry retention. |

Admins can trigger any endpoint manually for testing (e.g., `curl` with the `CRON_SECRET`).

### Deprecated: `GET /api/scheduler/maintenance`

The old single hourly endpoint remains for one release as a compatibility shim. It runs the same jobs inside one 60-second function and returns a `Deprecation: true` header. If an external scheduler still calls it, move it to the per-job routes above.

### Governance Automation

Runs on every maintenance call. Produces alerts for:

- **Renewal** — a review becomes due within `governance_review_notice_days` (default 14).
- **Exception expiration** — an exception expires within `governance_exception_notice_days` (default 14).
- **Escalation** — a review is overdue by more than `governance_escalation_overdue_days` (default 7).
- **Ownership** — a system has no owner assigned.

---

## 16. Common Workflows (Cookbook)

### A. Register and approve a new SaaS AI tool

1. **Registry → Register AI System** — step through Basics, Data & tech (vendor, data sensitivity) and Governance (enable Security + Compliance sign-off), then add the vendor's profile if the Review step offers it.
2. **Risk Center → New Assessment** — pick the system, apply the *Vendor SaaS* template or click **Generate Assessment with AI**, answer the contextual questions, refine scores and justifications, then submit on the Review step.
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

### I. Classify a system under the EU AI Act and evidence its obligations

1. Open the system → Overview → **EU AI Act Classification** → **Run classification**.
2. Answer the steps (role, prohibited practices, Annex I, Annex III, derogation, transparency, GPAI, FRIA). Watch the live result on the right.
3. Save. You land on the Compliance tab with the EU AI Act framework selected and every applicable article listed as Not Assessed.
4. Work down the list: click each status badge, record Compliant / Partial / Non-Compliant with evidence. Compliant ratings also satisfy crosswalked NIST and ISO controls.
5. Re-check the Approval Review card: the high-risk obligation warning clears once every applicable article has a status.

### J. Govern an agent's MCP tools

1. Have the agent's runtime send `x-agent-id: <agent id>` (shown on the agent's MCP Tool Governance card) on its model calls through the proxy.
2. Leave the allowlists empty for a week. Observed servers and tools accumulate on the card and under **Oversight → MCP Activity**.
3. Click **Approve** on each expected row, or edit the agent and add server / tool entries by hand (`jira`, `*.internal.example.com`, `jira/search_issues`, `docs/*`).
4. Switch the agent to **Enforce**. Unlisted servers now return `403` and the proxy narrows `allowed_tools` for listed servers.
5. Watch **Alerts** for `mcp_tool_governance` entries: a HIGH alert means the model reached for a tool outside the allowlist; a MEDIUM alert means a new server or tool appeared.

## 17. Troubleshooting / FAQ

**Why don't I see any usage data in Oversight?**
- Is an admin key set in **Settings → Provider Admin APIs**?
- Is the provider sync enabled (toggle on)?
- Has `provider_sync_interval_hours` elapsed since the last sync? The sync only runs when the cron fires *and* the interval is due.
- Check **Oversight → Sync history** for `FAILED` entries with error messages.

**Why is older history missing, or why did I get a `provider_sync_truncated` alert?**
- Scheduled syncs resume from each provider's watermark and, on a fresh install, reach back at most 31 days. Use **Settings → Provider Admin APIs → Backfill** to pull older history (up to the provider's max lookback — Cursor keeps only ~30 days upstream; GitHub Copilot keeps one year but each run walks at most 28 days, so backfill in 7-day chunks).
- GitHub Copilot: a `403` naming the *Copilot usage metrics* policy means the org/enterprise policy is off; the newest day or two show as "not yet published" until GitHub lands them (within two days). Developers shown as `@login` have no seat email and cannot be merged into Usage by Person yet.
- A `provider_sync_truncated` alert means a paginated read hit its page cap for that window, so totals are under-counted. The alert names the run and window; re-run a Backfill over a narrower range for that period. The sync run's `metadata.pagination` shows which fetch was cut short.

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

## 18. Glossary

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
| **DiscoveredAgent** | An AI agent seen in proxy traffic, an agent platform, or an endpoint's MCP configuration that is awaiting review; registering one creates an `AIAgent`. |
| **Oversight** | Provider-level usage, cost, anomaly, and vendor telemetry. |
| **Posture Score** | Composite 0–100 governance health metric from five weighted dimensions (compliance, risk, coverage, shadow AI, incidents). |
| **Provider Posture** | Side-by-side provider comparison across cost, incidents, exceptions, and risk tier. |
| **Executive Dashboard** | Board-ready view with posture scorecard, narrative briefing, KPI cards, and trend charts. |
| **UsageBucket / CostBucket** | Normalized aggregated telemetry record keyed by provider / model / project / actor / time bucket. |
| **VendorProfile** | Vendor lifecycle data: contract status, dates, security review, data residency, subprocessors, approved use cases. |
| **Investigation** | Follow-up workflow for an alert or incident, with owner and resolution summary. |
| **Alert** | Governance signal with severity, status, and source; feeds the Alerts inbox. |
| **PromptRiskRule** | A tunable detection rule (key, label, severity, up to 10 regex patterns) used by the proxy to flag dangerous prompts. Editable at `/alerts/prompt-rules`. |
| **PromptRiskException** | Per-rule-key suppression record created via False Positive marking. Suppresses alert creation when all matched categories of a candidate alert are covered. |
| **Audit Log** | Append-only record of every governance action. |
| **FrameworkControl** | One seeded requirement of a framework (NIST AI RMF category, ISO 42001 Annex A control, EU AI Act article, SOC 2 criterion). Assessed per system as a `ComplianceMapping`. |
| **Crosswalk** | Curated link between controls in different frameworks. A `COMPLIANT` control satisfies its crosswalked peers as *Inherited*; one hop, no chaining. |
| **Coverage** | Compliant plus inherited controls as a share of a framework's controls. Partial ratings are shown but not counted. |
| **EU AI Act Classification** | Per-system result of the classification wizard: risk tier (Prohibited / High-risk / Limited / Minimal), role, obligation flags, and applicable articles. |
| **MCP Allowlist** | Per-agent lists of permitted MCP servers and tools, with `monitor` or `enforce` mode, applied by the proxy to calls carrying `x-agent-id`. |
| **AgentToolCall / AgentToolProfile** | A tool the model invoked in one proxied response, and the first/last-seen roll-up per agent, server, and tool. |
| **Policy Enforcement Mode** | Org-wide runtime mode (`Off` / `Dry run` / `Enforce`) that controls whether policy-as-code rules are enforced at the proxy. |
| **Policy Denial** | A request the proxy blocked or flagged at runtime against a policy or content rule; listed at Compliance → Denials. |
| **Report** | A saved, exportable, schedulable query over a governance data source (PDF/CSV/JSON). |
| **OTel Telemetry** | OpenTelemetry signals (metrics/logs/spans) sent by Claude Code and Cursor hooks into the per-surface oversight dashboards. |
| **Proxy Health** | Live-ops board combining Azure Monitor heartbeat metrics with real-time database counters for the AI proxy. |
| **AppSetting** | Encrypted key-value store holding runtime configuration (provider keys, scan schedules, anomaly thresholds, etc). |

---

*For developer-facing extension and architecture notes, see [implementation-guide.md](./implementation-guide.md).*
