# Risk Center

Portfolio-level view of risk across every registered system.

## Reading the page

- **Risk counts** — systems grouped by `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` / `MINIMAL`.
- **Reassessment alerts** — systems whose `nextReviewDate` is approaching or past.
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

`reviewIntervalDays` on each system controls how often a re-assessment is required. Alerts fire ahead of the due date; overdue reviews escalate automatically.
