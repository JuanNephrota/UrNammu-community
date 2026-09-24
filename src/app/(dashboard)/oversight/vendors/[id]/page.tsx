import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ClipboardList, Pencil } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Badge, riskBadgeVariant } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChecklistCard } from "@/components/workflow/checklist-card";
import { getSession } from "@/lib/auth-guard";
import { canRunWorkflows } from "@/lib/workflow";
import { getVendorChecklist } from "@/lib/vendor-onboarding";
import { loadVendorProfile } from "@/lib/vendor-profile-data";
import { getVendorRiskSummary } from "@/lib/vendor-risk";
import { getVendorLifecycleSummary } from "@/lib/vendor-lifecycle";

export const dynamic = "force-dynamic";

const tierVariant = { LOW: "success", MEDIUM: "info", HIGH: "warning", CRITICAL: "critical" } as const;

function label(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ completed?: string }>;
}) {
  const [{ id }, { completed }, session] = await Promise.all([params, searchParams, getSession()]);
  const profile = await loadVendorProfile(id);
  if (!profile) notFound();

  const now = new Date();
  const [systems, discovered] = await Promise.all([
    prisma.aISystem.findMany({
      where: { vendor: { equals: profile.vendor, mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        riskLevel: true,
        status: true,
        useCase: true,
        _count: {
          select: {
            alerts: { where: { status: "OPEN" } },
            governanceIncidents: { where: { status: "OPEN" } },
            governanceExceptions: { where: { status: "ACTIVE", expiresAt: { gte: now } } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.discoveredAITool.count({
      where: { vendor: { equals: profile.vendor, mode: "insensitive" } },
    }),
  ]);

  const canEdit = canRunWorkflows(session?.user.role);
  const liveUseCases = [...new Set(systems.map((s) => s.useCase?.trim()).filter(Boolean) as string[])];
  const unapproved =
    profile.approvedUseCases.length > 0
      ? liveUseCases.filter(
          (useCase) => !profile.approvedUseCases.some((a) => a.toLowerCase() === useCase.toLowerCase())
        )
      : [];

  const latestCompleted = profile.latestCompletedAssessment;
  const risk = getVendorRiskSummary({
    vendor: profile.vendor,
    systems: systems.length,
    openAlerts: systems.reduce((sum, s) => sum + s._count.alerts, 0),
    incidents: systems.reduce((sum, s) => sum + s._count.governanceIncidents, 0),
    exceptions: systems.reduce((sum, s) => sum + s._count.governanceExceptions, 0),
    highRisk: systems.filter((s) => ["CRITICAL", "HIGH"].includes(s.riskLevel)).length,
    discovered,
    unapprovedUseCases: unapproved.length,
    contractStatus: profile.contractStatus,
    securityReviewStatus: profile.securityReviewStatus,
    contractRenewalDate: profile.contractRenewalDate,
    questionnaire:
      latestCompleted?.score != null && latestCompleted.tier
        ? { score: latestCompleted.score, tier: latestCompleted.tier }
        : null,
  });
  const lifecycle = getVendorLifecycleSummary({
    contractStatus: profile.contractStatus,
    contractStartDate: profile.contractStartDate,
    contractRenewalDate: profile.contractRenewalDate,
    renewalNoticeDays: profile.renewalNoticeDays,
  });

  const checklist = getVendorChecklist(
    {
      ...profile,
      lastAssessmentCompletedAt: latestCompleted?.completedAt ?? null,
      assessmentInProgress: profile.assessments.some((a) => a.status === "IN_PROGRESS"),
    },
    now
  );
  const inProgress = profile.latestAssessment?.status === "IN_PROGRESS";

  return (
    <div className="space-y-6">
      <PageHeader
        title={profile.vendor}
        description={profile.description ?? "AI vendor governance profile"}
      >
        <Link href="/oversight/vendors">
          <Badge variant="info">All vendors</Badge>
        </Link>
      </PageHeader>

      {completed === "assessment" && latestCompleted && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--success-border)] bg-[var(--success-dim)] p-3 text-sm text-[var(--success-strong)]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          Questionnaire completed. Scored {latestCompleted.score}/100 ({latestCompleted.tier?.toLowerCase()} risk), decision recorded as{" "}
          {label(latestCompleted.decision ?? "")}.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={tierVariant[risk.tier]}>
          Vendor risk {risk.score} · {risk.tier}
        </Badge>
        <Badge variant={lifecycle.badgeTone}>{lifecycle.phase.replace(/_/g, " ")}</Badge>
        <Badge variant="outline">Security review: {label(profile.securityReviewStatus)}</Badge>
        {profile.website && (
          <a
            href={profile.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--accent)] hover:underline"
          >
            {profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        )}
        {canEdit && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Link
              href={`/oversight/vendors/${profile.id}/setup`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit profile
            </Link>
            <Link
              href={`/oversight/vendors/${profile.id}/assessment`}
              className={buttonVariants({ size: "sm" })}
            >
              <ClipboardList className="h-3.5 w-3.5" />
              {inProgress ? "Continue questionnaire" : latestCompleted ? "Re-assess vendor" : "Start questionnaire"}
            </Link>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <ChecklistCard
          title="Vendor onboarding"
          description="What's needed before this vendor is fully governed."
          items={checklist}
          readOnly={!canEdit}
          completeMessage="This vendor is fully documented and reviewed."
        />

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Field term="Contract owner" value={profile.contractOwner} />
                <Field term="Contract status" value={label(profile.contractStatus)} />
                <Field term="Renewal" value={profile.contractRenewalDate?.toLocaleDateString()} hint={lifecycle.message} />
                <Field term="Notice window" value={`${profile.renewalNoticeDays} days`} />
                <Field term="Data residency" value={profile.dataResidency.join(", ")} />
                <Field term="Subprocessors" value={profile.subprocessors.join(", ")} />
                <div className="sm:col-span-2">
                  <dt className="text-xs text-[var(--text-faint)]">Approved use cases</dt>
                  <dd className="mt-1 flex flex-wrap gap-2">
                    {profile.approvedUseCases.length > 0 ? (
                      profile.approvedUseCases.map((u) => (
                        <Badge key={u} variant="outline">
                          {u}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-[var(--text-muted)]">Not documented</span>
                    )}
                    {unapproved.map((u) => (
                      <Badge key={u} variant="warning" title="Live use case not on the approved list">
                        Unapproved: {u}
                      </Badge>
                    ))}
                  </dd>
                </div>
                {profile.notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-[var(--text-faint)]">Conditions and notes</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-[var(--text-secondary)]">{profile.notes}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {risk.factors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Risk drivers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {risk.factors.map((factor) => (
                  <div key={factor.label} className="flex items-start justify-between gap-4 text-sm">
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">{factor.label}</p>
                      <p className="text-[var(--text-secondary)]">{factor.detail}</p>
                    </div>
                    <Badge variant="outline">+{factor.points}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>AI systems using {profile.vendor}</CardTitle>
            </CardHeader>
            <CardContent>
              {systems.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  No registered AI systems name this vendor yet.{" "}
                  {discovered > 0 && `${discovered} shadow AI discover${discovered === 1 ? "y does" : "ies do"}.`}
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {systems.map((system) => (
                    <li key={system.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link
                        href={`/registry/${system.id}`}
                        className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                      >
                        {system.name}
                      </Link>
                      <div className="flex gap-2">
                        <Badge variant={riskBadgeVariant(system.riskLevel)}>{system.riskLevel}</Badge>
                        <Badge variant="outline">{system.status.replace(/_/g, " ")}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Questionnaire history</CardTitle>
            </CardHeader>
            <CardContent>
              {profile.assessments.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No questionnaires yet.</p>
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {profile.assessments.map((assessment) => (
                    <li key={assessment.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <div>
                        <p className="text-[var(--text-primary)]">
                          {assessment.status === "COMPLETED"
                            ? `Completed ${assessment.completedAt?.toLocaleDateString()} by ${assessment.completedBy}`
                            : `Started ${assessment.createdAt.toLocaleDateString()} by ${assessment.startedBy}`}
                        </p>
                        {assessment.decisionNotes && (
                          <p className="text-xs text-[var(--text-muted)]">{assessment.decisionNotes}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {assessment.status === "COMPLETED" ? (
                          <>
                            <Badge variant={tierVariant[(assessment.tier ?? "LOW") as keyof typeof tierVariant] ?? "outline"}>
                              {assessment.score} · {assessment.tier}
                            </Badge>
                            {assessment.decision && <Badge variant="outline">{label(assessment.decision)}</Badge>}
                          </>
                        ) : (
                          <Badge variant="warning">In progress</Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ term, value, hint }: { term: string; value?: string | null; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--text-faint)]">{term}</dt>
      <dd className={value ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}>
        {value || "Not documented"}
      </dd>
      {hint && value && <dd className="text-xs text-[var(--text-faint)]">{hint}</dd>}
    </div>
  );
}
