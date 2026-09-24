"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WizardStepper } from "@/components/workflow/wizard-stepper";
import { WizardFooter } from "@/components/workflow/wizard-footer";
import { cn } from "@/lib/utils";
import {
  VENDOR_QUESTION_SECTIONS,
  scoreVendorQuestionnaire,
  sectionProgress,
  type VendorAnswerValue,
  type VendorAnswers,
  type VendorQuestion,
} from "@/lib/vendor-questionnaire";

interface VendorAssessmentWizardProps {
  profileId: string;
  vendor: string;
  assessmentId: string;
  initialAnswers: VendorAnswers;
  initialStepId: string;
}

const REVIEW_STEP = { id: "review", label: "Decide", description: "Score and decision" };
const STEPS = [
  ...VENDOR_QUESTION_SECTIONS.map((section) => ({
    id: section.id,
    label: section.shortTitle,
    description: `${section.questions.length} questions`,
  })),
  REVIEW_STEP,
];

const DECISIONS = [
  { value: "APPROVED", label: "Approve", detail: "Cleared for the approved use cases." },
  { value: "CONDITIONAL", label: "Approve with conditions", detail: "Allowed, with the conditions you note below." },
  { value: "REJECTED", label: "Reject", detail: "Not cleared for use. Consider blocking it in Shadow AI." },
] as const;

const tierVariant = { LOW: "success", MEDIUM: "info", HIGH: "warning", CRITICAL: "critical" } as const;

function answerOptions(question: VendorQuestion): Array<{ value: VendorAnswerValue; label: string }> {
  return [
    { value: "yes", label: "Yes" },
    { value: "partial", label: "Partly" },
    { value: "no", label: "No" },
    { value: "unknown", label: "Don't know" },
    ...(question.allowNa ? [{ value: "na" as const, label: "Not applicable" }] : []),
  ];
}

function isRisky(question: VendorQuestion, value: VendorAnswerValue | undefined) {
  if (!value || value === "na") return false;
  return value !== question.safeAnswer;
}

