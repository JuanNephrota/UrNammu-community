"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, riskBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgentRiskSummary } from "@/lib/risk-center";

type Props = {
  agent: {
    id: string;
    name: string;
    description?: string | null;
    autonomyLevel: "FULL_AUTONOMY" | "SUPERVISED" | "HUMAN_IN_THE_LOOP" | "HUMAN_ON_THE_LOOP" | "MANUAL";
    humanReviewRequired: boolean;
    humanReviewTriggers?: unknown;
    connectedSystems?: unknown;
    capabilities?: unknown;
    accessLevel: string;
    department?: string | null;
    riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "MINIMAL";
    aiSystemId?: string | null;
  };
  parentSystem?: {
    name: string;
    riskLevel?: string | null;
    useCase?: string | null;
    dataSensitivity?: string | null;
    vendor?: string | null;
    modelType?: string | null;
  } | null;
  initialReview?: AIReview | null;
};

type AIReview = {
  id?: string;
  recommendedRiskLevel: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reviewNeeded: boolean;
  summary: string;
  concerns: string[];
  recommendations: string[];
  scores: {
    autonomy: number;
    oversight: number;
    blastRadius: number;
    changeRisk: number;
  };
  createdAt?: string;
  generatedBy?: string;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function AgentAIRiskCard({ agent, parentSystem, initialReview = null }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<AIReview | null>(initialReview);

  const heuristic = getAgentRiskSummary(
    {
      id: agent.id,
      name: agent.name,
      autonomyLevel: agent.autonomyLevel,
      humanReviewRequired: agent.humanReviewRequired,
      humanReviewTriggers: agent.humanReviewTriggers,
      connectedSystems: agent.connectedSystems,
      riskLevel: agent.riskLevel,
      aiSystemId: agent.aiSystemId,
    },
    (parentSystem?.riskLevel as Props["agent"]["riskLevel"]) ?? undefined
  );

  async function generateReview() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/assess-agent-risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          name: agent.name,
          description: agent.description,
          autonomyLevel: agent.autonomyLevel,
          humanReviewRequired: agent.humanReviewRequired,
          humanReviewTriggers: agent.humanReviewTriggers,
          connectedSystems: asStringArray(agent.connectedSystems),
          capabilities: asStringArray(agent.capabilities),
          accessLevel: agent.accessLevel,
          department: agent.department,
          parentSystem,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to generate AI review");
      }

      setReview(payload as AIReview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate AI review");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          AI Agent Risk Review
        </CardTitle>
        <Button
          type="button"
          variant="outline"
          onClick={generateReview}
          disabled={loading}
          className="gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? "Analyzing..." : review ? "Refresh AI Review" : "Generate AI Review"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={riskBadgeVariant(heuristic.recommendedRiskLevel)}>
              Heuristic {heuristic.recommendedRiskLevel}
            </Badge>
            {heuristic.reviewNeeded && <Badge variant="warning">Dedicated review suggested</Badge>}
          </div>
          <div className="mt-3 space-y-2">
            {heuristic.concerns.slice(0, 3).map((concern) => (
              <p key={concern} className="text-sm text-[var(--text-secondary)]">
                {concern}
              </p>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-[var(--critical)]/10 p-3 text-sm text-[var(--critical)]">
            {error}
          </div>
        )}

        {review ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={riskBadgeVariant(review.recommendedRiskLevel)}>
                AI {review.recommendedRiskLevel}
              </Badge>
              {review.reviewNeeded && <Badge variant="warning">Review needed</Badge>}
            </div>

            {(review.createdAt || review.generatedBy) && (
              <p className="text-xs text-[var(--text-muted)]">
                Saved {review.createdAt ? new Date(review.createdAt).toLocaleString("en-US") : "recently"}
                {review.generatedBy ? ` by ${review.generatedBy}` : ""}
              </p>
            )}

            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              {review.summary}
            </p>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {Object.entries(review.scores).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                    {key}
                  </p>
                  <p className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
                    {Math.round(value)}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Concerns
                </p>
                <div className="mt-3 space-y-2">
                  {review.concerns.map((concern) => (
                    <p key={concern} className="text-sm text-[var(--text-secondary)]">
                      {concern}
                    </p>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Recommendations
                </p>
                <div className="mt-3 space-y-2">
                  {review.recommendations.map((recommendation) => (
                    <p key={recommendation} className="text-sm text-[var(--text-secondary)]">
                      {recommendation}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            Generate an AI review to assess autonomy, oversight, blast radius, and change risk for this agent using its current registry context.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
