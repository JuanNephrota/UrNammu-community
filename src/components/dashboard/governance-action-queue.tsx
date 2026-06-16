import Link from "next/link";
import { AlertTriangle, ArrowRight, ClipboardList, ShieldCheck, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type QueueItem = {
  label: string;
  description: string;
  count: number;
  href: string;
  tone: "critical" | "warning" | "success" | "info";
};

const toneStyles: Record<QueueItem["tone"], string> = {
  critical: "border-[var(--critical-border)] bg-[var(--critical-faint)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-faint)]",
  success: "border-[var(--success-border)] bg-[var(--success-faint)]",
  info: "border-[var(--info-border)] bg-[var(--info-faint)]",
};

const toneBadge: Record<QueueItem["tone"], "critical" | "warning" | "success" | "info"> = {
  critical: "critical",
  warning: "warning",
  success: "success",
  info: "info",
};

export function GovernanceActionQueue({ items }: { items: QueueItem[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-[var(--accent)]" />
          Governance Action Queue
        </CardTitle>
        <Badge variant="info">{items.reduce((sum, item) => sum + item.count, 0)} open items</Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center justify-between rounded-lg border p-4 transition-all hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] ${toneStyles[item.tone]}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{item.label}</p>
                  <Badge variant={toneBadge[item.tone]}>{item.count}</Badge>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{item.description}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />
            </Link>
          ))}

          {items.length === 0 && (
            <div className="rounded-lg border border-[var(--success-border)] bg-[var(--success-faint)] p-4">
              <div className="flex items-center gap-2 text-[var(--success)]">
                <ShieldCheck className="h-4 w-4" />
                <p className="text-sm font-medium">No governance blockers in the current queue.</p>
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                New discoveries, telemetry anomalies, or compliance gaps will surface here.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function OversightActionQueue({ items }: { items: QueueItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          Oversight Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={`block rounded-lg border p-4 transition-all hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] ${toneStyles[item.tone]}`}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--text-secondary)]" />
              <p className="text-sm font-medium">{item.label}</p>
              <Badge variant={toneBadge[item.tone]}>{item.count}</Badge>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{item.description}</p>
          </Link>
        ))}

        {items.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No telemetry anomalies right now.</p>
        )}
      </CardContent>
    </Card>
  );
}
