import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil, Bot } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/utils";
import {
  ComplianceStatusEditor,
  ComplianceEvidence,
} from "@/components/compliance/compliance-status-editor";

export default async function SystemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const system = await prisma.aISystem.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, email: true, image: true } },
      agents: {
        select: { id: true, name: true, autonomyLevel: true, status: true, riskLevel: true },
      },
      riskAssessments: { orderBy: { createdAt: "desc" }, take: 5 },
      policyAssignments: {
        include: { policy: { select: { id: true, name: true, framework: true } } },
      },
      auditLogs: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { user: { select: { name: true } } },
      },
    },
  });

  if (!system) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={system.name} description={system.description ?? undefined}>
        <Link href={`/registry/${system.id}/edit`}>
          <Button variant="outline">
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </Button>
        </Link>
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

      <Tabs defaultValue="overview">
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
          <Card>
            <CardContent className="pt-6">
              {system.riskAssessments.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No risk assessments yet.</p>
              ) : (
                <div className="space-y-4">
                  {system.riskAssessments.map((ra) => {
                    const justifications = (ra.justifications ?? {}) as Record<string, string>;
                    const dims = [
                      { key: "biasScore", label: "Bias", score: ra.biasScore },
                      { key: "securityScore", label: "Security", score: ra.securityScore },
                      { key: "privacyScore", label: "Privacy", score: ra.privacyScore },
                      { key: "fairnessScore", label: "Fairness", score: ra.fairnessScore },
                      { key: "performanceScore", label: "Performance", score: ra.performanceScore },
                      { key: "transparencyScore", label: "Transparency", score: ra.transparencyScore },
                    ];
                    return (
                      <div
                        key={ra.id}
                        className="rounded-lg border border-[var(--border-subtle)] p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            Overall Score:{" "}
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
                                  <span className="text-xs font-bold tabular-nums" style={{ color }}>
                                    {dim.score}
                                  </span>
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
            <CardContent className="pt-6">
              {system.policyAssignments.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No policies assigned.</p>
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
                      <ComplianceEvidence
                        status={pa.complianceStatus}
                        evidence={pa.evidence}
                      />
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