export function VendorAssessmentWizard({
  profileId,
  vendor,
  assessmentId,
  initialAnswers,
  initialStepId,
}: VendorAssessmentWizardProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<VendorAnswers>(initialAnswers);
  const [stepId, setStepId] = useState(
    STEPS.some((step) => step.id === initialStepId) ? initialStepId : STEPS[0].id
  );
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [decision, setDecision] = useState<string>("");
  const [decisionNotes, setDecisionNotes] = useState("");

  const result = useMemo(() => scoreVendorQuestionnaire(answers), [answers]);
  const stepIndex = STEPS.findIndex((step) => step.id === stepId);
  const section = VENDOR_QUESTION_SECTIONS.find((entry) => entry.id === stepId);
  const completed = new Set(
    VENDOR_QUESTION_SECTIONS.filter((entry) => sectionProgress(entry, answers).complete).map(
      (entry) => entry.id
    )
  );

  function setAnswer(questionId: string, patch: { value?: VendorAnswerValue; note?: string }) {
    setAnswers((prev) => {
      const current = prev[questionId];
      const value = patch.value ?? current?.value;
      if (!value) return prev; // a note needs an answer first
      return { ...prev, [questionId]: { value, note: patch.note ?? current?.note } };
    });
    setDirtyIds((prev) => new Set(prev).add(questionId));
    setStatus(null);
  }

  function goTo(next: string) {
    setStepId(next);
    setError(null);
    window.history.replaceState(null, "", `/oversight/vendors/${profileId}/assessment?step=${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveAndGo(target: string) {
    if (dirtyIds.size === 0) {
      goTo(target);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const changed = Object.fromEntries(
        [...dirtyIds].filter((id) => answers[id]).map((id) => [id, answers[id]])
      );
      const res = await fetch(`/api/vendor-assessments/${assessmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: changed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save your answers");
      }
      setDirtyIds(new Set());
      setStatus("Saved");
      goTo(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your answers");
    } finally {
      setSaving(false);
    }
  }

  async function complete() {
    if (!decision) {
      setError("Choose a decision.");
      return;
    }
    if (decision === "CONDITIONAL" && !decisionNotes.trim()) {
      setError("Describe the conditions for this approval.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/vendor-assessments/${assessmentId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, decisionNotes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not complete the questionnaire");
      }
      router.push(`/oversight/vendors/${profileId}?completed=assessment`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete the questionnaire");
      setSaving(false);
    }
  }

  const prevStep = STEPS[stepIndex - 1]?.id;
  const nextStep = STEPS[stepIndex + 1]?.id;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
      <div className="min-w-0 space-y-6">
        <WizardStepper
          steps={STEPS}
          currentStepId={stepId}
          completedStepIds={completed}
          onSelect={(id) => saveAndGo(id)}
          disabled={saving}
        />

        {section && (
          <Card>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <p className="text-sm text-[var(--text-muted)]">{section.description}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {section.questions.map((question, index) => {
                const answer = answers[question.id];
                const risky = isRisky(question, answer?.value);
                return (
                  <fieldset
                    key={question.id}
                    className={cn(
                      "rounded-lg border bg-[var(--bg-base)] p-4",
                      risky ? "border-[var(--warning-border)]" : "border-[var(--border-subtle)]"
                    )}
                  >
                    <legend className="sr-only">{question.prompt}</legend>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 text-xs font-semibold tabular-nums text-[var(--text-faint)]">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1 space-y-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-[var(--text-primary)]">{question.prompt}</p>
                            {question.critical && <Badge variant="outline">Key control</Badge>}
                          </div>
                          <p className="mt-1 text-xs text-[var(--text-faint)]">{question.helper}</p>
                        </div>
                        <div role="radiogroup" aria-label={question.prompt} className="flex flex-wrap gap-2">
                          {answerOptions(question).map((option) => {
                            const selected = answer?.value === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => setAnswer(question.id, { value: option.value })}
                                className={cn(
                                  "rounded-md border px-3 py-1.5 text-sm transition-colors",
                                  selected
                                    ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                                    : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                )}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                        {answer && (
                          <Textarea
                            value={answer.note ?? ""}
                            onChange={(e) => setAnswer(question.id, { note: e.target.value })}
                            rows={2}
                            aria-label={`Evidence or notes for: ${question.prompt}`}
                            placeholder={
                              risky
                                ? "What's the gap, and is there a compensating control?"
                                : "Evidence, e.g. link to the report or the contract clause (optional)"
                            }
                            className="text-sm"
                          />
                        )}
                      </div>
                    </div>
                  </fieldset>
                );
              })}

              <WizardFooter
                onBack={prevStep ? () => saveAndGo(prevStep) : undefined}
                onNext={() => nextStep && saveAndGo(nextStep)}
                saving={saving}
                error={error}
                status={status ?? `${sectionProgress(section, answers).answered} of ${section.questions.length} answered`}
              />
            </CardContent>
          </Card>
        )}

        {stepId === "review" && (
          <Card>
            <CardHeader>
              <CardTitle>Review & decide</CardTitle>
              <p className="text-sm text-[var(--text-muted)]">
                Unanswered questions count as &ldquo;Don&rsquo;t know&rdquo;. Your decision becomes {vendor}&rsquo;s
                security review status and the questionnaire is locked.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {result.answered < result.total && (
                <div className="flex items-start gap-2 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-dim)] p-3 text-sm text-[var(--warning-strong)]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {result.total - result.answered} question{result.total - result.answered === 1 ? " is" : "s are"}{" "}
                    unanswered.{" "}
                    {VENDOR_QUESTION_SECTIONS.filter((entry) => !completed.has(entry.id)).map((entry, i) => (
                      <span key={entry.id}>
                        {i > 0 && ", "}
                        <button type="button" className="underline" onClick={() => goTo(entry.id)}>
                          {entry.title}
                        </button>
                      </span>
                    ))}
                  </span>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Findings
                </p>
                {result.findings.length === 0 ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-[var(--success-strong)]">
                    <CheckCircle2 className="h-4 w-4" /> No gaps found.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {result.findings.map((finding) => (
                      <li
                        key={finding.questionId}
                        className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="text-[var(--text-primary)]">{finding.prompt}</p>
                          <p className="text-xs text-[var(--text-faint)]">
                            {finding.sectionTitle} · answered{" "}
                            {finding.value === "unknown" && !answers[finding.questionId]
                              ? "nothing"
                              : `"${answerOptionsLabel(finding.value)}"`}
                          </p>
                        </div>
                        {finding.critical && <Badge variant="critical">Key control</Badge>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-3">
                <Label>Decision</Label>
                <div role="radiogroup" aria-label="Decision" className="grid gap-3 md:grid-cols-3">
                  {DECISIONS.map((option) => {
                    const selected = decision === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          setDecision(option.value);
                          setError(null);
                        }}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors",
                          selected
                            ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                            : "border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                          {option.label}
                          {result.suggestedDecision === option.value && (
                            <Badge variant="info">Suggested</Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">{option.detail}</div>
                      </button>
                    );
                  })}
                </div>
                <Textarea
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  rows={3}
                  aria-label="Decision notes"
                  placeholder={
                    decision === "CONDITIONAL"
                      ? "Conditions, e.g. no customer PII, zero data retention must be enabled"
                      : "Reasoning for the record (optional)"
                  }
                />
              </div>

              {error && (
                <div role="alert" className="rounded-md bg-[var(--critical-dim)] p-3 text-sm text-[var(--critical-strong)]">
                  {error}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
                <Button type="button" variant="ghost" onClick={() => prevStep && goTo(prevStep)} disabled={saving}>
                  Back
                </Button>
                <div className="flex flex-wrap gap-3">
                  <Link href={`/oversight/vendors/${profileId}`} className={buttonVariants({ variant: "outline" })}>
                    Finish later
                  </Link>
                  <Button type="button" onClick={complete} disabled={saving || !decision}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Complete questionnaire
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Running score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.answered === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Not scored yet. Answer a question to start.</p>
            ) : (
              <div className="flex items-end justify-between">
                <p className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">{result.score}</p>
                <Badge variant={tierVariant[result.tier]}>{result.tier}</Badge>
              </div>
            )}
            <p className="text-xs text-[var(--text-muted)]">
              {result.answered} of {result.total} answered. Higher means more risk. Unanswered questions count
              against the vendor, so the score falls as you document controls.
            </p>
            <ul className="space-y-1 border-t border-[var(--border-subtle)] pt-3">
              {VENDOR_QUESTION_SECTIONS.map((entry) => {
                const progress = sectionProgress(entry, answers);
                return (
                  <li key={entry.id} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-secondary)]">{entry.title}</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        progress.complete ? "text-[var(--success-strong)]" : "text-[var(--text-faint)]"
                      )}
                    >
                      {progress.answered}/{progress.total}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
        <p className="px-1 text-xs text-[var(--text-faint)]">
          Answers are saved each time you move to another section.
        </p>
      </aside>
    </div>
  );
}

function answerOptionsLabel(value: VendorAnswerValue) {
  return { yes: "Yes", partial: "Partly", no: "No", unknown: "Don't know", na: "Not applicable" }[value];
}
