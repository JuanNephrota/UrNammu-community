import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { AssignPolicyDialog } from "@/components/compliance/assign-policy-dialog";
import { evaluatePolicyRules, parsePolicyRules } from "@/lib/policy-rules";
import {
  ComplianceStatusEditor,
  ComplianceEvidence,
} from "@/components/compliance/compliance-status-editor";
import { AIAssessButton } from "@/components/compliance/ai-assess-button";

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
          aiSystem: {
            select: {
              id: true,
              name: true,
              vendor: true,
              dataSensitivity: true,
              reviewIntervalDays: true,
              riskLevel: true,
              requireOwnerApproval: true,
              requireSecurityApproval: true,
              requireLegalApproval: true,
              requireComplianceApproval: true,
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
      <PageHeader title={policy.name} description={policy.description ?? undefined} />

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
              {policyRules.blockedDataSensitivities?.length ? (
                <p><span className="font-medium text-[var(--text-primary)]">Blocked data sensitivities:</span> {policyRules.blockedDataSensitivities.join(", ")}</p>
              ) : null}
              {policyRules.requiredStages?.length ? (
                <p><span className="font-medium text-[var(--text-primary)]">Required stages:</span> {policyRules.requiredStages.join(", ")}</p>
              ) : null}
              {policyRules.maxReviewIntervalDays ? (
                <p><span className="font-medium text-[var(--text-primary)]">Max review interval:</span> {policyRules.maxReviewIntervalDays} days</p>
              ) : null}
              {policyRules.minimumRiskLevel ? (
                <p><span className="font-medium text-[var(--text-primary)]">Minimum risk level:</span> {policyRules.minimumRiskLevel}</p>
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
                  const ruleEvaluation = evaluatePolicyRules(policyRules, a.aiSystem);
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
                  {(ruleEvaluation.violations.length > 0 || ruleEvaluation.recommendations.length > 0) && (
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
                      {ruleEvaluation.recommendations.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {ruleEvaluation.recommendations.map((recommendation) => (
                            <p key={recommendation} className="text-sm text-[var(--text-secondary)]">{recommendation}</p>
                          ))}
                        </div>
                      )}
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
