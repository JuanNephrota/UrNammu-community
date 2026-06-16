import Link from "next/link";
import { Plus, Shield } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { parseEnforcementMode } from "@/lib/settings";
import { listBlockedEvents } from "@/lib/blocked-events";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

function thirtyDaysAgo() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

export default async function CompliancePage() {
  const blockedSince = thirtyDaysAgo();
  const [policies, assignments, frameworks, activeExceptions] = await Promise.all([
    prisma.policy.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { assignments: true } } },
    }),
    prisma.policyAssignment.groupBy({
      by: ["complianceStatus"],
      _count: true,
    }),
    prisma.policy.groupBy({
      by: ["framework"],
      _count: true,
    }),
    prisma.governanceException.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { gte: new Date() },
      },
      orderBy: { expiresAt: "asc" },
      take: 10,
      include: {
        aiSystem: { select: { id: true, name: true } },
        approvedByUser: { select: { name: true, email: true } },
      },
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  assignments.forEach((a) => { statusCounts[a.complianceStatus] = a._count; });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance & Policy Management"
        description="Track policies, compliance status, and audit trails"
      >
        <Link href="/compliance/policies/new">
          <Button className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110">
            <Plus className="mr-2 h-4 w-4" /> New Policy
          </Button>
        </Link>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/compliance/services?status=COMPLIANT" className="block">
          <StatCard
            title="Compliant"
            value={statusCounts.COMPLIANT ?? 0}
            description="View matching services"
            iconName="FileCheck"
            variant="success"
          />
        </Link>
        <Link href="/compliance/services?status=PARTIALLY_COMPLIANT" className="block">
          <StatCard
            title="Partial"
            value={statusCounts.PARTIALLY_COMPLIANT ?? 0}
            description="View matching services"
            iconName="FileCheck"
            variant="warning"
          />
        </Link>
        <Link href="/compliance/services?status=NON_COMPLIANT" className="block">
          <StatCard
            title="Non-Compliant"
            value={statusCounts.NON_COMPLIANT ?? 0}
            description="View matching services"
            iconName="FileCheck"
            variant="danger"
          />
        </Link>
        <Link href="/compliance/services?status=NOT_ASSESSED" className="block">
          <StatCard
            title="Not Assessed"
            value={statusCounts.NOT_ASSESSED ?? 0}
            description="View matching services"
            iconName="FileCheck"
            variant="default"
          />
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Policies ({policies.length})</CardTitle></CardHeader>
          <CardContent>
            {policies.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No policies created yet.</p>
            ) : (
              <div className="space-y-3">
                {policies.map((p) => (
                  <Link key={p.id} href={`/compliance/policies/${p.id}`} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3 hover:bg-[var(--bg-hover)]">
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{p.framework.replace("_", " ")} &middot; v{p.version}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusBadgeVariant(p.status)}>{p.status}</Badge>
                      <span className="text-xs text-[var(--text-faint)]">{p._count.assignments} assigned</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Framework Coverage</CardTitle></CardHeader>
          <CardContent>
            {frameworks.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No frameworks configured.</p>
            ) : (
              <div className="space-y-3">
                {frameworks.map((f) => (
                  <div key={f.framework} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                    <span className="text-sm font-medium">{f.framework.replace(/_/g, " ")}</span>
                    <Badge variant="info">{f._count} policies</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Active Governance Exceptions</CardTitle></CardHeader>
          <CardContent>
            {activeExceptions.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No active governance exceptions.</p>
            ) : (
              <div className="space-y-3">
                {activeExceptions.map((exception) => (
                  <Link key={exception.id} href={`/registry/${exception.aiSystem.id}`} className="block rounded-md border border-[var(--border-subtle)] p-3 hover:bg-[var(--bg-hover)]">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{exception.title}</p>
                      <Badge variant="warning">{new Date(exception.expiresAt).toLocaleDateString()}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {exception.aiSystem.name} · {exception.approvedByUser.name ?? exception.approvedByUser.email}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-[var(--accent)]" />
                Blocked Queries
              </span>
              <Link href="/compliance/denials">
                <Button variant="outline" size="sm">View All</Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PolicyDenialsPreview since={blockedSince} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Audit Trail</span>
              <Link href="/compliance/audit-trail">
                <Button variant="outline" size="sm">View All</Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AuditTrailPreview />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function PolicyDenialsPreview({ since }: { since: Date }) {
  const [{ items: recent }, modeSetting] = await Promise.all([
    listBlockedEvents({ since }, { skip: 0, take: 5 }),
    prisma.appSetting.findUnique({ where: { key: "policy_enforcement_mode" } }),
  ]);

  const mode = parseEnforcementMode(modeSetting?.value);

  if (recent.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-[var(--text-muted)]">No blocked queries in the last 30 days.</p>
        <p className="text-xs text-[var(--text-faint)]">
          Policy enforcement mode: <span className="font-mono">{mode}</span>
        </p>
      </div>
    );
  }

  const systemIds = Array.from(
    new Set(recent.map((d) => d.aiSystemId).filter((id): id is string => !!id))
  );
  const systems = systemIds.length
    ? await prisma.aISystem.findMany({
        where: { id: { in: systemIds } },
        select: { id: true, name: true },
      })
    : [];
  const systemNames = new Map(systems.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-2">
      {recent.map((event) => (
        <Link
          key={event.id}
          href={event.detailHref}
          className="flex items-center justify-between text-sm hover:underline"
        >
          <span className="truncate">
            <Badge
              variant="outline"
              className={
                event.modeLabel === "enforced" || event.source === "content"
                  ? "mr-2 text-[var(--critical)] border-[var(--critical)]/30"
                  : "mr-2 text-[var(--warning)] border-[var(--warning)]/30"
              }
            >
              {event.source === "policy"
                ? `policy · ${event.modeLabel}`
                : "content"}
            </Badge>
            {event.aiSystemId
              ? systemNames.get(event.aiSystemId) ?? event.aiSystemId
              : "—"}
            {event.model ? ` · ${event.model}` : ""}
          </span>
          <span className="text-xs text-[var(--text-faint)] whitespace-nowrap ml-2">
            {formatDateTime(event.createdAt)}
          </span>
        </Link>
      ))}
      <p className="pt-2 text-xs text-[var(--text-faint)]">
        Policy enforcement mode: <span className="font-mono">{mode}</span>
      </p>
    </div>
  );
}

async function AuditTrailPreview() {
  const logs = await prisma.auditLog.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } } },
  });

  if (logs.length === 0) return <p className="text-sm text-[var(--text-muted)]">No audit logs yet.</p>;

  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <div key={log.id} className="flex items-center justify-between text-sm">
          <span>
            <span className="font-medium">{log.user.name}</span>{" "}
            <span className="text-[var(--text-muted)]">{log.action.toLowerCase()}</span>{" "}
            <span className="text-[var(--text-primary)]">{log.entityType}</span>
          </span>
          <span className="text-xs text-[var(--text-faint)]">
            {new Date(log.createdAt).toLocaleString("en-US")}
          </span>
        </div>
      ))}
    </div>
  );
}
