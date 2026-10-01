import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SystemWorkflowSummary } from "@/lib/governance-workflow";

/**
 * Stage badge, one-line message and the "do next" action grid for a
 * governance workflow summary. Serves any entity that produces a
 * `SystemWorkflowSummary` (systems, agents).
 */
export function WorkflowSummaryCard({
  workflow,
  status,
  title = "Governance Workflow",
  className,
}: {
  workflow: SystemWorkflowSummary;
  status: string;
  title?: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-[var(--accent)]" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              workflow.readiness === "blocked"
                ? "critical"
                : workflow.readiness === "ready"
                  ? "success"
                  : workflow.readiness === "monitored"
                    ? "info"
                    : "warning"
            }
          >
            {workflow.stage}
          </Badge>
          <Badge variant="outline">{status.replace(/_/g, " ")}</Badge>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">{workflow.message}</p>
        {workflow.actions.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {workflow.actions.map((action) => (
              <Link
                key={`${action.label}-${action.href}`}
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
                          : "Recommended"}
                  </p>
                </div>
                <Badge variant={action.tone === "info" ? "outline" : action.tone}>{action.tone}</Badge>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
