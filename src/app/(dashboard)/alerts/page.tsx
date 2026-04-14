import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { AlertActions } from "./alert-actions";
import { InvestigationButton } from "@/components/oversight/investigation-button";
import { AlertHighlight } from "./alert-highlight";

export default async function AlertsPage() {
  const alerts = await prisma.alert.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      aiSystem: { select: { id: true, name: true } },
      governanceIncident: { select: { id: true, title: true } },
    },
  });
  // Prisma's generated wrapper types lag new delegates in this environment, so
  // we isolate the cast here while the generated runtime client remains correct.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaAny = prisma as any;
  const investigations = await prismaAny.investigation.findMany({
    where: {
      alertId: { in: alerts.map((alert) => alert.id) },
    },
    select: { id: true, alertId: true, status: true },
  });
  const investigationsByAlert = new Map<string, { id: string; status: string }>(
    investigations.map((item: { id: string; alertId: string; status: string }) => [
      item.alertId,
      { id: item.id, status: item.status },
    ])
  );

  const openAlerts = alerts.filter((a) => a.status === "OPEN");
  const otherAlerts = alerts.filter((a) => a.status !== "OPEN");

  return (
    <div className="space-y-6">
      <AlertHighlight />
      <PageHeader
        title="Alerts"
        description="Monitor governance alerts across all modules"
      />

      {openAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open Alerts ({openAlerts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {openAlerts.map((alert) => (
                <div key={alert.id} id={`alert-${alert.id}`} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-4 transition-all">
                  <div className="flex items-center gap-3">
                    <Badge variant={riskBadgeVariant(alert.severity)}>{alert.severity}</Badge>
                    <div>
                      <p className="text-sm font-medium">{alert.title}</p>
                      {alert.description && (
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{alert.description}</p>
                      )}
                      <p className="text-xs text-[var(--text-faint)] mt-1">
                        {alert.source} &middot; {formatDateTime(alert.createdAt)}
                      </p>
                      {(alert.aiSystem || alert.governanceIncident) && (
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          {alert.aiSystem && (
                            <>
                              System: <Link href={`/registry/${alert.aiSystem.id}`} className="text-[var(--accent)] hover:underline">{alert.aiSystem.name}</Link>
                            </>
                          )}
                          {alert.aiSystem && alert.governanceIncident && " · "}
                          {alert.governanceIncident && <>Incident: {alert.governanceIncident.title}</>}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <AlertActions alertId={alert.id} />
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
              ))}
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
                            <>
                              System: <Link href={`/registry/${alert.aiSystem.id}`} className="text-[var(--accent)] hover:underline">{alert.aiSystem.name}</Link>
                            </>
                          )}
                          {alert.aiSystem && alert.governanceIncident && " · "}
                          {alert.governanceIncident && <>Incident: {alert.governanceIncident.title}</>}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
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
