"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, ShieldAlert, AlertCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils";

type Approval = {
  id: string;
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REVOKED";
  rationale: string | null;
  createdAt: string | Date;
  decidedByUser: {
    name: string | null;
    email: string;
  };
};

export type ApprovalBlockerView = {
  message: string;
  href?: string;
  category:
    | "risk"
    | "policy"
    | "compliance_status"
    | "compliance_evidence"
    | "policy_rule"
    | "stage_review"
    | "review_date";
};

const decisionStyles = {
  APPROVED: {
    label: "Approve System",
    icon: CheckCircle2,
    variant: "success" as const,
  },
  CHANGES_REQUESTED: {
    label: "Request Changes",
    icon: ShieldAlert,
    variant: "warning" as const,
  },
  REVOKED: {
    label: "Revoke Approval",
    icon: RotateCcw,
    variant: "critical" as const,
  },
};

export function ApprovalDecisionCard({
  systemId,
  latestDecision,
  governanceReady,
  approvals,
  blockers = [],
}: {
  systemId: string;
  latestDecision: Approval["decision"] | null;
  governanceReady: boolean;
  approvals: Approval[];
  blockers?: ApprovalBlockerView[];
}) {
  const router = useRouter();
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState<Approval["decision"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: Approval["decision"]) {
    setSubmitting(decision);
    setError(null);

    try {
      const res = await fetch(`/api/ai-systems/${systemId}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          rationale: rationale.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const baseMessage = payload?.error ?? "Failed to save approval decision.";
        const returnedBlockers: ApprovalBlockerView[] | undefined = Array.isArray(
          payload?.blockers
        )
          ? payload.blockers
          : undefined;
        const detail = returnedBlockers?.length
          ? `\n• ${returnedBlockers.map((b) => b.message).join("\n• ")}`
          : "";
        throw new Error(`${baseMessage}${detail}`);
      }

      setRationale("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save approval decision.");
    } finally {
      setSubmitting(null);
    }
  }

  const hardBlockers = blockers.filter((b) => b.category !== "compliance_evidence");
  const softBlockers = blockers.filter((b) => b.category === "compliance_evidence");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval Review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={governanceReady ? "success" : "warning"}>
            {governanceReady
              ? "Ready for decision"
              : `${hardBlockers.length} item${hardBlockers.length === 1 ? "" : "s"} blocking approval`}
          </Badge>
          {latestDecision && (
            <Badge variant={statusBadgeVariant(latestDecision)}>
              {latestDecision.replace(/_/g, " ")}
            </Badge>
          )}
        </div>

        <p className="text-sm text-[var(--text-secondary)]">
          Record formal approval decisions here so the registry has a durable review trail. Approvals
          set the system to `APPROVED`, while change requests and revocations return it to `UNDER REVIEW`.
          Final approval is gated by the required stage reviews and active governance controls.
        </p>

        {hardBlockers.length > 0 && (
          <div className="rounded-md border border-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_8%,var(--bg-base))] p-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--warning)]">
              <AlertCircle className="h-3.5 w-3.5" />
              Resolve before approving
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {hardBlockers.map((blocker, idx) => (
                <li key={idx} className="flex items-start gap-2 leading-snug">
                  <span className="mt-1 text-[var(--warning)]">•</span>
                  {blocker.href ? (
                    <Link
                      href={blocker.href}
                      className="text-[var(--text-primary)] underline-offset-2 hover:underline"
                    >
                      {blocker.message}
                    </Link>
                  ) : (
                    <span className="text-[var(--text-primary)]">{blocker.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {softBlockers.length > 0 && (
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <Info className="h-3.5 w-3.5" />
              Evidence recommended
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {softBlockers.map((blocker, idx) => (
                <li key={idx} className="flex items-start gap-2 leading-snug text-[var(--text-secondary)]">
                  <span className="mt-1 text-[var(--text-faint)]">•</span>
                  {blocker.href ? (
                    <Link href={blocker.href} className="underline-offset-2 hover:underline">
                      {blocker.message}
                    </Link>
                  ) : (
                    <span>{blocker.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <Textarea
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Optional reviewer rationale, follow-up requests, or revocation context..."
            rows={4}
          />
          {error && (
            <p className="whitespace-pre-line text-sm text-[var(--critical)]">{error}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {(["APPROVED", "CHANGES_REQUESTED", "REVOKED"] as const).map((decision) => {
            const config = decisionStyles[decision];
            const Icon = config.icon;
            const disabled = decision === "APPROVED" ? !governanceReady : false;

            return (
              <Button
                key={decision}
                variant={decision === "APPROVED" ? "default" : "outline"}
                disabled={disabled || submitting !== null}
                onClick={() => submit(decision)}
                className={decision === "APPROVED" ? "bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110" : undefined}
              >
                <Icon className="mr-2 h-4 w-4" />
                {submitting === decision ? "Saving..." : config.label}
              </Button>
            );
          })}
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Decision History
          </p>
          {approvals.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No approval decisions recorded yet.</p>
          ) : (
            approvals.map((approval) => (
              <div
                key={approval.id}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusBadgeVariant(approval.decision)}>
                      {approval.decision.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-sm text-[var(--text-secondary)]">
                      {approval.decidedByUser.name ?? approval.decidedByUser.email}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--text-faint)]">
                    {formatDateTime(approval.createdAt)}
                  </span>
                </div>
                {approval.rationale && (
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                    {approval.rationale}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
