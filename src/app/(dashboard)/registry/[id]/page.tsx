import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil, Bot, ClipboardList, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/utils";
import {
  buildCostLookup,
  getBucketIdentityKey,
  buildTelemetryActivityRows,
} from "@/lib/oversight-telemetry";
import {
  getRequiredStages,
  getSystemGovernanceRecommendations,
} from "@/lib/governance-recommendations";
import { AssignPolicyDialog } from "@/components/compliance/assign-policy-dialog";
import { ApprovalDecisionCard } from "@/components/registry/approval-decision-card";
import { GovernanceStageReviewCard } from "@/components/registry/governance-stage-review-card";
import { GovernanceExceptionsCard } from "@/components/registry/governance-exceptions-card";
import { EvidenceArtifactsCard } from "@/components/registry/evidence-artifacts-card";
import { GovernanceIncidentsCard } from "@/components/registry/governance-incidents-card";
import { GovernanceRecommendationsCard } from "@/components/registry/governance-recommendations-card";
import {
  ComplianceStatusEditor,
  ComplianceEvidence,
} from "@/components/compliance/compliance-status-editor";
import { RiskAssessmentIssueStatusEditor } from "@/components/registry/risk-assessment-issue-status-editor";
import { SystemRiskRadar } from "@/components/dashboard/system-risk-radar";
import { SystemRiskTrendChart } from "@/components/dashboard/system-risk-trend-chart";
import { AIAssessButton } from "@/components/compliance/ai-assess-button";
import { ComplianceIssueStatusEditor } from "@/components/compliance/compliance-issue-status-editor";
import { SystemLifecycleActions } from "@/components/registry/system-lifecycle-actions";
import { getApprovalBlockers } from "@/lib/approval-blockers";
import { evaluatePolicyRules, parsePolicyRules } from "@/lib/policy-rules";
import type { GovernanceReviewStage } from "@prisma/client";

