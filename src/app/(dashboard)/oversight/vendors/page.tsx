import Link from "next/link";
import { ArrowRight, Building2, FileCheck, Globe2, Plus, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getSession } from "@/lib/auth-guard";
import { canRunWorkflows, checklistProgress } from "@/lib/workflow";
import { getVendorChecklist } from "@/lib/vendor-onboarding";
import { getVendorRiskSummary } from "@/lib/vendor-risk";
import { getVendorLifecycleSummary } from "@/lib/vendor-lifecycle";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function contractBadgeVariant(status: string) {
  if (status === "ACTIVE") return "success";
  if (status === "IN_REVIEW") return "warning";
  if (status === "EXPIRED" || status === "TERMINATED") return "critical";
  return "outline";
}

function reviewBadgeVariant(status: string) {
  if (status === "APPROVED") return "success";
  if (status === "CONDITIONAL" || status === "IN_PROGRESS") return "warning";
  if (status === "REJECTED") return "critical";
  return "outline";
}

function vendorRiskBadgeVariant(tier: string) {
  if (tier === "CRITICAL") return "critical";
  if (tier === "HIGH") return "warning";
  if (tier === "MEDIUM") return "info";
  return "success";
}

type VendorStats = {
  profileId: string | null;
  website: string | null;
  description: string | null;
  systems: number;
  openAlerts: number;
  incidents: number;
  exceptions: number;
  highRisk: number;
  discovered: number;
  approvedUseCases: string[];
  liveUseCases: string[];
  unapprovedUseCases: string[];
  subprocessors: string[];
  dataResidency: string[];
  contractStatus: string;
  contractOwner: string | null;
  contractStartDate: Date | null;
  contractRenewalDate: Date | null;
  renewalNoticeDays: number;
  renewalNotes: string | null;
  securityReviewStatus: string;
  notes: string | null;
  lastAssessmentCompletedAt: Date | null;
  assessmentInProgress: boolean;
  questionnaire: { score: number; tier: string } | null;
};

function emptyStats(): VendorStats {
  return {
    profileId: null,
    website: null,
    description: null,
    systems: 0,
    openAlerts: 0,
    incidents: 0,
    exceptions: 0,
    highRisk: 0,
    discovered: 0,
    approvedUseCases: [],
    liveUseCases: [],
    unapprovedUseCases: [],
    subprocessors: [],
    dataResidency: [],
    contractStatus: "UNKNOWN",
    contractOwner: null,
    contractStartDate: null,
    contractRenewalDate: null,
    renewalNoticeDays: 60,
    renewalNotes: null,
    securityReviewStatus: "NOT_REVIEWED",
    notes: null,
    lastAssessmentCompletedAt: null,
    assessmentInProgress: false,
    questionnaire: null,
  };
}

