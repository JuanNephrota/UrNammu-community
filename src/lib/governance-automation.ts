import type {
  AISystemStatus,
  ApprovalDecision,
  GovernanceReviewStage,
} from "@prisma/client";
import { getSystemWorkflowSummary } from "./governance-workflow";
import { buildAliasMap, normalizeDirectoryEmail, resolveAlias } from "./directory-identity";

type AutomationSystem = {
  id: string;
  name: string;
  ownerName: string | null;
  ownerEmail: string | null;
  status: AISystemStatus;
  nextReviewDate: Date | null;
  riskAssessmentsCount: number;
  policyAssignmentsCount: number;
  notAssessedAssignments: number;
  nonCompliantAssignments: number;
  partialAssignments: number;
  latestApprovalDecision: ApprovalDecision | null;
  activeExceptionCount: number;
  requiredStages: GovernanceReviewStage[];
  approvedStages: GovernanceReviewStage[];
};

type AutomationException = {
  id: string;
  aiSystemId: string;
  systemName: string;
  title: string;
  expiresAt: Date;
};

export type GovernanceAutomationCandidate = {
  key: string;
  aiSystemId: string;
  title: string;
  description: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
};

export function evaluateGovernanceAutomation(input: {
  systems: AutomationSystem[];
  exceptions: AutomationException[];
  now: Date;
  reviewNoticeDays: number;
  exceptionNoticeDays: number;
  escalationOverdueDays: number;
}) {
  const reviewRenewals: GovernanceAutomationCandidate[] = [];
  const exceptionRenewals: GovernanceAutomationCandidate[] = [];
  const ownershipEscalations: GovernanceAutomationCandidate[] = [];

  for (const system of input.systems) {
    const workflow = getSystemWorkflowSummary({
      id: system.id,
      status: system.status,
      riskAssessmentsCount: system.riskAssessmentsCount,
      policyAssignmentsCount: system.policyAssignmentsCount,
      notAssessedAssignments: system.notAssessedAssignments,
      nonCompliantAssignments: system.nonCompliantAssignments,
      partialAssignments: system.partialAssignments,
      latestApprovalDecision: system.latestApprovalDecision,
      nextReviewDate: system.nextReviewDate,
      activeExceptionCount: system.activeExceptionCount,
      requiredStages: system.requiredStages,
      approvedStages: system.approvedStages,
    });

    if (system.nextReviewDate) {
      const daysUntilReview =
        (system.nextReviewDate.getTime() - input.now.getTime()) / 86400000;

      if (daysUntilReview >= 0 && daysUntilReview <= input.reviewNoticeDays) {
        reviewRenewals.push({
          key: `review:${system.id}`,
          aiSystemId: system.id,
          title: `${system.name} review renewal is coming up`,
          description: `Scheduled review falls due on ${system.nextReviewDate.toLocaleDateString("en-US")}.`,
          severity: daysUntilReview <= 3 ? "HIGH" : "MEDIUM",
        });
      }

      if (-daysUntilReview >= input.escalationOverdueDays) {
        ownershipEscalations.push({
          key: `escalation:overdue:${system.id}`,
          aiSystemId: system.id,
          title: `${system.name} needs owner escalation`,
          description: `Review is overdue and should be escalated to ${system.ownerName ?? system.ownerEmail ?? "the assigned owner"}.`,
          severity: "HIGH",
        });
      }
    }

    if (!system.ownerName && !system.ownerEmail) {
      ownershipEscalations.push({
        key: `escalation:owner:${system.id}`,
        aiSystemId: system.id,
        title: `${system.name} is missing an accountable owner`,
        description: "Assign a named owner before the system proceeds through governance review.",
        severity: "HIGH",
      });
    }

    if (workflow.readiness === "blocked") {
      ownershipEscalations.push({
        key: `escalation:blocked:${system.id}`,
        aiSystemId: system.id,
        title: `${system.name} is blocked in governance`,
        description: workflow.message,
        severity: "MEDIUM",
      });
    }
  }

  for (const exception of input.exceptions) {
    const daysUntilExpiration =
      (exception.expiresAt.getTime() - input.now.getTime()) / 86400000;
    if (daysUntilExpiration >= 0 && daysUntilExpiration <= input.exceptionNoticeDays) {
      exceptionRenewals.push({
        key: `exception:${exception.id}`,
        aiSystemId: exception.aiSystemId,
        title: `${exception.systemName} exception expires soon`,
        description: `${exception.title} expires on ${exception.expiresAt.toLocaleDateString("en-US")}.`,
        severity: daysUntilExpiration <= 3 ? "HIGH" : "MEDIUM",
      });
    }
  }

  return {
    reviewRenewals,
    exceptionRenewals,
    ownershipEscalations: ownershipEscalations.filter(
      (candidate, index, all) => all.findIndex((item) => item.key === candidate.key) === index
    ),
  };
}

