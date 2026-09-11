# System Detail

This page is the governance hub for a single AI system. Each tab represents a different dimension of governance, and the tab labels carry live counts so you can see where the work is without opening them.

## Tabs

- **Overview** — registered metadata and use case, the EU AI Act classification, the approval decision and staged review history, governance exceptions, evidence artifacts, incidents, telemetry attribution, and automated recommendations.
- **Agents (n)** — agents pointing to this system, with autonomy badges.
- **Risk (n)** — the risk profile, a dimension radar, a score-history trend chart, and open risk issues. Create a new assessment from here.
- **Compliance (n)** — assigned policies, compliance status, evidence text, and compliance issues, plus the **Framework Controls** card for control-by-control assessment against NIST AI RMF, ISO 42001, the EU AI Act and SOC 2. The **AI Assess** button runs automated gap analysis.
- **Audit Trail** — every recorded action on this system.

## Approval readiness

The **Approval Review** card lists exactly what is blocking approval. A system cannot move to `APPROVED` while any of these hold:

- No risk assessment on file.
- No governing policies assigned.
- A policy still in `NOT_ASSESSED`.
- A policy marked `NON_COMPLIANT` — remediate it or record an exception.
- A policy marked `PARTIALLY_COMPLIANT` with no evidence recorded.
- A policy marked `COMPLIANT` with no evidence text.
- A policy with a blocking rule violation.
- A required approval stage not yet granted.
- No next-review date set, or a next-review date in the past.
- An EU AI Act classification that identified a **prohibited practice** (Art. 5).

Two EU AI Act items are surfaced as warnings rather than hard blocks: a classification that has not been run yet, and a high-risk system with applicable articles still `NOT_ASSESSED`.

Note that both `PARTIALLY_COMPLIANT` and `COMPLIANT` require evidence. Marking a policy compliant without writing down why is treated as an unfinished assessment, not a pass — the rating alone is not the evidence.

Each blocker in the card deep-links to the place you resolve it.

## EU AI Act classification

The **EU AI Act Classification** card on the Overview tab shows the system's risk tier under Regulation (EU) 2024/1689 — `PROHIBITED`, `HIGH_RISK`, `LIMITED_RISK` or `MINIMAL_RISK` — your organisation's role (provider, deployer, or both), the flags that drive extra duties (Annex III area, Art. 6(3) derogation, Art. 27 FRIA, Art. 50 transparency, GPAI), and the applicable articles.

**Run classification** opens a short wizard: role, prohibited practices, Annex I products, Annex III use cases, the Art. 6(3) derogation, transparency triggers, general-purpose AI, and (for high-risk deployers) fundamental-rights impact triggers. The tier and article list update live as you answer; nothing is saved until the final step.

Saving does three things: stores the classification with its rationale and audit entry, creates a `NOT_ASSESSED` Framework Controls entry for every applicable EU AI Act article so it can be evidenced on the Compliance tab, and raises an alert for high-risk or prohibited outcomes.

## Compliance evidence

Evidence has two surfaces and both matter at approval time:

- **Assignment evidence** — the free-text field inside the Compliance status editor; explains **why** the status is what it is.
- **Evidence Artifacts** — structured records on the Overview tab (title, category, link, notes).

Good assignment evidence references specific controls (vendor SOC 2, DPIA on file, bias evaluation) rather than restating the policy.

## Telemetry attribution

The **Telemetry Attribution** card on the Overview tab shows usage and cost linked to this system. Attribution depends on the `x-ai-system-id` header reaching the proxy — an empty card usually means the header is not being sent, not that the system is unused. See **Settings → Proxy Setup**.
