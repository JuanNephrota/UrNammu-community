"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, MessageSquare, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge, riskBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAgentRiskSummary,
  getRecommendedRiskTier,
  getRiskAssessmentPrompts,
  getRiskControlGaps,
  getRequiredStages,
  getApprovedStages,
  getSystemAgentOverlay,
  type RiskScores,
} from "@/lib/risk-center";
import { getDynamicRiskQuestions } from "@/lib/risk-questionnaire";
import { getRiskAssessmentTemplates } from "@/lib/risk-templates";
import { generateAssessmentIssues, type RiskAssessmentIssueInput } from "@/lib/risk-issues";

interface SystemDetail {
  id: string;
  name: string;
  department: string;
  description?: string | null;
  useCase?: string | null;
  vendor?: string | null;
  modelType?: string | null;
  dataInputs?: string | null;
  dataOutputs?: string | null;
  dataSensitivity: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  reviewIntervalDays: number;
  requireOwnerApproval: boolean;
  requireSecurityApproval: boolean;
  requireLegalApproval: boolean;
  requireComplianceApproval: boolean;
  policyAssignments: Array<{
    complianceStatus: "COMPLIANT" | "PARTIALLY_COMPLIANT" | "NON_COMPLIANT" | "NOT_ASSESSED";
  }>;
  governanceReviews: Array<{
    stage: "OWNER" | "SECURITY" | "LEGAL" | "COMPLIANCE";
    approved: boolean;
  }>;
  approvals: Array<{
    decision: "APPROVED" | "CHANGES_REQUESTED" | "REVOKED";
  }>;
  governanceIncidents: Array<{ id: string }>;
  agents: Array<{
    id: string;
    name: string;
    autonomyLevel: "FULL_AUTONOMY" | "SUPERVISED" | "HUMAN_IN_THE_LOOP" | "HUMAN_ON_THE_LOOP" | "MANUAL";
    humanReviewRequired: boolean;
    humanReviewTriggers?: unknown;
    connectedSystems?: unknown;
    riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "MINIMAL";
    status?: string;
    aiSystemId?: string | null;
  }>;
  _count: {
    evidenceArtifacts: number;
    riskAssessments: number;
  };
}

interface RiskAssessmentFormProps {
  systems: SystemDetail[];
}