// ── Usage after deactivation ──────────────────────────────────────────────
// Directory sync marks leavers inactive; this rule catches AI activity dated
// after that. The cron (background-jobs.ts) loads deactivated DirectoryPerson
// rows plus the latest activity per email from UsageBucket, AssistantDailyStat
// and APIUsageLog, and raises one HIGH `usage_after_deactivation` alert per
// person per 7 days.

export interface DeactivatedPerson {
  primaryEmail: string;
  aliases: string[];
  displayName?: string | null;
  source: string;
  deactivatedAt: Date;
}

export interface ObservedActivity {
  /** Raw actor email as recorded by the telemetry source. */
  email: string | null;
  /** Where the activity was seen (e.g. "proxy", "claude_code", "cursor"). */
  surface: string;
  /** Latest activity timestamp for that email on that surface. */
  lastActiveAt: Date;
}

export interface UsageAfterDeactivationCandidate {
  key: string;
  email: string;
  title: string;
  description: string;
  severity: "HIGH";
  lastActiveAt: Date;
  surfaces: string[];
}

/**
 * Find people whose directory account was deactivated but who still show AI
 * activity dated after `deactivatedAt`. Activity is matched on the primary
 * email or any alias, case-insensitively. Pure so the rule is testable.
 */
export function evaluateUsageAfterDeactivation(input: {
  people: DeactivatedPerson[];
  activity: ObservedActivity[];
}): UsageAfterDeactivationCandidate[] {
  const aliasMap = buildAliasMap(
    input.people.map((p) => ({ primaryEmail: p.primaryEmail, aliases: p.aliases, active: false }))
  );
  const byPrimary = new Map<string, DeactivatedPerson>();
  for (const person of input.people) {
    const primary = normalizeDirectoryEmail(person.primaryEmail);
    if (primary && !byPrimary.has(primary)) byPrimary.set(primary, person);
  }

  const hits = new Map<string, { lastActiveAt: Date; surfaces: Set<string> }>();
  for (const activity of input.activity) {
    const primary = resolveAlias(activity.email, aliasMap);
    if (!primary) continue;
    const person = byPrimary.get(primary);
    if (!person) continue;
    if (activity.lastActiveAt.getTime() <= person.deactivatedAt.getTime()) continue;
    const hit = hits.get(primary) ?? { lastActiveAt: activity.lastActiveAt, surfaces: new Set<string>() };
    if (activity.lastActiveAt > hit.lastActiveAt) hit.lastActiveAt = activity.lastActiveAt;
    hit.surfaces.add(activity.surface);
    hits.set(primary, hit);
  }

  return [...hits.entries()]
    .map(([email, hit]) => {
      const person = byPrimary.get(email)!;
      const surfaces = [...hit.surfaces].sort();
      const who = person.displayName ? `${person.displayName} (${email})` : email;
      return {
        key: `usage_after_deactivation:${email}`,
        email,
        title: `AI usage after deactivation: ${email}`,
        description:
          `${who} was deactivated in the ${person.source.replace("_", " ")} directory on ` +
          `${person.deactivatedAt.toISOString().slice(0, 10)} but shows AI activity on ` +
          `${surfaces.join(", ")} as recently as ${hit.lastActiveAt.toISOString().slice(0, 10)}. ` +
          "Revoke remaining credentials and confirm offboarding is complete.",
        severity: "HIGH" as const,
        lastActiveAt: hit.lastActiveAt,
        surfaces,
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
}
