import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { AssignPolicyDialog } from "@/components/compliance/assign-policy-dialog";
import { evaluatePolicyRules, parsePolicyRules } from "@/lib/policy-rules";
import {
  ComplianceStatusEditor,
  ComplianceEvidence,
} from "@/components/compliance/compliance-status-editor";
import { AIAssessButton } from "@/components/compliance/ai-assess-button";
import { ComplianceIssueStatusEditor } from "@/components/compliance/compliance-issue-status-editor";

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const policy = await prisma.policy.findUnique({
    where: { id },
    include: {
      assignments: {
        include: {
          issues: {
            orderBy: [{ status: "asc" }, { severity: "desc" }, { createdAt: "asc" }],
          },
          aiSystem: {
            select: {
              id: true,
              name: true,
              vendor: true,
              department: true,
              status: true,
              modelType: true,
              dataSensitivity: true,
              reviewIntervalDays: true,
              riskLevel: true,
              requireOwnerApproval: true,
              requireSecurityApproval: true,
              requireLegalApproval: true,
              requireComplianceApproval: true,
              governanceExceptions: {
                where: { status: "ACTIVE" },
                select: { id: true, expiresAt: true },
              },
            },
          },
        },
      },
    },
  });
  if (!policy) notFound();
  const policyRules = parsePolicyRules(policy.rules);

  return (
    <div className="space-y-6">
      <PageHeader title={policy.name} description={policy.description ?? undefined}>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href={`/compliance/policies/${policy.id}/edit`}>
            <Pencil className="h-3.5 w-3.5" />
            Edit Policy
          </Link>
        </Button>
      </PageHeader>

      <div className="flex gap-2">
        <Badge variant={statusBadgeVariant(policy.status)}>{policy.status}</Badge>
        <Badge variant="info">{policy.framework.replace(/_/g, " ")}</Badge>
        <Badge variant="outline">v{policy.version}</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle>Policy Content</CardTitle></CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-[var(--text-primary)]">
            {policy.content}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Policy Rules</CardTitle></CardHeader>
        <CardContent>
          {Object.keys(policyRules).length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No machine-readable rules are configured for this policy yet.</p>
          ) : (
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              {policyRules.allowedVendors?.length ? (
                <p><span className="font-medium text-[var(--text-primary)]">Allowed vendors:</span> {policyRules.allowedVendors.join(", ")}</p>
              ) : null}
              {policyRules.blockedVendors?.length ? (
                <p><span className="font-medium text-[var(--text-primary)]">Blocked vendors:</span> {policyRules.blockedVendors.join(", ")}</p>
              ) : null}
              {policyRules.blockedDataSensitivities?.length ? (
                <p><span className="font-medium text-[var(--text-primary)]">Blocked data sensitivities:</span> {policyRules.blockedDataSensitivities.join(", ")}</p>
              ) : null}
              {policyRules.maxDataSensitivity ? (
                <p><span className="font-medium text-[var(--text-primary)]">Maximum data sensitivity:</span> {policyRules.maxDataSensitivity}</p>
              ) : null}
              {policyRules.requiredStages?.length ? (
                <p><span className="font-medium text-[var(--text-primary)]">Required stages:</span> {policyRules.requiredStages.join(", ")}</p>
              ) : null}
              {policyRules.allowedDepartments?.length ? (
                <p><span className="font-medium text-[var(--text-primary)]">Allowed departments:</span> {policyRules.allowedDepartments.join(", ")}</p>
              ) : null}
              {policyRules.blockedDepartments?.length ? (
                <p><span className="font-medium text-[var(--text-primary)]">Blocked departments:</span> {policyRules.blockedDepartments.join(", ")}</p>
              ) : null}
              {policyRules.allowedModelPatterns?.length ? (
                <p><span className="font-medium text-[var(--text-primary)]">Allowed model patterns:</span> {policyRules.allowedModelPatterns.join(", ")}</p>
              ) : null}
              {policyRules.blockedModelPatterns?.length ? (
                <p><span className="font-medium text-[var(--text-primary)]">Blocked model patterns:</span> {policyRules.blockedModelPatterns.join(", ")}</p>
              ) : null}
              {policyRules.allowedStatuses?.length ? (
                <p><span className="font-medium text-[var(--text-primary)]">Allowed statuses:</span> {policyRules.allowedStatuses.join(", ")}</p>
              ) : null}
              {policyRules.maxReviewIntervalDays ? (
                <p><span className="font-medium text-[var(--text-primary)]">Max review interval:</span> {policyRules.maxReviewIntervalDays} days</p>
              ) : null}
              {policyRules.minimumRiskLevel ? (
                <p><span className="font-medium text-[var(--text-primary)]">Minimum risk level:</span> {policyRules.minimumRiskLevel}</p>
              ) : null}
              {policyRules.actions ? (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                  <p><span className="font-medium text-[var(--text-primary)]">Enforcement:</span> {policyRules.actions.enforcement ?? "BLOCK"}</p>
                  <p><span className="font-medium text-[var(--text-primary)]">Exception waiver:</span> {policyRules.actions.allowException ? "Allowed" : "Not allowed"}</p>
                  {policyRules.actions.recommendedComplianceStatus ? (
                    <p><span className="font-medium text-[var(--text-primary)]">Violation status:</span> {policyRules.actions.recommendedComplianceStatus}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Assigned Systems ({policy.assignments.length})</CardTitle>
          <AssignPolicyDialog
            policyId={policy.id}
            policyName={policy.name}
            excludeSystemIds={policy.assignments.map((a) => a.aiSystem.id)}
          />
        </CardHeader>
        <CardContent>
          {policy.assignments.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No systems assigned yet. Click &quot;Assign Policy&quot; above to add one.</p>
          ) : (
            <div className="space-y-3">
              {policy.assignments.map((a) => (
                (() => {
                  const activeExceptionCount = a.aiSystem.governanceExceptions.filter(
                    (exception) => new Date(exception.expiresAt).getTime() >= Date.now()
                  ).length;
                  const ruleEvaluation = evaluatePolicyRules(policyRules, {
                    ...a.aiSystem,
                    activeExceptionCount,
                  });
                  return (
                <div
                  key={a.id}
                  className="rounded-lg border border-[var(--border-subtle)] p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{a.aiSystem.name}</p>
                      {a.assessedAt && (
                        <p className="text-xs text-[var(--text-faint)]">
                          Assessed: {formatDate(a.assessedAt)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <AIAssessButton
                        policyId={policy.id}
                        aiSystemId={a.aiSystem.id}
                        systemName={a.aiSystem.name}
                      />
                      <ComplianceStatusEditor
                        assignmentId={a.id}
                        policyId={policy.id}
                        aiSystemId={a.aiSystem.id}
                        currentStatus={a.complianceStatus}
                        currentEvidence={a.evidence}
                        systemName={a.aiSystem.name}
                        policyName={policy.name}
                      />
                    </div>
                  </div>
                  <ComplianceEvidence
                    status={a.complianceStatus}
                    evidence={a.evidence}
                  />
                  {a.issues.length > 0 && (
                    <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                        Compliance Issues
                      </p>
                      <div className="mt-3 space-y-2">
                        {a.issues.map((issue) => (
                          <div
                            key={issue.id}
                            className="rounded-md border border-[var(--border-subtle)] p-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={statusBadgeVariant(issue.status)}>
                                    {issue.status.replace(/_/g, " ")}
                                  </Badge>
                                  <Badge variant={issue.severity === "CRITICAL" ? "critical" : issue.severity === "HIGH" ? "high" : issue.severity === "MEDIUM" ? "medium" : issue.severity === "LOW" ? "low" : "minimal"}>
                                    {issue.severity}
                                  </Badge>
                                  <p className="text-xs font-medium text-[var(--text-primary)]">
                                    {issue.title}
                                  </p>
                                </div>
                                <p className="mt-2 text-xs text-[var(--text-secondary)]">
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
                  {(ruleEvaluation.violations.length > 0 ||
                    ruleEvaluation.waivedViolations.length > 0 ||
                    ruleEvaluation.advisories.length > 0 ||
                    ruleEvaluation.recommendations.length > 0) && (
                    <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                        Rule Evaluation
                      </p>
                      {ruleEvaluation.violations.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {ruleEvaluation.violations.map((violation) => (
                            <p key={violation} className="text-sm text-[var(--critical)]">{violation}</p>
                          ))}
                        </div>
                      )}
                      {ruleEvaluation.waivedViolations.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {ruleEvaluation.waivedViolations.map((violation) => (
                            <p key={violation} className="text-sm text-[var(--warning)]">
                              Waived by active exception: {violation}
                            </p>
                          ))}
                        </div>
                      )}
                      {ruleEvaluation.advisories.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {ruleEvaluation.advisories.map((advisory) => (
                            <p key={advisory} className="text-sm text-[var(--warning)]">{advisory}</p>
                          ))}
                        </div>
                      )}
                      {ruleEvaluation.recommendations.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {ruleEvaluation.recommendations.map((recommendation) => (
                            <p key={recommendation} className="text-sm text-[var(--text-secondary)]">{recommendation}</p>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 text-xs text-[var(--text-faint)]">
                        Recommended compliance status: {ruleEvaluation.recommendedComplianceStatus}
                      </p>
                    </div>
                  )}
                </div>
                  );
                })()
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