export default async function VendorGovernancePage() {
  const [systems, vendorProfiles, session] = await Promise.all([
    prisma.aISystem.findMany({
      where: { vendor: { not: null } },
      include: {
        alerts: { where: { status: "OPEN" } },
        governanceIncidents: { where: { status: "OPEN" } },
        governanceExceptions: { where: { status: "ACTIVE", expiresAt: { gte: new Date() } } },
      },
    }),
    prisma.vendorProfile.findMany({
      orderBy: { vendor: "asc" },
      include: {
        assessments: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { status: true, completedAt: true, score: true, tier: true },
        },
      },
    }),
    getSession(),
  ]);
  const canEdit = canRunWorkflows(session?.user.role);

  const discoveredByVendor = await prisma.discoveredAITool.groupBy({
    by: ["vendor"],
    _count: true,
    where: { vendor: { not: null } },
  });
  const vendorMap = new Map<string, VendorStats>();

  for (const system of systems) {
    const key = system.vendor ?? "Unknown";
    const current = vendorMap.get(key) ?? emptyStats();
    current.systems += 1;
    current.openAlerts += system.alerts.length;
    current.incidents += system.governanceIncidents.length;
    current.exceptions += system.governanceExceptions.length;
    current.highRisk += ["CRITICAL", "HIGH"].includes(system.riskLevel) ? 1 : 0;
    if (system.useCase?.trim()) {
      current.liveUseCases = Array.from(new Set([...current.liveUseCases, system.useCase.trim()]));
    }
    vendorMap.set(key, current);
  }

  for (const row of discoveredByVendor) {
    if (!row.vendor) continue;
    const current = vendorMap.get(row.vendor) ?? emptyStats();
    current.discovered = row._count;
    vendorMap.set(row.vendor, current);
  }

  for (const profile of vendorProfiles) {
    const current = vendorMap.get(profile.vendor) ?? emptyStats();
    current.approvedUseCases = asStringArray(profile.approvedUseCases);
    current.subprocessors = asStringArray(profile.subprocessors);
    current.dataResidency = asStringArray(profile.dataResidency);
    current.contractStatus = profile.contractStatus;
    current.contractOwner = profile.contractOwner;
    current.contractStartDate = profile.contractStartDate;
    current.contractRenewalDate = profile.contractRenewalDate;
    current.renewalNoticeDays = profile.renewalNoticeDays;
    current.renewalNotes = profile.renewalNotes;
    current.securityReviewStatus = profile.securityReviewStatus;
    current.notes = profile.notes;
    current.profileId = profile.id;
    current.website = profile.website;
    current.description = profile.description;
    const completedAssessment = profile.assessments.find((a) => a.status === "COMPLETED");
    current.lastAssessmentCompletedAt = completedAssessment?.completedAt ?? null;
    current.assessmentInProgress = profile.assessments.some((a) => a.status === "IN_PROGRESS");
    current.questionnaire =
      completedAssessment?.score != null && completedAssessment.tier
        ? { score: completedAssessment.score, tier: completedAssessment.tier }
        : null;
    current.unapprovedUseCases = current.liveUseCases.filter(
      (useCase) =>
        current.approvedUseCases.length > 0 &&
        !current.approvedUseCases.some(
          (approved) => approved.toLowerCase() === useCase.toLowerCase()
        )
    );
    vendorMap.set(profile.vendor, current);
  }

  const vendors = [...vendorMap.entries()]
    .map(([vendor, stats]) => ({
      vendor,
      stats,
      lifecycle: getVendorLifecycleSummary({
        contractStatus: stats.contractStatus,
        contractStartDate: stats.contractStartDate,
        contractRenewalDate: stats.contractRenewalDate,
        renewalNoticeDays: stats.renewalNoticeDays,
      }),
      risk: getVendorRiskSummary({
        vendor,
        systems: stats.systems,
        openAlerts: stats.openAlerts,
        incidents: stats.incidents,
        exceptions: stats.exceptions,
        highRisk: stats.highRisk,
        discovered: stats.discovered,
        unapprovedUseCases: stats.unapprovedUseCases.length,
        contractStatus: stats.contractStatus,
        securityReviewStatus: stats.securityReviewStatus,
        contractRenewalDate: stats.contractRenewalDate,
        questionnaire: stats.questionnaire,
      }),
      onboarding: stats.profileId
        ? checklistProgress(getVendorChecklist({ ...stats, id: stats.profileId }))
        : null,
    }))
    .sort((a, b) => b.risk.score - a.risk.score || b.stats.systems - a.stats.systems);

  const topVendorRisks = vendors.slice(0, 3);
  const renewalQueue = vendors
    .filter(
      ({ lifecycle }) =>
        lifecycle.phase === "RENEWAL_DUE" ||
        lifecycle.phase === "RENEWAL_SOON" ||
        lifecycle.phase === "OVERDUE" ||
        lifecycle.phase === "EXPIRED"
    )
    .sort((a, b) => {
      const aDays = a.lifecycle.daysUntilRenewal ?? Number.POSITIVE_INFINITY;
      const bDays = b.lifecycle.daysUntilRenewal ?? Number.POSITIVE_INFINITY;
      return aDays - bDays;
    })
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendor Governance"
        description="Track governance posture by AI vendor across approved systems and shadow AI discoveries"
      >
        <Link href="/oversight">
          <Badge variant="info">Back to Oversight</Badge>
        </Link>
        {canEdit && (
          <Link href="/oversight/vendors/new" className={buttonVariants({ size: "sm" })}>
            <Plus className="h-4 w-4" />
            Add vendor
          </Link>
        )}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {topVendorRisks.map(({ vendor, risk, stats }) => (
          <Card key={vendor}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between gap-3 text-base">
                <span className="truncate">{vendor}</span>
                <Badge variant={vendorRiskBadgeVariant(risk.tier)}>
                  {risk.tier} · {risk.score}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-[var(--text-secondary)]">
                {stats.systems} governed systems · {stats.highRisk} high risk · {stats.incidents} incidents
              </p>
              {risk.factors.slice(0, 2).map((factor) => (
                <p key={factor.label} className="text-[var(--text-secondary)]">
                  {factor.label}: {factor.detail}
                </p>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-[var(--accent)]" />
            Contract Renewal Queue
          </CardTitle>
        </CardHeader>
        <CardContent>
          {renewalQueue.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No vendor renewals are currently inside their notice window.
            </p>
          ) : (
            <div className="space-y-3">
              {renewalQueue.map(({ vendor, stats, lifecycle }) => (
                <div
                  key={vendor}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{vendor}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {stats.contractOwner ?? "No owner"} · {lifecycle.message}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={lifecycle.badgeTone}>
                        {lifecycle.phase.replace(/_/g, " ")}
                      </Badge>
                      {lifecycle.daysUntilRenewal !== null && (
                        <Badge variant={lifecycle.daysUntilRenewal <= 30 ? "critical" : "warning"}>
                          {lifecycle.daysUntilRenewal >= 0
                            ? `${lifecycle.daysUntilRenewal} days`
                            : `${Math.abs(lifecycle.daysUntilRenewal)} days overdue`}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {stats.renewalNotes && (
                    <p className="mt-3 text-sm text-[var(--text-secondary)]">
                      {stats.renewalNotes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[var(--accent)]" />
            Vendor Profiles
          </CardTitle>
        </CardHeader>
        <CardContent>
          {vendors.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No vendors yet. Vendors appear here once an AI system or shadow AI discovery names one{canEdit ? ", or add one with Add vendor" : ""}.
            </p>
          ) : (
            <div className="space-y-3">
              {vendors.map(({ vendor, stats, risk, lifecycle, onboarding }) => (
                <div key={vendor} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        {stats.profileId ? (
                          <Link
                            href={`/oversight/vendors/${stats.profileId}`}
                            className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]"
                          >
                            {vendor}
                          </Link>
                        ) : (
                          <p className="text-sm font-semibold text-[var(--text-primary)]">{vendor}</p>
                        )}
                        <p className="text-xs text-[var(--text-muted)]">
                          {stats.systems} governed systems · {stats.discovered} shadow AI discoveries
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={vendorRiskBadgeVariant(risk.tier)}>
                          Vendor risk {risk.score} · {risk.tier}
                        </Badge>
                        <Badge variant={lifecycle.badgeTone}>
                          {lifecycle.phase.replace(/_/g, " ")}
                        </Badge>
                        <Badge variant={stats.highRisk > 0 ? "warning" : "success"}>{stats.highRisk} high risk</Badge>
                        <Badge variant={stats.openAlerts > 0 ? "critical" : "outline"}>{stats.openAlerts} open alerts</Badge>
                        <Badge variant={stats.incidents > 0 ? "critical" : "outline"}>{stats.incidents} incidents</Badge>
                        <Badge variant={stats.exceptions > 0 ? "warning" : "outline"}>{stats.exceptions} exceptions</Badge>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-4">
                      <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          Composite Risk Score
                        </div>
                        <div className="mt-3 flex items-end justify-between gap-3">
                          <div>
                            <p className="text-3xl font-bold text-[var(--text-primary)]">
                              {risk.score}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {risk.tier} risk
                            </p>
                          </div>
                          <Badge variant={vendorRiskBadgeVariant(risk.tier)}>
                            {risk.tier}
                          </Badge>
                        </div>
                        <div className="mt-3 space-y-2 text-xs text-[var(--text-muted)]">
                          {risk.factors.length > 0 ? (
                            risk.factors.slice(0, 3).map((factor) => (
                              <p key={factor.label}>
                                <span className="font-medium text-[var(--text-primary)]">{factor.label}:</span>{" "}
                                +{factor.points}
                              </p>
                            ))
                          ) : (
                            <p>No elevated vendor risk signals detected.</p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                          <FileCheck className="h-4 w-4 text-[var(--accent)]" />
                          Contract Posture
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant={contractBadgeVariant(stats.contractStatus)}>
                            {stats.contractStatus.replace(/_/g, " ")}
                          </Badge>
                          <Badge variant={reviewBadgeVariant(stats.securityReviewStatus)}>
                            {stats.securityReviewStatus.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
                          <p>Owner: {stats.contractOwner ?? "—"}</p>
                          <p>
                            Start:{" "}
                            {stats.contractStartDate
                              ? stats.contractStartDate.toLocaleDateString()
                              : "—"}
                          </p>
                          <p>
                            Renewal:{" "}
                            {stats.contractRenewalDate
                              ? stats.contractRenewalDate.toLocaleDateString()
                              : "—"}
                          </p>
                          <p>Notice window: {stats.renewalNoticeDays} days</p>
                          <p>{lifecycle.message}</p>
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                          <Globe2 className="h-4 w-4 text-[var(--accent)]" />
                          Data Residency & Subprocessors
                        </div>
                        <div className="mt-3 space-y-3 text-xs text-[var(--text-muted)]">
                          <div>
                            <p className="font-medium text-[var(--text-primary)]">Residency</p>
                            <p>{stats.dataResidency.length > 0 ? stats.dataResidency.join(", ") : "Not documented"}</p>
                          </div>
                          <div>
                            <p className="font-medium text-[var(--text-primary)]">Subprocessors</p>
                            <p>{stats.subprocessors.length > 0 ? stats.subprocessors.join(", ") : "Not documented"}</p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                          <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
                          Approved Use Cases
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {stats.approvedUseCases.length > 0 ? (
                            stats.approvedUseCases.map((useCase) => (
                              <Badge key={useCase} variant="outline">{useCase}</Badge>
                            ))
                          ) : (
                            <span className="text-xs text-[var(--text-muted)]">No approved use cases documented</span>
                          )}
                        </div>
                        <div className="mt-3 text-xs text-[var(--text-muted)]">
                          <p>Live use cases: {stats.liveUseCases.length}</p>
                          <p className={stats.unapprovedUseCases.length > 0 ? "text-[var(--warning)]" : ""}>
                            Unapproved live use cases: {stats.unapprovedUseCases.length}
                          </p>
                        </div>
                      </div>
                    </div>

                    {risk.factors.length > 0 && (
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                          Risk Drivers
                        </p>
                        <div className="mt-2 space-y-2">
                          {risk.factors.map((factor) => (
                            <div key={factor.label} className="flex items-start justify-between gap-4 text-sm">
                              <div>
                                <p className="font-medium text-[var(--text-primary)]">{factor.label}</p>
                                <p className="text-[var(--text-secondary)]">{factor.detail}</p>
                              </div>
                              <Badge variant="outline">+{factor.points}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {stats.unapprovedUseCases.length > 0 && (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--warning)]">
                          Unapproved Use Cases
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {stats.unapprovedUseCases.map((useCase) => (
                            <Badge key={useCase} variant="warning">{useCase}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {stats.notes && (
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--text-secondary)]">
                        {stats.notes}
                      </div>
                    )}

                    {stats.renewalNotes && (
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                          Renewal Notes
                        </p>
                        <p className="mt-2 text-sm text-[var(--text-secondary)]">
                          {stats.renewalNotes}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] p-3">
                      {onboarding ? (
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                            <div
                              className={`h-full rounded-full ${onboarding.complete ? "bg-[var(--success)]" : "bg-[var(--accent)]"}`}
                              style={{ width: `${onboarding.percent}%` }}
                            />
                          </div>
                          <p className="truncate text-xs text-[var(--text-muted)]">
                            Onboarding {onboarding.done}/{onboarding.total}
                            {onboarding.next ? ` · Next: ${onboarding.next.label}` : " · Complete"}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)]">
                          In use, but no governance profile yet.
                        </p>
                      )}
                      {stats.profileId ? (
                        <Link
                          href={
                            canEdit && onboarding?.next?.href
                              ? onboarding.next.href
                              : `/oversight/vendors/${stats.profileId}`
                          }
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          {canEdit && onboarding?.next ? "Continue setup" : "Open profile"}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      ) : (
                        canEdit && (
                          <Link
                            href={`/oversight/vendors/new?vendor=${encodeURIComponent(vendor)}`}
                            className={buttonVariants({ size: "sm" })}
                          >
                            Set up profile
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        )
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
