"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RiskAssessmentFormProps {
  systems: { id: string; name: string }[];
}

const dimensions = [
  {
    key: "biasScore",
    label: "Bias Risk",
    description: "Potential for discriminatory outputs or decisions",
    placeholder: "e.g. Training data includes demographic imbalances that may produce biased hiring recommendations...",
  },
  {
    key: "securityScore",
    label: "Security Risk",
    description: "Vulnerability to adversarial attacks, data breaches",
    placeholder: "e.g. Model accepts user-provided input without sanitization, making it susceptible to prompt injection...",
  },
  {
    key: "privacyScore",
    label: "Privacy Risk",
    description: "Risk of exposing personal or sensitive data",
    placeholder: "e.g. System processes PII in customer conversations and stores full chat logs...",
  },
  {
    key: "fairnessScore",
    label: "Fairness Risk",
    description: "Unequal treatment across demographic groups",
    placeholder: "e.g. Approval rates differ significantly across demographic groups in testing...",
  },
  {
    key: "performanceScore",
    label: "Performance Risk",
    description: "Risk of unreliable or degraded outputs",
    placeholder: "e.g. Model accuracy degrades on edge cases and rare input patterns...",
  },
  {
    key: "transparencyScore",
    label: "Transparency Risk",
    description: "Lack of explainability or interpretability",
    placeholder: "e.g. Decision rationale is not provided to end users, operates as a black box...",
  },
];

function scoreColor(score: number): string {
  if (score >= 80) return "var(--critical)";
  if (score >= 60) return "var(--high)";
  if (score >= 40) return "var(--medium)";
  if (score >= 20) return "var(--low)";
  return "var(--success)";
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Critical";
  if (score >= 60) return "High";
  if (score >= 40) return "Medium";
  if (score >= 20) return "Low";
  return "Minimal";
}

export function RiskAssessmentForm({ systems }: RiskAssessmentFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({
    biasScore: 0,
    securityScore: 0,
    privacyScore: 0,
    fairnessScore: 0,
    performanceScore: 0,
    transparencyScore: 0,
  });
  const [justifications, setJustifications] = useState<Record<string, string>>({
    biasScore: "",
    securityScore: "",
    privacyScore: "",
    fairnessScore: "",
    performanceScore: "",
    transparencyScore: "",
  });
  const [expandedDimensions, setExpandedDimensions] = useState<Set<string>>(new Set());

  const overall = Object.values(scores).reduce((a, b) => a + b, 0) / 6;

  function toggleExpanded(key: string) {
    setExpandedDimensions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Auto-expand justification when score is >= 40
  function handleScoreChange(key: string, value: number) {
    setScores((prev) => ({ ...prev, [key]: value }));
    if (value >= 40 && !expandedDimensions.has(key)) {
      setExpandedDimensions((prev) => new Set(prev).add(key));
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validate: require justification for any score >= 60
    const highScoresWithoutJustification = dimensions.filter(
      (dim) => scores[dim.key] >= 60 && !justifications[dim.key]?.trim()
    );
    if (highScoresWithoutJustification.length > 0) {
      setError(
        `Please provide a justification for high-risk scores: ${highScoresWithoutJustification.map((d) => d.label).join(", ")}`
      );
      // Auto-expand those dimensions
      setExpandedDimensions((prev) => {
        const next = new Set(prev);
        highScoresWithoutJustification.forEach((d) => next.add(d.key));
        return next;
      });
      setLoading(false);
      return;
    }

    const formData = new FormData(e.currentTarget);

    // Clean justifications: only include non-empty ones
    const cleanJustifications: Record<string, string> = {};
    for (const [key, value] of Object.entries(justifications)) {
      if (value.trim()) cleanJustifications[key] = value.trim();
    }

    const data = {
      aiSystemId: formData.get("aiSystemId") as string,
      ...scores,
      justifications: Object.keys(cleanJustifications).length > 0 ? cleanJustifications : undefined,
      notes: formData.get("notes") as string,
    };

    try {
      const res = await fetch("/api/risk-assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      router.push("/risk-center");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-500/10 p-3 text-sm text-[var(--critical)]">{error}</div>
      )}

      <Card>
        <CardHeader><CardTitle>Select AI System</CardTitle></CardHeader>
        <CardContent>
          <select
            name="aiSystemId"
            required
            className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
          >
            <option value="">Select a system...</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Risk Dimensions</span>
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: scoreColor(overall) }}
              >
                {scoreLabel(overall)}
              </span>
              <span
                className="text-xl font-bold tabular-nums"
                style={{ color: scoreColor(overall) }}
              >
                {overall.toFixed(1)}
              </span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dimensions.map((dim) => {
            const score = scores[dim.key];
            const color = scoreColor(score);
            const isExpanded = expandedDimensions.has(dim.key);
            const hasJustification = !!justifications[dim.key]?.trim();

            return (
              <div
                key={dim.key}
                className="rounded-lg border border-[var(--border-subtle)] transition-colors"
                style={{
                  borderColor: score >= 60 ? `color-mix(in srgb, ${color} 30%, var(--border-subtle))` : undefined,
                }}
              >
                {/* Score header */}
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm font-medium">{dim.label}</Label>
                        {hasJustification && (
                          <MessageSquare className="h-3 w-3 text-[var(--accent)]" />
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-faint)]">{dim.description}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className="text-xs font-semibold uppercase"
                        style={{ color }}
                      >
                        {scoreLabel(score)}
                      </span>
                      <span
                        className="text-lg font-bold tabular-nums w-10 text-right"
                        style={{ color }}
                      >
                        {score}
                      </span>
                    </div>
                  </div>

                  {/* Slider */}
                  <div className="relative">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={score}
                      onChange={(e) => handleScoreChange(dim.key, Number(e.target.value))}
                      className="w-full"
                      style={{ accentColor: color }}
                    />
                    {/* Track background gradient */}
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full pointer-events-none"
                      style={{
                        width: `${score}%`,
                        background: `linear-gradient(90deg, var(--success), ${color})`,
                        opacity: 0.3,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--text-faint)]">
                    <span>Low Risk</span>
                    <span>High Risk</span>
                  </div>
                </div>

                {/* Justification toggle + textarea */}
                <div className="border-t border-[var(--border-subtle)]">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(dim.key)}
                    className="flex w-full items-center justify-between px-4 py-2 text-xs text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <MessageSquare className="h-3 w-3" />
                      {hasJustification
                        ? "Justification provided"
                        : score >= 60
                          ? "Add justification (required for high scores)"
                          : "Add justification (optional)"}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4">
                      <Textarea
                        value={justifications[dim.key]}
                        onChange={(e) =>
                          setJustifications((prev) => ({
                            ...prev,
                            [dim.key]: e.target.value,
                          }))
                        }
                        rows={3}
                        placeholder={dim.placeholder}
                        className="text-xs"
                      />
                      {score >= 60 && !justifications[dim.key]?.trim() && (
                        <p className="text-[10px] text-[var(--warning)] mt-1">
                          Justification required for scores of 60 or above.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Overall Notes</CardTitle></CardHeader>
        <CardContent>
          <Textarea name="notes" rows={3} placeholder="General assessment notes, recommendations, or context..." />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={loading} className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110">
          {loading ? "Saving..." : "Submit Assessment"}
        </Button>
      </div>
    </form>
  );
}
