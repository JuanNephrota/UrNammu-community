import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

type Reason = {
  ruleKey: string;
  message: string;
  policyId: string;
  policyName: string;
};

function modeBadge(mode: string) {
  if (mode === "enforced") {
    return (
      <Badge className="bg-[var(--critical)]/15 text-[var(--critical)] border border-[var(--critical)]/30">
        Enforced — 403 returned
      </Badge>
    );
  }
  if (mode === "dryrun") {
    return (
      <Badge className="bg-[var(--warning)]/15 text-[var(--warning)] border border-[var(--warning)]/30">
        Dry run — passed through
      </Badge>
    );
  }
  return <Badge variant="outline">{mode}</Badge>;
}

export default async function PolicyDenialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const denial = await prisma.policyDenial.findUnique({ where: { id } });
  if (!denial) notFound();

  const reasons: Reason[] = Array.isArray(denial.reasons)
    ? (denial.reasons as unknown as Reason[])
    : [];

  const [aiSystem, policies] = await Promise.all([
    denial.aiSystemId
      ? prisma.aISystem.findUnique({
          where: { id: denial.aiSystemId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    denial.policyIds.length
      ? prisma.policy.findMany({
          where: { id: { in: denial.policyIds } },
          select: { id: true, name: true, framework: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Policy Denial" description={`Denial ${denial.id}`}>
        <Link href="/compliance/denials">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to list
          </Button>
        </Link>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-[var(--text-muted)]">Time</dt>
              <dd className="font-medium">{formatDateTime(denial.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Mode</dt>
              <dd>{modeBadge(denial.mode)}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Provider · Model</dt>
              <dd className="font-medium">
                {denial.provider}
                {denial.model ? ` · ${denial.model}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">AI System</dt>
              <dd>
                {aiSystem ? (
                  <Link
                    href={`/registry/${aiSystem.id}`}
                    className="text-[var(--accent)] hover:underline"
                  >
                    {aiSystem.name}
                  </Link>
                ) : denial.aiSystemId ? (
                  <span className="font-mono text-xs">{denial.aiSystemId}</span>
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">User</dt>
              <dd className="font-medium">{denial.userEmail ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Department</dt>
              <dd className="font-medium">{denial.department ?? "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Violations ({reasons.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reasons.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No violation details recorded.</p>
          ) : (
            reasons.map((reason, index) => (
              <div
                key={index}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Badge variant="outline" className="font-mono">
                    {reason.ruleKey}
                  </Badge>
                  {reason.policyId ? (
                    <Link
                      href={`/compliance/policies/${reason.policyId}`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      {reason.policyName}
                    </Link>
                  ) : (
                    <span className="text-[var(--text-muted)]">{reason.policyName}</span>
                  )}
                </div>
                <p className="mt-2 text-sm">{reason.message}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {policies.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Policies involved</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {policies.map((policy) => (
              <Link
                key={policy.id}
                href={`/compliance/policies/${policy.id}`}
                className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3 text-sm hover:bg-[var(--bg-base)]"
              >
                <span className="font-medium">{policy.name}</span>
                <Badge variant="outline" className="text-xs">
                  {policy.framework}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {denial.promptExcerpt ? (
        <Card>
          <CardHeader>
            <CardTitle>Prompt excerpt</CardTitle>
            <p className="text-xs text-[var(--text-muted)]">
              First 1000 characters captured at the proxy for triage.
            </p>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-base)] p-3 text-xs font-mono text-[var(--text-secondary)] border border-[var(--border-subtle)]">
              {denial.promptExcerpt}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      {denial.requestMetadata ? (
        <Card>
          <CardHeader>
            <CardTitle>Request metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-base)] p-3 text-xs font-mono text-[var(--text-secondary)] border border-[var(--border-subtle)]">
              {JSON.stringify(denial.requestMetadata, null, 2)}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
