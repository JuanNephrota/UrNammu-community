import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { AlertActions } from "./alert-actions";

export default async function AlertsPage() {
  const alerts = await prisma.alert.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const openAlerts = alerts.filter((a) => a.status === "OPEN");
  const otherAlerts = alerts.filter((a) => a.status !== "OPEN");

  return (
    <div className="space-y-6">
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
                <div key={alert.id} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-4">
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
                    </div>
                  </div>
                  <AlertActions alertId={alert.id} />
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
                <div key={alert.id} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                  <div className="flex items-center gap-3">
                    <Badge variant={riskBadgeVariant(alert.severity)}>{alert.severity}</Badge>
                    <div>
                      <p className="text-sm">{alert.title}</p>
                      <p className="text-xs text-[var(--text-faint)]">{alert.source} &middot; {formatDateTime(alert.createdAt)}</p>
                    </div>
                  </div>
                  <Badge variant={statusBadgeVariant(alert.status)}>{alert.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
