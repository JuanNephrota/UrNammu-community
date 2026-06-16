import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

export default async function AuditTrailPage() {
  const logs = await prisma.auditLog.findMany({
    take: 100,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, email: true } },
      aiSystem: { select: { name: true } },
      agent: { select: { name: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Trail" description="Complete history of governance actions">
        {/* These point at an API route that streams a file download, not a
            page — <Link> would do a client-side nav and break the download.
            The `download` attribute is both correct here and satisfies
            @next/next/no-html-link-for-pages. */}
        <a href="/api/reports/governance-summary?format=json" download>
          <Button variant="outline">Export JSON Report</Button>
        </a>
        <a href="/api/reports/governance-summary?format=csv" download>
          <Button variant="outline">Export CSV Report</Button>
        </a>
      </PageHeader>
      <Card>
        <CardContent className="pt-6">
          {logs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No audit logs yet.</p>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{log.action}</Badge>
                    <div>
                      <p className="text-sm">
                        <span className="font-medium">{log.user.name ?? log.user.email}</span>{" "}
                        {log.action.toLowerCase()} {log.entityType}
                        {log.aiSystem && ` "${log.aiSystem.name}"`}
                        {log.agent && ` "${log.agent.name}"`}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-[var(--text-faint)] whitespace-nowrap">
                    {formatDateTime(log.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