type EditableRiskIssue = RiskAssessmentIssueInput & {
  id: string;
};

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
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSystemId, setSelectedSystemId] = useState("");
  const [aiGenerated, setAiGenerated] = useState(false);
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
  const [notes, setNotes] = useState("");
  const [expandedDimensions, setExpandedDimensions] = useState<Set<string>>(new Set());
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);
  const [issues, setIssues] = useState<EditableRiskIssue[]>([]);

  const requestedSystemId = searchParams.get("systemId");

  useEffect(() => {
    if (
      requestedSystemId &&
      !selectedSystemId &&
      systems.some((system) => system.id === requestedSystemId)
    ) {
      setSelectedSystemId(requestedSystemId);
    }
  }, [requestedSystemId, selectedSystemId, systems]);

  const overall = Object.values(scores).reduce((a, b) => a + b, 0) / 6;
  const selectedSystem = systems.find((s) => s.id === selectedSystemId);
  const typedScores = scores as RiskScores;
  const assessmentPrompts = selectedSystem
    ? getRiskAssessmentPrompts(selectedSystem, selectedSystem.agents)
    : [];
  const recommendedTier = selectedSystem
    ? getRecommendedRiskTier({ system: selectedSystem, scores: typedScores, agents: selectedSystem.agents })
    : null;
  const controlGaps = selectedSystem
    ? getRiskControlGaps({
        system: selectedSystem,
        scores: typedScores,
        agents: selectedSystem.agents,
        policyAssignments: selectedSystem.policyAssignments,
        evidenceArtifactCount: selectedSystem._count.evidenceArtifacts,
        requiredStages: getRequiredStages(selectedSystem),
        approvedStages: getApprovedStages(selectedSystem.governanceReviews),
        latestApprovalDecision: selectedSystem.approvals[0]?.decision ?? null,
        openIncidentCount: selectedSystem.governanceIncidents.length,
      })
    : [];
  const dynamicQuestions = selectedSystem
    ? getDynamicRiskQuestions({
        dataSensitivity: selectedSystem.dataSensitivity,
        useCase: selectedSystem.useCase,
        agents: selectedSystem.agents,
      })
    : [];
  const agentOverlay = selectedSystem
    ? getSystemAgentOverlay(selectedSystem.agents, recommendedTier?.recommendedRiskLevel)
    : { summaries: [], maxOverlayScore: 0, reviewNeededCount: 0 };
  const templates = selectedSystem
    ? getRiskAssessmentTemplates({
        useCase: selectedSystem.useCase,
        vendor: selectedSystem.vendor,
        dataSensitivity: selectedSystem.dataSensitivity,
        agents: selectedSystem.agents,
      })
    : [];

  useEffect(() => {
    if (!selectedSystem) {
      setQuestionAnswers({});
      setAppliedTemplateId(null);
      setIssues([]);
      return;
    }

    const questions = getDynamicRiskQuestions({
      dataSensitivity: selectedSystem.dataSensitivity,
      useCase: selectedSystem.useCase,
      agents: selectedSystem.agents,
    });

    setQuestionAnswers((prev) => {
      const next: Record<string, string> = {};
      for (const question of questions) {
        next[question.id] = prev[question.id] ?? "";
      }
      return next;
    });
  }, [selectedSystem]);

  function refreshDerivedIssues(
    nextScores: Record<string, number>,
    nextJustifications: Record<string, string>,
    nextNotes: string
  ) {
    setIssues((prev) => {
      const manualIssues = prev.filter((issue) => issue.source !== "assessment");
      const generated = generateAssessmentIssues({
        scores: nextScores as RiskScores,
        justifications: nextJustifications,
        notes: nextNotes,
      }).map((issue, index) => ({
        ...issue,
        id: `derived-${index}-${issue.category}`,
        status: issue.status ?? "OPEN",
        source: issue.source ?? "assessment",
      }));
      return [...generated, ...manualIssues];
    });
  }

  function applyTemplate(templateId: string) {
    const template = templates.find((entry) => entry.id === templateId);
    if (!template) return;

    setScores(template.defaults.scores);
    setJustifications({
      biasScore: template.defaults.justifications.biasScore ?? "",
      securityScore: template.defaults.justifications.securityScore ?? "",
      privacyScore: template.defaults.justifications.privacyScore ?? "",
      fairnessScore: template.defaults.justifications.fairnessScore ?? "",
      performanceScore: template.defaults.justifications.performanceScore ?? "",
      transparencyScore: template.defaults.justifications.transparencyScore ?? "",
    });
    setExpandedDimensions(
      new Set(
        Object.entries(template.defaults.justifications)
          .filter(([, value]) => !!value?.trim())
          .map(([key]) => key)
      )
    );
    setNotes((prev) => {
      if (!prev.trim()) return template.defaults.notes;
      return prev.includes(template.defaults.notes) ? prev : `${template.defaults.notes}\n\n${prev}`;
    });
    refreshDerivedIssues(
      template.defaults.scores,
      {
        biasScore: template.defaults.justifications.biasScore ?? "",
        securityScore: template.defaults.justifications.securityScore ?? "",
        privacyScore: template.defaults.justifications.privacyScore ?? "",
        fairnessScore: template.defaults.justifications.fairnessScore ?? "",
        performanceScore: template.defaults.justifications.performanceScore ?? "",
        transparencyScore: template.defaults.justifications.transparencyScore ?? "",
      },
      template.defaults.notes
    );
    setAiGenerated(false);
    setAppliedTemplateId(template.id);
  }

  async function handleGenerateAI() {
    if (!selectedSystem) {
      setError("Select an AI system first.");
      return;
    }
    if (!selectedSystem.description) {
      setError("The selected system has no description. Add a description to the system before generating an AI assessment.");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedSystem.name,
          description: selectedSystem.description,
          useCase: selectedSystem.useCase,
          vendor: selectedSystem.vendor,
          modelType: selectedSystem.modelType,
          dataInputs: selectedSystem.dataInputs,
          dataOutputs: selectedSystem.dataOutputs,
          dataSensitivity: selectedSystem.dataSensitivity,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "AI generation failed");
      }

      const result = await res.json();

      // Populate scores
      const newScores: Record<string, number> = {};
      for (const dim of dimensions) {
        newScores[dim.key] = Math.round(result[dim.key] ?? 0);
      }
      setScores(newScores);

      // Populate justifications
      if (result.justifications) {
        const newJustifications: Record<string, string> = {};
        for (const dim of dimensions) {
          newJustifications[dim.key] = result.justifications[dim.key] ?? "";
        }
        setJustifications(newJustifications);
        // Expand all dimensions that have justifications
        setExpandedDimensions(new Set(dimensions.filter((d) => newJustifications[d.key]).map((d) => d.key)));
      }

      // Populate notes
      if (result.notes) {
        setNotes(result.notes);
      }

      const nextJustifications = result.justifications
        ? dimensions.reduce<Record<string, string>>((acc, dim) => {
            acc[dim.key] = result.justifications[dim.key] ?? "";
            return acc;
          }, {})
        : justifications;
      const nextNotes = result.notes ?? notes;
      const generatedIssues = Array.isArray(result.issues)
        ? result.issues
        : generateAssessmentIssues({
            scores: newScores as RiskScores,
            justifications: nextJustifications,
            notes: nextNotes,
          });
      setIssues(
        generatedIssues.map((issue: RiskAssessmentIssueInput, index: number) => ({
          ...issue,
          id: `generated-${index}-${issue.category}`,
          status: issue.status ?? "OPEN",
          source: issue.source ?? "assessment",
        }))
      );

      setAiGenerated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI generation failed");
    } finally {
      setGenerating(false);
    }
  }

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
    setScores((prev) => {
      const next = { ...prev, [key]: value };
      refreshDerivedIssues(next, justifications, notes);
      return next;
    });
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

    const unansweredQuestions = dynamicQuestions.filter(
      (question) => !questionAnswers[question.id]?.trim()
    );
    if (unansweredQuestions.length > 0) {
      setError(
        `Please answer the contextual review questions before submitting: ${unansweredQuestions
          .map((question) => question.title)
          .join(", ")}`
      );
      setLoading(false);
      return;
    }

    // Clean justifications: only include non-empty ones
    const cleanJustifications: Record<string, string> = {};
    for (const [key, value] of Object.entries(justifications)) {
      if (value.trim()) cleanJustifications[key] = value.trim();
    }

    const data = {
      aiSystemId: selectedSystemId,
      ...scores,
      justifications: Object.keys(cleanJustifications).length > 0 ? cleanJustifications : undefined,
      issues: issues.map((issue) => ({
        category: issue.category,
        title: issue.title,
        detail: issue.detail,
        remediation: issue.remediation,
        severity: issue.severity,
        status: issue.status,
        source: issue.source,
      })),
      contextualAnswers: dynamicQuestions.map((question) => ({
        id: question.id,
        category: question.category,
        prompt: question.prompt,
        answer: questionAnswers[question.id].trim(),
      })),
      notes: notes.trim() + (aiGenerated ? "\n\n[Initial assessment generated by AI]" : ""),
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
        <CardContent className="space-y-4">
          <select
            name="aiSystemId"
            required
            value={selectedSystemId}
            onChange={(e) => { setSelectedSystemId(e.target.value); setAiGenerated(false); }}
            className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
          >
            <option value="">Select a system...</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          {/* AI Generate button */}
          <Button
            type="button"
            variant="outline"
            onClick={handleGenerateAI}
            disabled={generating || !selectedSystemId}
            className="w-full gap-2 border-[var(--accent-border)] text-[var(--accent)] hover:bg-[var(--accent-dim)]"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generating ? "Analyzing system..." : "Generate Assessment with AI"}
          </Button>

          {aiGenerated && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <Sparkles className="h-3.5 w-3.5 text-[var(--success)]" />
              <p className="text-xs text-[var(--success)]">
                AI assessment generated. Review and adjust the scores and justifications below before submitting.
              </p>
            </div>
          )}

          {selectedSystem && (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Current Posture
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{selectedSystem.dataSensitivity}</Badge>
                  <Badge variant="info">{selectedSystem.department}</Badge>
                  <Badge variant="outline">
                    {selectedSystem._count.riskAssessments} prior assessments
                  </Badge>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Evidence
                </p>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {selectedSystem._count.evidenceArtifacts} artifact
                  {selectedSystem._count.evidenceArtifacts === 1 ? "" : "s"} on file
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Approval State
                </p>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {selectedSystem.approvals[0]?.decision
                    ? selectedSystem.approvals[0].decision.replace(/_/g, " ")
                    : "No formal decision yet"}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Linked Agents
                </p>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {selectedSystem.agents.length} linked agent
                  {selectedSystem.agents.length === 1 ? "" : "s"}
                  {agentOverlay.reviewNeededCount > 0
                    ? ` · ${agentOverlay.reviewNeededCount} need dedicated review`
                    : ""}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSystem && (
        <Card>
          <CardHeader>
            <CardTitle>Assessment Templates</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            {templates.map((template) => (
              <div
                key={template.id}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {template.label}
                  </p>
                  {template.recommended && <Badge variant="info">Recommended</Badge>}
                  {appliedTemplateId === template.id && (
                    <Badge variant="success">Applied</Badge>
                  )}
                </div>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {template.description}
                </p>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Best for: {template.bestFor}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">
                    Security {template.defaults.scores.securityScore}
                  </Badge>
                  <Badge variant="outline">
                    Privacy {template.defaults.scores.privacyScore}
                  </Badge>
                  <Badge variant="outline">
                    Transparency {template.defaults.scores.transparencyScore}
                  </Badge>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={() => applyTemplate(template.id)}
                >
                  Apply Template
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {selectedSystem && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Assessment Focus</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {assessmentPrompts.map((prompt) => (
                <div
                  key={prompt}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2"
                >
                  <p className="text-sm text-[var(--text-secondary)]">{prompt}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {recommendedTier && (
            <Card>
              <CardHeader>
                <CardTitle>Recommended Risk Tier</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant={riskBadgeVariant(recommendedTier.recommendedRiskLevel)}>
                    {recommendedTier.recommendedRiskLevel}
                  </Badge>
                  <div className="text-right">
                    <p className="text-xs text-[var(--text-faint)]">Adjusted score</p>
                    <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]">
                      {recommendedTier.adjustedScore.toFixed(1)}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  Baseline score: {recommendedTier.baseScore.toFixed(1)}
                </p>
                <div className="space-y-2">
                  {recommendedTier.reasons.slice(0, 4).map((reason) => (
                    <p key={reason} className="text-sm text-[var(--text-secondary)]">
                      {reason}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Control Gaps</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {controlGaps.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  No obvious policy, evidence, or approval gaps detected from the current system record.
                </p>
              ) : (
                controlGaps.map((gap) => (
                  <div
                    key={gap.key}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          gap.tone === "critical"
                            ? "critical"
                            : gap.tone === "warning"
                              ? "warning"
                              : "info"
                        }
                      >
                        {gap.tone}
                      </Badge>
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {gap.title}
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-[var(--text-secondary)]">
                      {gap.detail}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {selectedSystem && dynamicQuestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Contextual Review Questions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {dynamicQuestions.map((question) => (
              <div
                key={question.id}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      question.category === "data_sensitivity"
                        ? "info"
                        : question.category === "autonomy"
                          ? "warning"
                          : "outline"
                    }
                  >
                    {question.category.replace(/_/g, " ")}
                  </Badge>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {question.title}
                  </p>
                </div>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {question.prompt}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {question.helper}
                </p>
                <Textarea
                  value={questionAnswers[question.id] ?? ""}
                  onChange={(e) =>
                    setQuestionAnswers((prev) => ({
                      ...prev,
                      [question.id]: e.target.value,
                    }))
                  }
                  rows={3}
                  className="mt-3"
                  placeholder="Document the current answer, control, or reviewer judgment here..."
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {selectedSystem && selectedSystem.agents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Agent Risk Overlay</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={agentOverlay.maxOverlayScore >= 24 ? "warning" : "info"}>
                Max overlay {agentOverlay.maxOverlayScore}
              </Badge>
              <Badge variant="outline">
                {agentOverlay.reviewNeededCount} need dedicated review
              </Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {selectedSystem.agents.map((agent) => {
                const summary = getAgentRiskSummary(agent, recommendedTier?.recommendedRiskLevel);
                return (
                  <div
                    key={agent.id}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">{agent.name}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {agent.autonomyLevel.replace(/_/g, " ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={riskBadgeVariant(summary.recommendedRiskLevel)}>
                          {summary.recommendedRiskLevel}
                        </Badge>
                        {summary.reviewNeeded && <Badge variant="warning">Review</Badge>}
                      </div>
                    </div>
                    <div className="mt-3 space-y-1">
                      {summary.concerns.slice(0, 2).map((concern) => (
                        <p key={concern} className="text-sm text-[var(--text-secondary)]">
                          {concern}
                        </p>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

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
                        onChange={(e) => {
                          const nextJustifications = {
                            ...justifications,
                            [dim.key]: e.target.value,
                          };
                          setJustifications(nextJustifications);
                          refreshDerivedIssues(scores, nextJustifications, notes);
                        }}
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
        <CardHeader><CardTitle>Assessment Issues</CardTitle></CardHeader>
        <CardContent>
          {issues.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No separate assessment issues have been identified yet. High-risk dimensions and AI-generated follow-up items will appear here automatically.
            </p>
          ) : (
            <div className="space-y-3">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={riskBadgeVariant(issue.severity)}>{issue.severity}</Badge>
                    <Badge variant="outline">{issue.category.replace(/_/g, " ")}</Badge>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{issue.title}</p>
                  </div>
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">{issue.detail}</p>
                  {issue.remediation && (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      Recommended action: {issue.remediation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Overall Notes</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            name="notes"
            rows={3}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              refreshDerivedIssues(scores, justifications, e.target.value);
            }}
            placeholder="General assessment notes, recommendations, or context..."
          />
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
