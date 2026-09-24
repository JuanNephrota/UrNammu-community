# AI System Registry

The registry is your central inventory of every managed AI system.

## Key actions

- **Register AI System** — opens a four-step guided registration: Basics (with **Autofill with AI**), Data & tech, Governance (review cadence and required sign-offs), and Review. The system is saved as a draft after the first step, and each later step saves as you go.
- **Search & filter** — filter by name, department, vendor, risk level, and status.
- **Bulk actions** — archive or permanently delete (with typed-name confirmation).

## Lifecycle

A system moves through: `DRAFT` → `UNDER_REVIEW` → `APPROVED` → `DEPLOYED` → `DEPRECATED` → `RETIRED`. Status is updated automatically as governance reviews complete, or manually on the Edit page.

## Data sensitivity levels

- `PUBLIC` — non-sensitive public data.
- `INTERNAL` — employee-only operational data.
- `CONFIDENTIAL` — sensitive business data; restrict vendor data flows.
- `RESTRICTED` — regulated / high-sensitivity data. Exposure alerts will fire on telemetry.

## Approval stages

Toggle which stages must sign off before a system can move to `APPROVED`:

- **Owner** — the accountable product / business owner.
- **Security** — security team review.
- **Legal** — contract and regulatory review.
- **Compliance** — final compliance officer sign-off.

Leaving a stage off is appropriate for low-risk systems (e.g. internal copilots). High-sensitivity systems should require all four.
