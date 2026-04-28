# Compliance

Manage policies, assignments, and the audit trail.

## Policies

Each policy belongs to a framework — `EU_AI_ACT`, `NIST_AI_RMF`, `ISO_42001`, `SOC2`, or `CUSTOM` — and has two parts:

- **Content** — long-form policy text.
- **Rules (JSON)** — machine-evaluable constraints: allowed/blocked vendors, max data sensitivity, required approval stages, max review interval, minimum risk level, model name patterns.

## Enforcement

- `ADVISORY` — violations are flagged but do not block approval.
- `BLOCKING` — violations hard-block the system from moving to `APPROVED`.

## Assignments

A `PolicyAssignment` links a policy to a system with a compliance status:

- `COMPLIANT` — system fully meets policy requirements.
- `PARTIALLY_COMPLIANT` — meets some; a remediation plan is expected.
- `NON_COMPLIANT` — does not meet; remediate or request an exception.
- `NOT_ASSESSED` — has not been evaluated yet.

Approval requires every assignment to be out of `NOT_ASSESSED` and `NON_COMPLIANT`.

## AI gap analysis

**AI Assess** on an assignment calls the configured AI provider with policy rules + system metadata + existing evidence, and creates structured `ComplianceIssue` records (severity, title, detail, remediation).

## Audit trail

**Compliance → Audit Trail** shows every governance action. Filter by actor, action, entity type, or date. Export as JSON or CSV for external auditors.
