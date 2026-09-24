"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, ShieldOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WizardStepper } from "@/components/workflow/wizard-stepper";
import { WizardFooter } from "@/components/workflow/wizard-footer";
import { cn } from "@/lib/utils";
import type { AIToolRiskHint } from "@/lib/ai-tools-registry";
import {
  RISK_HINT_LABELS,
  TRIAGE_STEPS,
  broadScopes,
  getTriageRecommendation,
  isTriageComplete,
  type TriageAnswers,
  type TriageOutcome,
  type TriageStepId,
} from "@/lib/shadow-ai-triage";

export type TriageTool = {
  id: string;
  toolName: string;
  vendor: string | null;
  detectedDomain: string | null;
  detectionSource: string;
  status: string;
  categoryLabel: string | null;
  userCount: number;
  userEmails: string[];
  scopes: string[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  detectedAt: string;
  matchConfidence: string | null;
  matchReasons: string[];
  hasIdentityHandle: boolean;
};

interface TriageWizardProps {
  tool: TriageTool;
  riskHints: AIToolRiskHint[];
  vendorProfile: { id: string; securityReviewStatus: string } | null;
  nextToolId: string | null;
}

type Question = {
  key: keyof TriageAnswers;
  prompt: string;
  helper: string;
  options: Array<{ value: string; label: string }>;
};

const QUESTIONS: Question[] = [
  {
    key: "dataExposure",
    prompt: "What is the most sensitive data people put into it?",
    helper: "Ask a couple of the users listed on the previous step if you're unsure.",
    options: [
      { value: "none", label: "No company data" },
      { value: "internal", label: "Internal data" },
      { value: "customer", label: "Customer or regulated data" },
      { value: "unknown", label: "Don't know" },
    ],
  },
  {
    key: "businessNeed",
    prompt: "Is there a real business need for it?",
    helper: "A job people need done, not just curiosity.",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "unknown", label: "Don't know" },
    ],
  },
  {
    key: "approvedAlternative",
    prompt: "Is there an already-approved tool that does the same job?",
    helper: "If so, blocking this one and pointing people there is usually cheapest.",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "unknown", label: "Don't know" },
    ],
  },
];

const OUTCOMES: Array<{ value: TriageOutcome; label: string; detail: string }> = [
  { value: "register", label: "Register as an AI system", detail: "Govern it: owner, risk assessment, policies, approval." },
  { value: "approve", label: "Approve without registering", detail: "Low-risk, allowed as is. It leaves the review queue." },
  { value: "block", label: "Block", detail: "Adds it to the blocklist feed and disables its SSO app where UrNammu can." },
  { value: "dismiss", label: "Dismiss", detail: "Not an AI tool, or a false match. It won't come back in future scans." },
];

function ChoiceGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
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
  );
}

