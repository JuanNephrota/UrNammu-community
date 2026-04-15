import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { AlertActions } from "./alert-actions";
import { InvestigationButton } from "@/components/oversight/investigation-button";
import { AlertHighlight } from "./alert-highlight";
import { RelatedUsageLogs } from "./related-usage-logs";
import { HelpHint } from "@/components/help/help-hint";

type PromptRiskMeta = {
  provider?: string;
  model?: string;
  department?: string;
  userEmail?: string;
  categories?: string[];
  ruleKeys?: string[];
  matchedSignals?: string[];
  excerpt?: string;
};

function isPromptRiskMeta(value: unknown): value is PromptRiskMeta {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CRITICAL_RULE_KEYS = new Set(["secret_extraction", "data_exfiltration", "malware_or_phishing"]);

export default async function AlertsPage() {
  const alerts = await prisma.alert.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      aiSystem: { select: { id: true, name: true } },
      governanceIncident: { select: { id: true, title: true } },
      falsePositiveByUser: { select: { name: true } },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaAny = prisma as any;
  const investigations = await prismaAny.investigation.findMany({
    where: {
      alertId: { in: alerts.map((alert: { id: string }) => alert.id) },
    },
    select: { id: true, alertId: true, status: true },
  });
  const investigationsByAlert = new Map<string, { id: string; status: string }>(
    investigations.map((item: { id: string; alertId: string; status: string }) => [
      item.alertId,
      { id: item.id, status: item.status },
    ])
  );

  const falsePositiveCount = alerts.filter((a) => a.falsePositive).length;
  const openAlerts = alerts.filter((a) => a.status === "OPEN");
  const otherAlerts = alerts.filter((a) => a.status !== "OPEN");

  return (
    <div className="space-y-6">
      <AlertHighlight />
      <PageHeader
        title="Alerts"
        description="Monitor governance alerts across all modules"
      />

      <div className="flex items-center gap-3">
        {falsePositiveCount > 0 && (
          <Badge variant="outline">{falsePositiveCount} marked as false positive</Badge>
        )}
        <Link href="/alerts/prompt-rules" className="text-xs text-[var(--accent)] hover:underline">
          Tune detection rules
        </Link>
        <Link href="/alerts/exceptions" className="text-xs text-[var(--accent)] hover:underline">
          Manage prompt risk exceptions
        </Link>
      </div>

      {openAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open Alerts ({openAlerts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {openAlerts.map((alert) => {
                const meta = isPromptRiskMeta(alert.promptRiskMetadata) ? alert.promptRiskMetadata : null;
                const isDangerousPrompt = alert.source === "dangerous_prompt" && meta;

                return (
                  <div key={alert.id} id={`alert-${alert.id}`} className="rounded-md border border-[var(--border-subtle)] p-4 transition-all space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant={riskBadgeVariant(alert.severity)}>{alert.severity}</Badge>
                        <div>
                          <p className="text-sm font-medium">{alert.title}</p>
                          <p className="text-xs text-[var(--text-faint)] mt-0.5">
                            {alert.source} &middot; {formatDateTime(alert.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <AlertActions
                          alertId={alert.id}
                          promptRiskMetadata={isDangerousPrompt ? meta : null}
                        />
                        <InvestigationButton
                          title={`Investigate: ${alert.title}`}
                          summary={alert.description}
                          aiSystemId={alert.aiSystem?.id ?? null}
                          alertId={alert.id}
                          governanceIncidentId={alert.governanceIncident?.id ?? null}
                          existingInvestigationId={investigationsByAlert.get(alert.id)?.id ?? null}
                        />
                      </div>
                    </div>

                    {/* Structured prompt risk detail */}
                    {isDangerousPrompt ? (
                      <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
                        {/* Provider / model / user context */}
                        <div className="flex flex-wrap items-center gap-2">
                          {meta.provider && <Badge variant="outline">{meta.provider}</Badge>}
                          {meta.model && <Badge variant="outline">{meta.model}</Badge>}
                          {meta.department && (
                            <span className="text-xs text-[var(--text-muted)]">{meta.department}</span>
                          )}
                          {meta.userEmail && (
                            <span className="text-xs text-[var(--text-muted)]">{meta.userEmail}</span>
                          )}
                        </div>

                        {/* Categories as badges */}
                        {meta.categories && meta.categories.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {meta.categories.map((cat, i) => (
                              <Badge
                                key={cat}
                                variant={meta.ruleKeys?.[i] && CRITICAL_RULE_KEYS.has(meta.ruleKeys[i]) ? "critical" : "warning"}
                              >
                                {cat}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* Matched signals */}
                        {meta.matchedSignals && meta.matchedSignals.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] flex items-center gap-1">Matched Signals <HelpHint hint="prompt_risk_signals" /></p>
                            <div className="flex flex-wrap gap-1.5">
                              {meta.matchedSignals.map((signal) => (
                                <code
                                  key={signal}
                                  className="rounded bg-[var(--bg-base)] px-2 py-0.5 text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                                >
                                  {signal}
                                </code>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Excerpt */}
                        {meta.excerpt && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Sanitized Excerpt</p>
                            <pre className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                              {meta.excerpt}
                            </pre>
                          </div>
                        )}

                        {/* Related system / incident */}
                        {(alert.aiSystem || alert.governanceIncident) && (
                          <p className="text-xs text-[var(--text-muted)]">
                            {alert.aiSystem && (
                              <>System: <Link href={`/registry/${alert.aiSystem.id}`} className="text-[var(--accent)] hover:underline">{alert.aiSystem.name}</Link></>
                            )}
                            {alert.aiSystem && alert.governanceIncident && " · "}
                            {alert.governanceIncident && <>Incident: {alert.governanceIncident.title}</>}
                          </p>
                        )}

                        {/* Related usage logs */}
                        <RelatedUsageLogs alertId={alert.id} />
                      </div>
                    ) : (
                      <>
                        {alert.description && (
                          <p className="text-xs text-[var(--text-muted)]">{alert.description}</p>
                        )}
                        {(alert.aiSystem || alert.governanceIncident) && (
                          <p className="text-xs text-[var(--text-muted)]">
                            {alert.aiSystem && (
                              <>System: <Link href={`/registry/${alert.aiSystem.id}`} className="text-[var(--accent)] hover:underline">{alert.aiSystem.name}</Link></>
                            )}
                            {alert.aiSystem && alert.governanceIncident && " · "}
                            {alert.governanceIncident && <>Incident: {alert.governanceIncident.title}</>}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {openAlerts.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-[var(--success)]">All clear</p>
            <p className="text-sm text-[var(--text-muted)]">No open alerts.</p>
          </CardContent>
        </Card>
      )}

      {otherAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>History ({otherAlerts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {otherAlerts.map((alert) => (
                <div key={alert.id} id={`alert-${alert.id}`} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3 transition-all">
                  <div className="flex items-center gap-3">
                    <Badge variant={riskBadgeVariant(alert.severity)}>{alert.severity}</Badge>
                    <div>
                      <p className="text-sm">{alert.title}</p>
                      <p className="text-xs text-[var(--text-faint)]">{alert.source} &middot; {formatDateTime(alert.createdAt)}</p>
                      {(alert.aiSystem || alert.governanceIncident) && (
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          {alert.aiSystem && (
                            <>System: <Link href={`/registry/${alert.aiSystem.id}`} className="text-[var(--accent)] hover:underline">{alert.aiSystem.name}</Link></>
                          )}
                          {alert.aiSystem && alert.governanceIncident && " · "}
                          {alert.governanceIncident && <>Incident: {alert.governanceIncident.title}</>}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {alert.falsePositive && (
                      <Badge variant="outline" title={alert.falsePositiveReason ?? undefined}>
                        False Positive
                      </Badge>
                    )}
                    {investigationsByAlert.get(alert.id) && (
                      <Badge variant="info">{investigationsByAlert.get(alert.id)?.status.replace(/_/g, " ")}</Badge>
                    )}
                    <Badge variant={statusBadgeVariant(alert.status)}>{alert.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