export default async function SystemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;

  const system = await prisma.aISystem.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, email: true, image: true } },
      agents: {
        select: { id: true, name: true, autonomyLevel: true, status: true, riskLevel: true },
      },
      riskAssessments: {
        orderBy: { createdAt: "desc" },
        include: {
          issues: {
            orderBy: [{ status: "asc" }, { severity: "desc" }, { createdAt: "asc" }],
          },
        },
      },
      approvals: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          decidedByUser: { select: { name: true, email: true } },
        },
      },
      governanceReviews: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          decidedByUser: { select: { name: true, email: true } },
        },
      },
      governanceExceptions: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          approvedByUser: { select: { name: true, email: true } },
        },
      },
      evidenceArtifacts: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          uploadedByUser: { select: { name: true, email: true } },
        },
      },
      governanceIncidents: {
        orderBy: { openedAt: "desc" },
        take: 20,
        include: {
          openedByUser: { select: { name: true, email: true } },
        },
      },
      policyAssignments: {
        include: {
          issues: {
            orderBy: [{ status: "asc" }, { severity: "desc" }, { createdAt: "asc" }],
          },
          policy: { select: { id: true, name: true, framework: true, rules: true } },
        },
      },
      auditLogs: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { user: { select: { name: true } } },
      },
    },
  });

  if (!system) notFound();

  const linkedDiscoveries = await prisma.discoveredAITool.findMany({
    where: { linkedSystemId: system.id },
    orderBy: { detectedAt: "desc" },
    take: 5,
  });
  const now = new Date();
  const telemetryWindowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [usageBuckets, costBuckets] = await Promise.all([
    prisma.usageBucket.findMany({
      where: {
        aiSystemId: system.id,
        bucketStart: { gte: telemetryWindowStart },
      },
      orderBy: [{ bucketStart: "desc" }, { provider: "asc" }],
      take: 40,
      include: {
        aiSystem: { select: { id: true, name: true } },
      },
    }),
    prisma.costBucket.findMany({
      where: {
        bucketStart: { gte: telemetryWindowStart },
      },
      orderBy: [{ bucketStart: "desc" }],
      take: 120,
    }),
  ]);
  const exceptionSummaries = system.governanceExceptions.map((exception) => ({
    ...exception,
    status:
      exception.status === "ACTIVE" && new Date(exception.expiresAt).getTime() < now.getTime()
        ? "EXPIRED"
        : exception.status,
  }));
  const { workflow, recommendations } = getSystemGovernanceRecommendations({
    id: system.id,
    status: system.status,
    riskLevel: system.riskLevel,
    vendor: system.vendor,
    department: system.department,
    modelType: system.modelType,
    dataSensitivity: system.dataSensitivity,
    reviewIntervalDays: system.reviewIntervalDays,
    nextReviewDate: system.nextReviewDate,
    requireOwnerApproval: system.requireOwnerApproval,
    requireSecurityApproval: system.requireSecurityApproval,
    requireLegalApproval: system.requireLegalApproval,
    requireComplianceApproval: system.requireComplianceApproval,
    riskAssessmentsCount: system.riskAssessments.length,
    latestApprovalDecision: system.approvals[0]?.decision ?? null,
    policyAssignments: system.policyAssignments.map((assignment) => ({
      id: assignment.id,
      complianceStatus: assignment.complianceStatus,
      policy: {
        id: assignment.policy.id,
        name: assignment.policy.name,
        rules: assignment.policy.rules,
      },
    })),
    governanceReviews: system.governanceReviews.map((review) => ({
      stage: review.stage,
      approved: review.approved,
    })),
    governanceExceptions: system.governanceExceptions.map((exception) => ({
      status: exception.status,
      expiresAt: exception.expiresAt,
    })),
    governanceIncidents: system.governanceIncidents.map((incident) => ({
      id: incident.id,
      title: incident.title,
      status: incident.status,
    })),
    linkedDiscoveriesCount: linkedDiscoveries.length,
  });
  const governanceReady = workflow.readiness === "ready" || workflow.readiness === "monitored";
  const requiredStages = getRequiredStages(system);
  const approvalBlockers = (() => {
    const approvedStages = new Set<GovernanceReviewStage>();
    const seenStages = new Set<GovernanceReviewStage>();
    for (const review of system.governanceReviews) {
      if (seenStages.has(review.stage)) continue;
      seenStages.add(review.stage);
      if (review.approved) approvedStages.add(review.stage);
    }
    return getApprovalBlockers({
      systemId: system.id,
      riskAssessmentsCount: system.riskAssessments.length,
      policyAssignments: system.policyAssignments.map((assignment) => {
        const evaluation = evaluatePolicyRules(
          parsePolicyRules(assignment.policy.rules),
          {
            vendor: system.vendor,
            department: system.department,
            status: system.status,
            modelType: system.modelType,
            dataSensitivity: system.dataSensitivity,
            reviewIntervalDays: system.reviewIntervalDays,
            riskLevel: system.riskLevel,
            requireOwnerApproval: system.requireOwnerApproval,
            requireSecurityApproval: system.requireSecurityApproval,
            requireLegalApproval: system.requireLegalApproval,
            requireComplianceApproval: system.requireComplianceApproval,
            activeExceptionCount: system.governanceExceptions.filter(
              (exception) =>
                exception.status === "ACTIVE" &&
                new Date(exception.expiresAt).getTime() >= Date.now()
            ).length,
          }
        );
        return {
          id: assignment.id,
          complianceStatus: assignment.complianceStatus,
          evidenceProvided: Boolean(assignment.evidence && assignment.evidence.trim()),
          policy: { id: assignment.policy.id, name: assignment.policy.name },
          blockingRuleViolations: evaluation.blockingViolations,
        };
      }),
      requiredStages: requiredStages as GovernanceReviewStage[],
      approvedStages,
      nextReviewDate: system.nextReviewDate,
    });
  })();
  const costLookup = buildCostLookup(costBuckets);
  const telemetryRows = buildTelemetryActivityRows(usageBuckets, costLookup, 8);
  const telemetryProviders = new Set(usageBuckets.map((bucket) => bucket.provider));
  const telemetryTokens = usageBuckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0);
  const telemetryRequests = usageBuckets.reduce(
    (sum, bucket) => sum + (bucket.requestCount ?? 0),
    0
  );
  const telemetryCost = usageBuckets.reduce(
    (sum, bucket) => sum + (costLookup.get(getBucketIdentityKey(bucket)) ?? 0),
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader title={system.name} description={system.description ?? undefined}>
        <div className="flex flex-wrap gap-2">
          <Link href={`/registry/${system.id}/edit`}>
            <Button variant="outline">
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
          </Link>
          <SystemLifecycleActions
            systemId={system.id}
            systemName={system.name}
            status={system.status}
          />
        </div>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        <Badge variant={riskBadgeVariant(system.riskLevel)}>
          Risk: {system.riskLevel}
        </Badge>
        <Badge variant={statusBadgeVariant(system.status)}>
          {system.status.replace("_", " ")}
        </Badge>
        <Badge variant="outline">{system.dataSensitivity}</Badge>
        <Badge variant="info">{system.department}</Badge>
      </div>

      <Tabs defaultValue={tab ?? "overview"}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="agents">Agents ({system.agents.length})</TabsTrigger>
          <TabsTrigger value="risk">Risk ({system.riskAssessments.length})</TabsTrigger>
          <TabsTrigger value="compliance">
            Compliance ({system.policyAssignments.length})
          </TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Owner</dt>
                    <dd className="font-medium">{system.owner.name}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Vendor</dt>
                    <dd className="font-medium">{system.vendor ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Model Type</dt>
                    <dd className="font-medium">{system.modelType ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Version</dt>
                    <dd className="font-medium">{system.version ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Created</dt>
                    <dd className="font-medium">{formatDate(system.createdAt)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Next Review</dt>
                    <dd className="font-medium">{system.nextReviewDate ? formatDate(system.nextReviewDate) : "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Review Interval</dt>
                    <dd className="font-medium">{system.reviewIntervalDays} days</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--text-muted)]">Required Stages</dt>
                    <dd className="font-medium text-right">
                      {requiredStages.length > 0 ? requiredStages.map((stage) => stage[0] + stage.slice(1).toLowerCase()).join(", ") : "—"}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Use Case</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[var(--text-secondary)]">
                  {system.useCase ?? "No use case documented."}
                </p>
              </CardContent>
            </Card>
            <ApprovalDecisionCard
              systemId={system.id}
              latestDecision={system.approvals[0]?.decision ?? null}
              governanceReady={governanceReady}
              approvals={system.approvals}
              blockers={approvalBlockers.map(({ message, href, category }) => ({
                message,
                href,
                category,
              }))}
            />
            <GovernanceStageReviewCard
              systemId={system.id}
              requiredStages={requiredStages}
              reviews={system.governanceReviews}
            />
            <GovernanceExceptionsCard
              systemId={system.id}
              exceptions={exceptionSummaries}
            />
            <EvidenceArtifactsCard
              systemId={system.id}
              artifacts={system.evidenceArtifacts}
            />
            <GovernanceIncidentsCard
              systemId={system.id}
              incidents={system.governanceIncidents}
            />
            <Card>
              <CardHeader>
                <CardTitle>Telemetry Attribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                      Last 30 days
                    </p>
                    <p className="mt-2 text-2xl font-semibold">{telemetryTokens.toLocaleString()}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {telemetryRequests.toLocaleString()} requests · ${telemetryCost.toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                      Coverage
                    </p>
                    <p className="mt-2 text-2xl font-semibold">{telemetryProviders.size}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      Providers · {usageBuckets.length} attributed buckets
                    </p>
                  </div>
                </div>

                {telemetryRows.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    No attributed telemetry for this system yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {telemetryRows.map((row) => (
                      <div
                        key={row.id}
                        className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="info" className="capitalize">
                              {row.provider}
                            </Badge>
                            <span className="font-mono text-xs text-[var(--text-secondary)]">
                              {row.model}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {row.tokens.toLocaleString()} tokens · {row.requests.toLocaleString()} requests · ${row.cost.toFixed(4)}
                          </p>
                        </div>
                        <span className="text-xs text-[var(--text-faint)]">
                          {formatDate(row.date)}
                        </span>
                      </div>
                    ))}
                    <Link href="/oversight/usage" className="text-xs font-medium text-[var(--accent)] hover:underline">
                      View full telemetry attribution in Oversight
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
            <GovernanceRecommendationsCard recommendations={recommendations.slice(0, 6)} />
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-[var(--accent)]" />
                  Governance Workflow
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={
                    workflow.readiness === "blocked"
                      ? "critical"
                      : workflow.readiness === "ready"
                        ? "success"
                        : workflow.readiness === "monitored"
                          ? "info"
                          : "warning"
                  }>
                    {workflow.stage}
                  </Badge>
                  <Badge variant="outline">{system.status.replace(/_/g, " ")}</Badge>
                </div>
                <p className="text-sm text-[var(--text-secondary)]">{workflow.message}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {workflow.actions.map((action) => (
                    <Link
                      key={action.label}
                      href={action.href}
                      className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 hover:bg-[var(--bg-hover)]"
                    >
                      <div>
                        <p className="text-sm font-medium">{action.label}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {action.tone === "critical"
                            ? "Required before approval"
                            : action.tone === "warning"
                              ? "Next governance step"
                              : action.tone === "success"
                                ? "Ready for the next review"
                                : "Operational follow-up"}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-[var(--text-faint)]" />
                    </Link>
                  ))}
                </div>
                {linkedDiscoveries.length > 0 && (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                      Linked Discoveries
                    </p>
                    <div className="mt-2 space-y-2">
                      {linkedDiscoveries.map((tool) => (
                        <div key={tool.id} className="flex items-center justify-between text-sm">
                          <span>{tool.toolName}</span>
                          <Badge variant={statusBadgeVariant(tool.status)}>{tool.status}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="agents">
          <Card>
            <CardContent className="pt-6">
              {system.agents.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No agents registered for this system.</p>
              ) : (
                <div className="space-y-3">
                  {system.agents.map((agent) => (
                    <Link
                      key={agent.id}
                      href={`/agents/${agent.id}`}
                      className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3 hover:bg-[var(--bg-hover)]"
                    >
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-[var(--text-faint)]" />
                        <span className="text-sm font-medium">{agent.name}</span>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant={riskBadgeVariant(agent.riskLevel)}>
                          {agent.riskLevel}
                        </Badge>
                        <Badge variant="outline">
                          {agent.autonomyLevel.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk">
          {system.riskAssessments.length > 0 && (
            <div className="space-y-4 mb-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Risk Profile</CardTitle>
                    {system.riskAssessments.length >= 2 && (
                      <p className="text-xs text-[var(--text-muted)]">
                        Current vs previous assessment
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <SystemRiskRadar
                      current={system.riskAssessments[0]}
                      previous={system.riskAssessments[1] ?? null}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Score History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SystemRiskTrendChart
                      assessments={[...system.riskAssessments].reverse()}
                    />
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          <Card>
            <CardContent className="pt-6">
              {system.riskAssessments.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No risk assessments yet.</p>
              ) : (
                <div className="space-y-4">
                  {system.riskAssessments.map((ra) => {
                    const justifications = (ra.justifications ?? {}) as Record<string, string>;
                    const contextualAnswers = Array.isArray(ra.contextualAnswers)
                      ? (ra.contextualAnswers as Array<{
                          id: string;
                          category: string;
                          prompt: string;
                          answer: string;
                        }>)
                      : [];
                    const dims = [
                      { key: "biasScore", label: "Bias", score: ra.biasScore, residual: ra.residualBiasScore },
                      { key: "securityScore", label: "Security", score: ra.securityScore, residual: ra.residualSecurityScore },
                      { key: "privacyScore", label: "Privacy", score: ra.privacyScore, residual: ra.residualPrivacyScore },
                      { key: "fairnessScore", label: "Fairness", score: ra.fairnessScore, residual: ra.residualFairnessScore },
                      { key: "performanceScore", label: "Performance", score: ra.performanceScore, residual: ra.residualPerformanceScore },
                      { key: "transparencyScore", label: "Transparency", score: ra.transparencyScore, residual: ra.residualTransparencyScore },
                    ];
                    return (
                      <div
                        key={ra.id}
                        className="rounded-lg border border-[var(--border-subtle)] p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium">
                              Inherent:{" "}
                              <span
                                className="font-bold"
                                style={{
                                  color:
                                    ra.overallScore >= 80 ? "var(--critical)" :
                                    ra.overallScore >= 60 ? "var(--high)" :
                                    ra.overallScore >= 40 ? "var(--medium)" :
                                    ra.overallScore >= 20 ? "var(--low)" : "var(--success)",
                                }}
                              >
                                {ra.overallScore.toFixed(1)}
                              </span>
                            </span>
                            {ra.residualOverallScore != null && (
                              <span className="text-sm font-medium">
                                Residual:{" "}
                                <span className="font-bold" style={{ color: "var(--success)" }}>
                                  {ra.residualOverallScore.toFixed(1)}
                                </span>
                                <span className="ml-1 text-xs text-[var(--success)]">
                                  (−{(ra.overallScore - ra.residualOverallScore).toFixed(1)})
                                </span>
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-[var(--text-faint)]">
                            {ra.assessedBy} &middot; {formatDate(ra.createdAt)}
                          </span>
                        </div>
                        <div className="grid gap-2">
                          {dims.map((dim) => {
                            const justification = justifications[dim.key];
                            const color =
                              dim.score >= 80 ? "var(--critical)" :
                              dim.score >= 60 ? "var(--high)" :
                              dim.score >= 40 ? "var(--medium)" :
                              dim.score >= 20 ? "var(--low)" : "var(--success)";
                            return (
                              <div key={dim.key} className="rounded-md bg-[var(--bg-base)] px-3 py-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-[var(--text-muted)]">{dim.label}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold tabular-nums" style={{ color }}>
                                      {dim.score}
                                    </span>
                                    {dim.residual != null && (
                                      <span className="text-xs text-[var(--success)] tabular-nums">
                                        → {dim.residual}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {justification && (
                                  <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed"
                                    style={{ borderLeft: `2px solid ${color}`, paddingLeft: "8px" }}
                                  >
                                    {justification}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {ra.notes && (
                          <div className="rounded-md bg-[var(--bg-base)] px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1">Notes</p>
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{ra.notes}</p>
                          </div>
                        )}
                        {ra.issues.length > 0 && (
                          <div className="rounded-md bg-[var(--bg-base)] px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">
                              Assessment Issues
                            </p>
                            <div className="space-y-2">
                              {ra.issues.map((issue) => (
                                <div
                                  key={issue.id}
                                  className="rounded-md border border-[var(--border-subtle)] p-3"
                                >
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant={riskBadgeVariant(issue.severity)}>
                                          {issue.severity}
                                        </Badge>
                                        <Badge variant="outline">
                                          {issue.category.replace(/_/g, " ")}
                                        </Badge>
                                        <p className="text-xs font-medium text-[var(--text-primary)]">
                                          {issue.title}
                                        </p>
                                      </div>
                                      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                                        {issue.detail}
                                      </p>
                                      {issue.remediation && (
                                        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                                          Recommended action: {issue.remediation}
                                        </p>
                                      )}
                                    </div>
                                    <RiskAssessmentIssueStatusEditor
                                      issueId={issue.id}
                                      currentStatus={issue.status}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {contextualAnswers.length > 0 && (
                          <div className="rounded-md bg-[var(--bg-base)] px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">
                              Contextual Review
                            </p>
                            <div className="space-y-2">
                              {contextualAnswers.map((entry) => (
                                <div key={entry.id} className="rounded-md border border-[var(--border-subtle)] p-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline">
                                      {entry.category.replace(/_/g, " ")}
                                    </Badge>
                                    <p className="text-xs font-medium text-[var(--text-primary)]">
                                      {entry.prompt}
                                    </p>
                                  </div>
                                  <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                                    {entry.answer}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance">
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Assigned Policies</CardTitle>
              <AssignPolicyDialog
                systemId={system.id}
                systemName={system.name}
                excludePolicyIds={system.policyAssignments.map((pa) => pa.policy.id)}
              />
            </CardHeader>
            <CardContent className="pt-2">
              {system.policyAssignments.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No policies assigned yet. Click &quot;Assign Policy&quot; above to add one.</p>
              ) : (
                <div className="space-y-3">
                  {system.policyAssignments.map((pa) => (
                    <div
                      key={pa.id}
                      className="rounded-lg border border-[var(--border-subtle)] p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{pa.policy.name}</p>
                          <p className="text-xs text-[var(--text-faint)]">
                            {pa.policy.framework.replace("_", " ")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <AIAssessButton
                            policyId={pa.policy.id}
                            aiSystemId={system.id}
                            systemName={system.name}
                          />
                          <ComplianceStatusEditor
                            assignmentId={pa.id}
                            policyId={pa.policy.id}
                            aiSystemId={system.id}
                            currentStatus={pa.complianceStatus}
                            currentEvidence={pa.evidence}
                            systemName={system.name}
                            policyName={pa.policy.name}
                          />
                        </div>
                      </div>
                      <ComplianceEvidence
                        status={pa.complianceStatus}
                        evidence={pa.evidence}
                      />
                      {pa.issues.length > 0 && (
                        <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">
                            Compliance Issues
                          </p>
                          <div className="space-y-2">
                            {pa.issues.map((issue) => (
                              <div
                                key={issue.id}
                                className="rounded-md border border-[var(--border-subtle)] p-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge variant={riskBadgeVariant(issue.severity)}>
                                        {issue.severity}
                                      </Badge>
                                      <Badge variant="outline">
                                        {issue.requirement}
                                      </Badge>
                                      <p className="text-xs font-medium text-[var(--text-primary)]">
                                        {issue.title}
                                      </p>
                                    </div>
                                    <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                                      {issue.detail}
                                    </p>
                                    {issue.remediation && (
                                      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                                        Recommended action: {issue.remediation}
                                      </p>
                                    )}
                                  </div>
                                  <ComplianceIssueStatusEditor
                                    issueId={issue.id}
                                    currentStatus={issue.status}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardContent className="pt-6">
              {system.auditLogs.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No audit logs.</p>
              ) : (
                <div className="space-y-3">
                  {system.auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                    >
                      <div>
                        <p className="text-sm">
                          <span className="font-medium">{log.user.name}</span>{" "}
                          <span className="text-[var(--text-muted)]">{log.action.toLowerCase()}</span>{" "}
                          this system
                        </p>
                      </div>
                      <span className="text-xs text-[var(--text-muted)]">
                        {formatDate(log.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
