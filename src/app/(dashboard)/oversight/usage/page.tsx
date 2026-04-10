import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

export default async function UsageLogsPage() {
  const logs = await prisma.aPIUsageLog.findMany({
    take: 100,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage Logs"
        description="Detailed Claude and ChatGPT API usage records"
      />

      <Card>
        <CardContent className="pt-6">
          {logs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No usage logs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Provider</th>
                    <th className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Model</th>
                    <th className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">User</th>
                    <th className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Department</th>
                    <th className="text-right px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Tokens</th>
                    <th className="text-right px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Cost</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Flagged</th>
                    <th className="text-right px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors">
                      <td className="px-3 py-3">
                        <Badge variant="info" className="capitalize">{log.provider}</Badge>
                      </td>
                      <td className="px-3 py-3 text-[var(--text-secondary)] font-mono text-xs">
                        {log.model ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-[var(--text-secondary)]">
                        {log.user?.name ?? log.user?.email ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-[var(--text-muted)]">
                        {log.department ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                        {log.totalTokens.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                        ${log.cost.toFixed(4)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {log.flagged ? (
                          <Badge variant="critical">Yes</Badge>
                        ) : (
                          <span className="text-[var(--text-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-xs text-[var(--text-faint)] whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