function formatDay(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function TriageWizard({ tool, riskHints, vendorProfile, nextToolId }: TriageWizardProps) {
  const router = useRouter();
  const [stepId, setStepId] = useState<TriageStepId>("understand");
  const [status, setStatus] = useState(tool.status);
  const [answers, setAnswers] = useState<TriageAnswers>({});
  const [outcome, setOutcome] = useState<TriageOutcome | null>(null);
  const [rationale, setRationale] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The status this page was opened with; the server re-renders after a decision.
  const [openedWithStatus] = useState(tool.status);
  const [done, setDone] = useState<{ outcome: TriageOutcome; message: string | null; enforced: boolean | null } | null>(
    null
  );

  const recommendation = useMemo(
    () =>
      getTriageRecommendation(answers, {
        riskHints,
        scopes: tool.scopes,
        userCount: tool.userCount,
        vendorReviewStatus: vendorProfile?.securityReviewStatus ?? null,
      }),
    [answers, riskHints, tool.scopes, tool.userCount, vendorProfile]
  );
  const broad = broadScopes(tool.scopes);
  const completed = new Set<string>([
    ...(status !== "DISCOVERED" ? ["understand"] : []),
    ...(isTriageComplete(answers) ? ["assess"] : []),
  ]);

  function goTo(next: TriageStepId) {
    setError(null);
    setStepId(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function put(body: Record<string, unknown>) {
    const res = await fetch(`/api/discovered-tools/${tool.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Could not save");
    return data;
  }

  async function startReview() {
    if (status !== "DISCOVERED") {
      goTo("assess");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await put({ status: "UNDER_REVIEW" });
      setStatus("UNDER_REVIEW");
      goTo("assess");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the review");
    } finally {
      setSaving(false);
    }
  }

  async function decide() {
    if (!outcome) {
      setError("Choose an outcome.");
      return;
    }
    if (outcome !== "register" && !rationale.trim()) {
      setError("Add a short reason. It goes in the audit log.");
      return;
    }
    const triage = { ...answers, recommended: recommendation.outcome };
    setSaving(true);
    setError(null);
    try {
      if (outcome === "dismiss") {
        await put({ action: "dismiss_candidate", reason: rationale.trim() });
        setDone({ outcome, message: null, enforced: null });
      } else if (outcome === "approve" || outcome === "block") {
        const data = await put({
          status: outcome === "approve" ? "APPROVED" : "BLOCKED",
          rationale: rationale.trim(),
          triage,
        });
        const enforcement = data.identityEnforcement as { enforced: boolean; message: string } | undefined;
        setStatus(outcome === "approve" ? "APPROVED" : "BLOCKED");
        setDone({ outcome, message: enforcement?.message ?? null, enforced: enforcement?.enforced ?? null });
        router.refresh();
      }
      // No refresh after a dismissal: the record is deleted, so the page
      // would re-render as a 404 over the confirmation.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the decision");
    } finally {
      setSaving(false);
    }
  }

  async function quickRegister() {
    setSaving(true);
    setError(null);
    try {
      const data = await put({ action: "register_and_assess" });
      router.push(data.nextHref ?? "/registry");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register the tool");
      setSaving(false);
    }
  }

  const nextHref = nextToolId ? `/shadow-ai/${nextToolId}/triage` : "/shadow-ai";
  const vendorLink =
    tool.vendor && !vendorProfile ? `/oversight/vendors/new?vendor=${encodeURIComponent(tool.vendor)}` : null;

  if (done) {
    const blocked = done.outcome === "block";
    return (
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {blocked ? (
              <ShieldOff className="h-5 w-5 text-[var(--critical-strong)]" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-[var(--success-strong)]" />
            )}
            {done.outcome === "dismiss"
              ? `${tool.toolName} dismissed`
              : blocked
                ? `${tool.toolName} blocked`
                : `${tool.toolName} approved`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-[var(--text-secondary)]">
          {done.outcome === "dismiss" && <p>It has been removed and won&rsquo;t be surfaced by future scans.</p>}
          {done.outcome === "approve" && (
            <p>It has left the review queue as approved. Your reason is in the audit log.</p>
          )}
          {blocked && (
            <>
              <p>
                {tool.detectedDomain
                  ? `${tool.detectedDomain} is now on the Shadow AI blocklist feed. It is enforced wherever a DNS filter, proxy or firewall polls that feed (set up under Settings → Shadow AI).`
                  : "It has no detected domain, so the blocklist feed can't cover it."}
              </p>
              {done.message && (
                <p
                  className={cn(
                    "rounded-md border p-3",
                    done.enforced
                      ? "border-[var(--success-border)] bg-[var(--success-dim)] text-[var(--success-strong)]"
                      : "border-[var(--warning-border)] bg-[var(--warning-dim)] text-[var(--warning-strong)]"
                  )}
                >
                  Identity provider: {done.message}
                </p>
              )}
              <p>Consider telling the {tool.userCount} user{tool.userCount === 1 ? "" : "s"} what to use instead.</p>
            </>
          )}
          {done.outcome === "approve" && vendorLink && (
            <p>
              {tool.vendor} has no vendor profile yet.{" "}
              <Link href={vendorLink} className="text-[var(--accent)] hover:underline">
                Add the vendor
              </Link>{" "}
              to track its contract and security review.
            </p>
          )}
          <div className="flex flex-wrap gap-3 border-t border-[var(--border-subtle)] pt-4">
            <Link href="/shadow-ai" className={buttonVariants({ variant: "outline" })}>
              Back to Shadow AI
            </Link>
            {nextToolId && (
              <Link href={nextHref} className={buttonVariants()}>
                Next in queue
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {(openedWithStatus === "APPROVED" || openedWithStatus === "BLOCKED") && (
        <div className="rounded-lg border border-[var(--info-border)] bg-[var(--info-dim)] p-3 text-sm text-[var(--info)]">
          This tool was already {openedWithStatus.toLowerCase()}. Reviewing it again lets you change the decision.
        </div>
      )}
      <WizardStepper
        steps={TRIAGE_STEPS}
        currentStepId={stepId}
        completedStepIds={completed}
        onSelect={(id) => (id === "understand" || status !== "DISCOVERED" ? goTo(id as TriageStepId) : startReview())}
        disabled={saving}
      />

      {stepId === "understand" && (
        <Card>
          <CardHeader>
            <CardTitle>What was found</CardTitle>
            <p className="text-sm text-[var(--text-muted)]">
              Check this is a real AI tool and who is using it. Starting the review moves it to Under review so
              colleagues know it&rsquo;s being handled.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Fact term="Vendor" value={tool.vendor ?? "Unknown"} />
              <Fact term="Domain" value={tool.detectedDomain ?? "—"} />
              <Fact term="Category" value={tool.categoryLabel ?? "Uncategorized"} />
              <Fact term="Found by" value={tool.detectionSource.replace(/_/g, " ")} />
              <Fact term="First seen" value={formatDay(tool.firstSeenAt ?? tool.detectedAt)} />
              <Fact term="Last seen" value={formatDay(tool.lastSeenAt)} />
            </dl>

            {riskHints.length > 0 && (
              <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-dim)] p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-[var(--warning-strong)]">
                  <AlertTriangle className="h-4 w-4" /> Registry flags
                </p>
                <ul className="mt-1 list-disc pl-6 text-sm text-[var(--warning-strong)]">
                  {riskHints.map((hint) => (
                    <li key={hint}>{RISK_HINT_LABELS[hint]}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Users ({tool.userCount})
                </p>
                {tool.userEmails.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-sm text-[var(--text-secondary)]">
                    {tool.userEmails.slice(0, 8).map((email) => (
                      <li key={email} className="truncate">
                        {email}
                      </li>
                    ))}
                    {tool.userEmails.length > 8 && (
                      <li className="text-xs text-[var(--text-faint)]">and {tool.userEmails.length - 8} more</li>
                    )}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-[var(--text-muted)]">This source doesn&rsquo;t report who.</p>
                )}
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Access granted
                </p>
                {tool.scopes.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-[var(--text-secondary)]">
                    {tool.scopes.slice(0, 8).map((scope) => (
                      <li key={scope} className={cn("break-all", broad.includes(scope) && "text-[var(--warning-strong)]")}>
                        {scope}
                        {broad.includes(scope) && " (broad)"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-[var(--text-muted)]">No OAuth scopes recorded.</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-[var(--text-faint)]">Vendor governance:</span>
              {vendorProfile ? (
                <Link href={`/oversight/vendors/${vendorProfile.id}`} className="text-[var(--accent)] hover:underline">
                  security review {vendorProfile.securityReviewStatus.replace(/_/g, " ").toLowerCase()}
                </Link>
              ) : tool.vendor ? (
                <span className="text-[var(--text-muted)]">no profile for {tool.vendor}</span>
              ) : (
                <span className="text-[var(--text-muted)]">vendor unknown</span>
              )}
              {tool.matchConfidence && tool.matchConfidence !== "high" && (
                <Badge variant="warning">{tool.matchConfidence} confidence match</Badge>
              )}
            </div>
            {tool.matchReasons.length > 0 && (
              <details className="text-xs text-[var(--text-muted)]">
                <summary className="cursor-pointer">Why it was matched</summary>
                <ul className="mt-1 list-disc pl-5">
                  {tool.matchReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </details>
            )}

            <WizardFooter
              onNext={startReview}
              nextLabel={status === "DISCOVERED" ? "Start review" : "Continue"}
              saving={saving}
              error={error}
            />
          </CardContent>
        </Card>
      )}

      {stepId === "assess" && (
        <Card>
          <CardHeader>
            <CardTitle>Assess</CardTitle>
            <p className="text-sm text-[var(--text-muted)]">Three questions give you a suggested outcome.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {QUESTIONS.map((question) => (
              <div
                key={question.key}
                className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
              >
                <p className="text-sm font-medium text-[var(--text-primary)]">{question.prompt}</p>
                <p className="text-xs text-[var(--text-faint)]">{question.helper}</p>
                <ChoiceGroup
                  label={question.prompt}
                  options={question.options}
                  value={answers[question.key]}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [question.key]: value }))}
                />
              </div>
            ))}
            <WizardFooter
              onBack={() => goTo("understand")}
              onNext={() => {
                if (!isTriageComplete(answers)) {
                  setError("Answer all three questions. “Don’t know” is a valid answer.");
                  return;
                }
                setOutcome((prev) => prev ?? recommendation.outcome);
                goTo("decide");
              }}
              nextLabel="Continue"
              error={error}
            />
          </CardContent>
        </Card>
      )}

      {stepId === "decide" && (
        <Card>
          <CardHeader>
            <CardTitle>Decide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-faint)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">Suggested</p>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {OUTCOMES.find((o) => o.value === recommendation.outcome)?.label}
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-[var(--text-secondary)]">
                {recommendation.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>

            <div role="radiogroup" aria-label="Outcome" className="grid gap-3 md:grid-cols-2">
              {OUTCOMES.map((option) => {
                const selected = outcome === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setOutcome(option.value);
                      setError(null);
                    }}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      selected
                        ? option.value === "block"
                          ? "border-[var(--critical-border)] bg-[var(--critical-dim)]"
                          : "border-[var(--accent)] bg-[var(--accent-dim)]"
                        : "border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                      {option.label}
                      {recommendation.outcome === option.value && <Badge variant="info">Suggested</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">{option.detail}</div>
                  </button>
                );
              })}
            </div>

            {outcome === "register" ? (
              <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-sm">
                <p className="text-[var(--text-secondary)]">
                  The guided registration opens with {tool.toolName} pre-filled (and AI-classified if an AI provider
                  is configured). Registering links this discovery to the new system and takes it out of the queue.
                </p>
                {vendorLink && (
                  <p className="text-[var(--text-muted)]">
                    {tool.vendor} has no vendor profile yet. The system&rsquo;s checklist will prompt you to add one.
                  </p>
                )}
                {error && (
                  <p role="alert" className="text-[var(--critical-strong)]">
                    {error}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button type="button" variant="ghost" onClick={() => goTo("assess")} disabled={saving}>
                    Back
                  </Button>
                  <div className="flex flex-wrap gap-3">
                    <Button type="button" variant="outline" onClick={quickRegister} disabled={saving}>
                      {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                      Quick register &amp; assess
                    </Button>
                    <Link href={`/registry/new?discoveredToolId=${tool.id}`} className={buttonVariants()}>
                      Register with guided setup
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="triage-rationale">
                    {outcome === "dismiss" ? "Why dismiss it?" : "Reason for the record"}
                  </Label>
                  <Textarea
                    id="triage-rationale"
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    rows={3}
                    placeholder={
                      outcome === "block"
                        ? "e.g. Customer data going into a consumer tool. Use the approved Copilot instead."
                        : outcome === "dismiss"
                          ? "e.g. Not an AI tool, it's the company's analytics domain"
                          : "e.g. Used only for public marketing images, no company data"
                    }
                  />
                  {outcome === "block" && !tool.detectedDomain && !tool.hasIdentityHandle && (
                    <p className="text-xs text-[var(--warning-strong)]">
                      UrNammu has no domain or SSO app for this tool, so blocking records the decision but can&rsquo;t
                      enforce it.
                    </p>
                  )}
                </div>
                <WizardFooter
                  onBack={() => goTo("assess")}
                  onNext={decide}
                  nextLabel={
                    outcome === "block" ? "Block tool" : outcome === "dismiss" ? "Dismiss tool" : "Approve tool"
                  }
                  saving={saving}
                  error={error}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--text-faint)]">{term}</dt>
      <dd className="break-words text-[var(--text-secondary)]">{value}</dd>
    </div>
  );
}
