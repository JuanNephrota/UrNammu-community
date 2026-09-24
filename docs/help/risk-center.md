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

A justification is required for any score of 60 or above, and optional below that, so later reviewers can re-evaluate the score.

## Running an assessment

**New Assessment** opens a five-step guided flow:

- **System** — pick the system, then start from **Generate Assessment with AI** or a template (Copilot / Vendor AI SaaS / Autonomous Agent / Customer-Facing AI).
- **Context** — focus areas, the recommended tier, control gaps, and the contextual questions, which must all be answered.
- **Scores** — the six dimensions and their justifications.
- **Mitigation** — optional residual scores and the generated issues.
- **Review** — check everything, add notes, and submit.

Nothing is saved until you submit. The system's overall risk level updates automatically when you do.

## Reassessment cadence

`reviewIntervalDays` on each system controls how often a re-assessment is required. Alerts fire ahead of the due date; overdue reviews escalate automatically.
