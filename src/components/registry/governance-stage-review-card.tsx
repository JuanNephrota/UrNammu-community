"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils";

type Stage = "OWNER" | "SECURITY" | "LEGAL" | "COMPLIANCE";

type Review = {
  id: string;
  stage: Stage;
  approved: boolean;
  rationale: string | null;
  createdAt: string | Date;
  decidedByUser: {
    name: string | null;
    email: string;
  };
};

const stageLabels: Record<Stage, string> = {
  OWNER: "Owner",
  SECURITY: "Security",
  LEGAL: "Legal",
  COMPLIANCE: "Compliance",
};

export function GovernanceStageReviewCard({
  systemId,
  requiredStages,
  reviews,
}: {
  systemId: string;
  requiredStages: Stage[];
  reviews: Review[];
}) {
  const router = useRouter();
  const [rationale, setRationale] = useState("");
  const [submittingStage, setSubmittingStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestByStage = useMemo(() => {
    const map = new Map<Stage, Review>();
    for (const review of reviews) {
      if (!map.has(review.stage)) map.set(review.stage, review);
    }
    return map;
  }, [reviews]);

  async function submit(stage: Stage, approved: boolean) {
    setSubmittingStage(`${stage}-${approved}`);
    setError(null);
    try {
      const res = await fetch(`/api/ai-systems/${systemId}/governance-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          approved,
          rationale: rationale.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save governance review.");
      setRationale("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save governance review.");
    } finally {
      setSubmittingStage(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage Reviews</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Record required stage signoff before final approval. These reviews act as the governance gate for owner, security, legal, and compliance stakeholders.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {requiredStages.map((stage) => {
            const latest = latestByStage.get(stage);
            return (
              <div key={stage} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{stageLabels[stage]} Review</p>
                  <Badge variant={latest?.approved ? "success" : latest ? "warning" : "outline"}>
                    {latest ? (latest.approved ? "Approved" : "Changes Requested") : "Pending"}
                  </Badge>
                </div>
                {latest && (
                  <div className="text-xs text-[var(--text-muted)]">
                    {latest.decidedByUser.name ?? latest.decidedByUser.email} · {formatDateTime(latest.createdAt)}
                  </div>
                )}
                {latest?.rationale && (
                  <p className="text-sm text-[var(--text-secondary)]">{latest.rationale}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => submit(stage, true)}
                    disabled={submittingStage !== null}
                  >
                    {submittingStage === `${stage}-true` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => submit(stage, false)}
                    disabled={submittingStage !== null}
                  >
                    {submittingStage === `${stage}-false` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                    Request Changes
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <Textarea
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="Optional reviewer rationale for the next stage decision..."
          rows={3}
        />
        {error && <p className="text-sm text-[var(--critical)]">{error}</p>}
      </CardContent>
    </Card>
  );
}
