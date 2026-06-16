# System Detail

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
- Every policy out of `NOT_ASSESSED` and `NON_COMPLIANT`.
- No blocking policy-rule violations.
- Every required stage approved.
- A valid next-review date in the future.

The Approval Review card will spell out each unmet condition with a deep link to resolve it.

## Compliance evidence

Evidence has two surfaces and both matter at approval time:

- **Assignment evidence** — the free-text field inside the Compliance status editor; explains *why* the status is what it is.
- **Evidence Artifacts** — structured records on the Approval & Governance tab (title, category, link, notes).

Good assignment evidence references specific controls (vendor SOC 2, DPIA on file, bias evaluation) rather than restating the policy.
