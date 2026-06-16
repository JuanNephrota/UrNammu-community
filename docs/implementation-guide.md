# Implementation Guide

This guide is the fastest way to understand how UrNammu is put together, where the major product areas live, and how to extend the platform without fighting the existing architecture.

## Stack

- `Next.js 16` with the App Router
- `React 19`
- `Prisma` with PostgreSQL
- `NextAuth`
- server-rendered dashboard pages in `src/app/(dashboard)`
- route handlers in `src/app/api`

## Product Areas

The app is organized around a few core governance surfaces:

- `Registry`
  Tracks governed AI systems, approval state, risk history, policy assignments, evidence, incidents, and linked shadow AI findings.
- `Agents`
  Tracks AI agents, autonomy, human review requirements, connected systems, and now AI-assisted agent risk review.
- `Shadow AI`
  Ingests and normalizes discoveries from Google Workspace, Microsoft 365, and DNS/proxy imports.
- `Risk Center`
  Handles system risk assessments, dynamic review questions, use-case templates, agent-aware overlays, and reassessment triggers.
- `Compliance`
  Manages policies, rule-based enforcement, compliance evidence, and governance workflows.
- `Oversight`
  Surfaces normalized provider telemetry, drift, incidents, vendor governance, and operational follow-up.

## Directory Map

- `src/app/(dashboard)`
  Main product pages.
- `src/app/api`
  Route handlers for CRUD, scans, AI helpers, and background jobs.
- `src/components`
  UI building blocks and product-specific cards/forms.
- `src/lib`
  Shared business logic, integrations, matchers, workflow engines, risk helpers, and validation utilities.
- `prisma/schema.prisma`
  Core data model.
- `prisma/migrations`
  Database migrations.

## Key Domain Models

The most important Prisma models are:

- `AISystem`
  The main governance record for a system. This is the center of approvals, policies, risk, incidents, evidence, and linked agents.
- `AIAgent`
  Operational agents tied to a system or discovered independently. Stores autonomy and review signals.
- `RiskAssessment`
  Stores multi-dimensional scores, justifications, notes, and contextual branching answers.
- `Policy` and `PolicyAssignment`
  Policies can now contain structured rules that are evaluated directly against systems.
- `GovernanceReview`, `GovernanceException`, `GovernanceIncident`
  Support staged signoff, exception handling, and oversight workflows.
- `VendorProfile`
  Stores contract posture, lifecycle dates, review status, residency, subprocessors, approved use cases, and renewal notes.
- `UsageBucket` and `CostBucket`
  The normalized telemetry layer for provider oversight.
- `DiscoveredAITool`
  Normalized shadow AI discoveries.

## Risk Center Architecture

Risk Center is no longer just a score form. The implementation is split across a few helpers:

- `src/lib/risk-center.ts`
  Shared risk scoring, recommended tier logic, control-gap detection, agent overlays, and reassessment drift logic.
- `src/lib/risk-questionnaire.ts`
  Dynamic branching questions based on data sensitivity, autonomy, and user impact.
- `src/lib/risk-templates.ts`
  Starter assessment templates for copilot, vendor AI SaaS, autonomous agent, and customer-facing AI.
- `src/components/forms/risk-assessment-form.tsx`
  The main UI that combines scores, templates, branching questions, AI generation, and control-gap guidance.

If you add new risk behavior, prefer adding it to the shared helpers first and then wiring it into the form or overview page. That keeps the logic testable and reusable.

## Governance Workflow Architecture

Governance decisions are intentionally centralized in shared logic instead of being embedded directly in page components.

- `src/lib/governance-workflow.ts`
  Computes stage/readiness state and next workflow actions.
- `src/lib/governance-recommendations.ts`
  Builds prioritized next-best actions per system from workflow, policy, exception, and incident state.
- `src/lib/policy-rules.ts`
  Parses and evaluates structured policy rules.

If you add new approval gates or recommendation logic, update these shared libs first.

## Vendor Governance Architecture

Vendor governance now has three layers:

- profile data in `VendorProfile`
- composite scoring in `src/lib/vendor-risk.ts`
- lifecycle and renewal state in `src/lib/vendor-lifecycle.ts`

The main page is:

- `src/app/(dashboard)/oversight/vendors/page.tsx`

If you add more vendor posture signals, prefer extending the shared scoring/lifecycle helpers instead of hard-coding logic directly in the page.

## Shadow AI Architecture

Shadow AI discovery is normalized into one pipeline even though the sources differ.

Important files:

- `src/lib/google-workspace.ts`
- `src/lib/microsoft-365-shadow-ai.ts`
- `src/lib/ai-tools-registry.ts`
- `src/lib/scan-executor.ts`
- `src/app/api/discovered-tools/scan/route.ts`

The source-specific scanners gather raw signals, the tool registry handles matching, and the scan executor persists normalized discoveries.

## Telemetry Architecture

Provider telemetry should now be built on normalized tables rather than legacy log reads.

Important files:

- `src/lib/oversight-telemetry.ts`
- `src/app/(dashboard)/oversight/page.tsx`
- `src/app/(dashboard)/oversight/usage/page.tsx`

When extending Oversight, prefer `UsageBucket` and `CostBucket` over `APIUsageLog`.

## Background Jobs

Recurring maintenance is driven through:

- `GET /api/scheduler/maintenance`

It handles:

- provider syncs
- follow-up assistant discovery
- Google Workspace scans
- Microsoft 365 scans

The scheduler runs frequently, but each job checks saved enable/interval settings before doing work.

## Settings Strategy

Settings are split by responsibility:

- `Settings > Users & Identity`
  Authentication providers and user-management options.
- `Settings > Shadow AI`
  Google Workspace and Microsoft 365 discovery configuration.
- `Settings > Provider Admin APIs`
  OpenAI, Anthropic, and related provider integrations.

Secret values are stored in `AppSetting` and encrypted with `SETTINGS_ENCRYPTION_KEY`.

## How To Extend Safely

When adding a new feature, the safest pattern in this codebase is:

1. Update shared domain logic in `src/lib` first.
2. Add or update validation in `src/lib/validations`.
3. Update the route handler in `src/app/api`.
4. Wire the feature into the page/component surface.
5. Add a focused test for the shared logic.
6. If Prisma changes are involved, add a migration and run `prisma generate`.

This project moves faster when business rules stay centralized and page components stay mostly presentational.

## Verification Workflow

For most changes, the standard check set is:

```bash
npx prisma generate
npx eslint <touched-files>
npx tsc --noEmit --pretty false
npm test -- <focused-test-files>
```

If you touch Prisma types, rerun `tsc` after `prisma generate`.

## Common Extension Points

- New governance rule:
  Start in `src/lib/policy-rules.ts`.
- New recommendation:
  Start in `src/lib/governance-recommendations.ts`.
- New risk heuristic:
  Start in `src/lib/risk-center.ts`.
- New branching review question:
  Start in `src/lib/risk-questionnaire.ts`.
- New assessment template:
  Start in `src/lib/risk-templates.ts`.
- New vendor risk signal:
  Start in `src/lib/vendor-risk.ts` or `src/lib/vendor-lifecycle.ts`.
- New Shadow AI source:
  Start with a scanner in `src/lib`, then plug it into `src/lib/scan-executor.ts`.

## Current Caveat

When you add Prisma fields, make sure you:

- update `prisma/schema.prisma`
- create a migration
- run `npx prisma generate`

Some local type errors after schema edits are just stale generated client state and disappear after regeneration.
