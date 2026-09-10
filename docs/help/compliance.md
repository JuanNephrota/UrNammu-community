# Compliance

Manage policies, assignments, and the audit trail.

## Policies

Each policy belongs to a framework — `EU_AI_ACT`, `NIST_AI_RMF`, `ISO_42001`, `SOC2`, or `CUSTOM` — and has two parts:

- **Content** — long-form policy text.
- **Rules (JSON)** — machine-evaluable constraints: allowed/blocked vendors, max data sensitivity, required approval stages, max review interval, minimum risk level, model name patterns.

## Enforcement

Two different things are called "enforcement" here, and it is worth keeping them apart.

**At approval time**, a policy's enforcement level decides whether it can hold a system back:

- `ADVISORY` — violations are flagged but do not block approval.
- `BLOCKING` — violations hard-block the system from moving to `APPROVED`.

**At request time**, the proxy can evaluate the same machine-readable rules against live traffic. The mode is global, set at **Settings → General**:

- **Off** — the proxy ignores policies and requests always pass through. Safe default.
- **Dry run** — the proxy evaluates policies and records denial events, but still forwards the request. Use this to tune rules before turning enforcement on.
- **Enforce** — the proxy returns `403` on a blocking violation and the request never reaches the upstream provider.

Go through dry run first. It gives you the full denial record you would have produced, with none of the breakage.

## Assignments

A `PolicyAssignment` links a policy to a system with a compliance status:

- `COMPLIANT` — system fully meets policy requirements.
- `PARTIALLY_COMPLIANT` — meets some; a remediation plan is expected.
- `NON_COMPLIANT` — does not meet; remediate or request an exception.
- `NOT_ASSESSED` — has not been evaluated yet.

Approval requires every assignment to be out of `NOT_ASSESSED` and `NON_COMPLIANT`.

## AI gap analysis

**AI Assess** on an assignment calls the configured AI provider with policy rules + system metadata + existing evidence, and creates structured `ComplianceIssue` records (severity, title, detail, remediation).

## Blocked Queries

**Compliance → Blocked Queries** is the denial log — every request the proxy evaluated as a policy violation, in both dry-run and enforce modes. Open a denial to see which rule matched and the request metadata behind it.

Read this page alongside the enforcement mode: in dry run, entries are requests that **would** have been blocked, and are your tuning signal. In enforce, they are requests that actually failed, and someone may be waiting on one.

## Services

**Compliance → Services** groups services by their current compliance status across all assigned policies — the fastest way to see what is `NON_COMPLIANT` or still `NOT_ASSESSED` without walking the registry system by system.

## Audit trail

**Compliance → Audit Trail** shows every governance action. Filter by actor, action, entity type, or date. Export as JSON or CSV for external auditors.
