import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GovernanceRecommendation } from "@/lib/governance-recommendations";

const toneLabel: Record<GovernanceRecommendation["tone"], string> = {
  critical: "Needs action",
  warning: "Queue next",
  success: "Ready now",
  info: "Monitor",
};

export function GovernanceRecommendationsCard({
  recommendations,
}: {
  recommendations: GovernanceRecommendation[];
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          Recommended Next Actions
        </CardTitle>
        <Badge variant="info">{recommendations.length} recommendations</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {recommendations.map((recommendation, index) => (
          <Link
            key={recommendation.key}
            href={recommendation.href}
            className="flex items-start justify-between gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 transition-colors hover:bg-[var(--bg-hover)]"
          >
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    recommendation.tone === "critical"
                      ? "critical"
                      : recommendation.tone === "warning"
                        ? "warning"
                        : recommendation.tone === "success"
                          ? "success"
                          : "info"
                  }
                >
                  {index === 0 ? "Top recommendation" : toneLabel[recommendation.tone]}
                </Badge>
                <Badge variant="outline">{recommendation.source}</Badge>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {recommendation.title}
                </p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {recommendation.detail}
                </p>
              </div>
            </div>
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-faint)]" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
