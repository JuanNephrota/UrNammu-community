"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, ShieldAlert, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ANNEX_III_CATEGORIES,
  DEROGATION_GROUNDS,
  FRIA_TRIGGERS,
  PROHIBITED_PRACTICES,
  ROLE_OPTIONS,
  TIER_LABELS,
  TRANSPARENCY_TRIGGERS,
  checkCompleteness,
  classifyEuAiAct,
  describeDeadline,
  tierBadgeVariant,
  type EuAiActAnswers,
  type EuAiActOption,
  type EuAiActRole,
} from "@/lib/eu-ai-act";
import { cn } from "@/lib/utils";

type StepId =
  | "role"
  | "prohibited"
  | "annexI"
  | "annexIII"
  | "derogation"
  | "transparency"
  | "gpai"
  | "fria"
  | "review";

const STEP_TITLES: Record<StepId, string> = {
  role: "Your role",
  prohibited: "Prohibited practices",
  annexI: "Annex I products",
  annexIII: "Annex III use cases",
  derogation: "Art. 6(3) derogation",
  transparency: "Transparency triggers",
  gpai: "General-purpose AI",
  fria: "Fundamental rights impact",
  review: "Review & save",
};

export function EuAiActWizard({
  systemId,
  systemName,
  systemContext,
  initialAnswers,
  initialNotes,
  existing,
}: {
  systemId: string;
  systemName: string;
  systemContext: { useCase: string | null; vendor: string | null; dataSensitivity: string };
  initialAnswers: EuAiActAnswers;
  initialNotes: string | null;
  existing: { tier: string; classifiedAt: string } | null;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<EuAiActAnswers>(initialAnswers);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDeployer = answers.role === "DEPLOYER" || answers.role === "PROVIDER_AND_DEPLOYER";
  const isProvider = answers.role === "PROVIDER" || answers.role === "PROVIDER_AND_DEPLOYER";

  const preview = useMemo(() => classifyEuAiAct(answers), [answers]);
  const completeness = useMemo(() => checkCompleteness(answers), [answers]);

  // Steps are computed from the answers so irrelevant ones are skipped.
  const steps = useMemo<StepId[]>(() => {
    const list: StepId[] = ["role", "prohibited", "annexI", "annexIII"];
    if (answers.annexIIICategories.length > 0 && answers.annexIProduct !== true) list.push("derogation");
    list.push("transparency", "gpai");
    if (preview.tier === "HIGH_RISK" && isDeployer) list.push("fria");
    list.push("review");
    return list;
  }, [answers.annexIIICategories.length, answers.annexIProduct, preview.tier, isDeployer]);

  const safeIndex = Math.min(stepIndex, steps.length - 1);
  const step = steps[safeIndex];
  const isLast = safeIndex === steps.length - 1;

  function toggle<K extends keyof EuAiActAnswers>(key: K, id: string) {
    setAnswers((prev) => {
      const list = prev[key] as unknown as string[];
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      return { ...prev, [key]: next };
    });
  }

  function canAdvance(): boolean {
    switch (step) {
      case "role":
        return answers.role !== null;
      case "annexI":
        return answers.annexIProduct !== null;
      case "derogation":
        return answers.derogationGrounds.length === 0 || answers.profiling !== null;
      case "gpai":
        return answers.usesGpai !== null && (!isProvider || answers.providesGpai !== null);
      default:
        return true;
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-systems/${systemId}/eu-ai-act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: { ...answers, providesGpai: answers.providesGpai ?? false },
          notes: notes.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? `Save failed (${res.status})`);
      router.push(`/registry/${systemId}?tab=compliance&framework=EU_AI_ACT`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {/* Stepper */}
        <ol className="flex flex-wrap gap-1.5">
          {steps.map((s, i) => {
            const state = i < safeIndex ? "done" : i === safeIndex ? "active" : "todo";
            return (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => i <= safeIndex && setStepIndex(i)}
                  disabled={i > safeIndex}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all",
                    state === "active"
                      ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                      : state === "done"
                        ? "border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        : "border-[var(--border-subtle)] text-[var(--text-faint)]"
                  )}
                >
                  {state === "done" ? <Check className="h-3 w-3" /> : <span className="font-mono">{i + 1}</span>}
                  {STEP_TITLES[s]}
                </button>
              </li>
            );
          })}
        </ol>

        <Card>
          <CardHeader>
            <CardTitle>{STEP_TITLES[step]}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === "role" && (
              <>
                <p className="text-sm text-[var(--text-secondary)]">
                  Obligations differ sharply between providers and deployers. Pick the role your organisation
                  plays for <span className="font-medium text-[var(--text-primary)]">{systemName}</span>.
                  {systemContext.vendor ? ` The registry lists ${systemContext.vendor} as the vendor, which usually makes you a deployer.` : ""}
                </p>
                <OptionCards
                  options={ROLE_OPTIONS}
                  selected={answers.role ? [answers.role] : []}
                  onSelect={(id) => setAnswers((p) => ({ ...p, role: id as EuAiActRole }))}
                />
              </>
            )}

            {step === "prohibited" && (
              <>
                <p className="text-sm text-[var(--text-secondary)]">
                  Tick anything the system does, even partially. Any match makes the system prohibited in the EU
                  (Art. 5) and no other obligation matters until it is redesigned. Leave all unticked if none apply.
                </p>
                <OptionCards
                  options={PROHIBITED_PRACTICES}
                  selected={answers.prohibitedPractices}
                  onSelect={(id) => toggle("prohibitedPractices", id)}
                  multi
                  tone="critical"
                />
              </>
            )}

            {step === "annexI" && (
              <>
                <p className="text-sm text-[var(--text-secondary)]">
                  Is the system itself a product, or a safety component of a product, covered by EU product-safety
                  legislation listed in Annex I that requires third-party conformity assessment? Typical cases:
                  machinery, toys, lifts, medical devices, in-vitro diagnostics, vehicles, aviation, marine equipment,
                  rail, pressure equipment, radio equipment.
                </p>
                <YesNo
                  value={answers.annexIProduct}
                  onChange={(v) => setAnswers((p) => ({ ...p, annexIProduct: v }))}
                  yesLabel="Yes — it is or is part of an Annex I product"
                  noLabel="No — software or service outside product-safety law"
                />
              </>
            )}

            {step === "annexIII" && (
              <>
                <p className="text-sm text-[var(--text-secondary)]">
                  Select every Annex III area the system&apos;s <em>intended purpose</em> falls into. Think about
                  the decision it informs, not the technology.
                  {systemContext.useCase ? (
                    <span className="mt-2 block rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-xs text-[var(--text-muted)]">
                      Registered use case: {systemContext.useCase}
                    </span>
                  ) : null}
                </p>
                <OptionCards
                  options={ANNEX_III_CATEGORIES}
                  selected={answers.annexIIICategories}
                  onSelect={(id) => toggle("annexIIICategories", id)}
                  multi
                  tone="high"
                />
              </>
            )}

            {step === "derogation" && (
              <>
                <p className="text-sm text-[var(--text-secondary)]">
                  An Annex III system is <em>not</em> high-risk if it poses no significant risk to health, safety or
                  fundamental rights because it only does one of the following — <strong>and</strong> it does not
                  profile natural persons. Select the grounds that genuinely apply; you must be able to document this
                  assessment (Art. 6(4)).
                </p>
                <OptionCards
                  options={DEROGATION_GROUNDS}
                  selected={answers.derogationGrounds}
                  onSelect={(id) => toggle("derogationGrounds", id)}
                  multi
                />
                {answers.derogationGrounds.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <Label>Does the system perform profiling of natural persons?</Label>
                    <p className="text-xs text-[var(--text-muted)]">
                      Profiling means automated processing of personal data to evaluate aspects of a person — work
                      performance, economic situation, health, preferences, reliability, behaviour, location or
                      movements (GDPR Art. 4(4)). Profiling always defeats the derogation.
                    </p>
                    <YesNo
                      value={answers.profiling}
                      onChange={(v) => setAnswers((p) => ({ ...p, profiling: v }))}
                      yesLabel="Yes — it profiles people"
                      noLabel="No profiling"
                    />
                  </div>
                )}
              </>
            )}

            {step === "transparency" && (
              <>
                <p className="text-sm text-[var(--text-secondary)]">
                  Art. 50 duties apply regardless of risk tier. Select everything that applies.
                </p>
                <OptionCards
                  options={TRANSPARENCY_TRIGGERS}
                  selected={answers.transparencyTriggers}
                  onSelect={(id) => toggle("transparencyTriggers", id)}
                  multi
                  tone="medium"
                />
              </>
            )}

            {step === "gpai" && (
              <>
                <div className="space-y-2">
                  <Label>Is the system built on a general-purpose AI model?</Label>
                  <p className="text-xs text-[var(--text-muted)]">
                    Foundation models such as Claude, GPT, Gemini or Llama. If yes, you rely on the model
                    provider&apos;s Art. 53 documentation and should keep a copy.
                  </p>
                  <YesNo
                    value={answers.usesGpai}
                    onChange={(v) => setAnswers((p) => ({ ...p, usesGpai: v }))}
                    yesLabel="Yes — built on a foundation model"
                    noLabel="No — task-specific model or rules"
                  />
                </div>
                {isProvider && (
                  <div className="space-y-2 pt-2">
                    <Label>Does your organisation itself provide a general-purpose AI model?</Label>
                    <p className="text-xs text-[var(--text-muted)]">
                      Only answer yes if you train and place a foundation model on the EU market. Fine-tuning a
                      third-party model for one task normally does not make you a GPAI provider.
                    </p>
                    <YesNo
                      value={answers.providesGpai}
                      onChange={(v) => setAnswers((p) => ({ ...p, providesGpai: v }))}
                      yesLabel="Yes — we provide a GPAI model"
                      noLabel="No"
                    />
                  </div>
                )}
              </>
            )}

            {step === "fria" && (
              <>
                <p className="text-sm text-[var(--text-secondary)]">
                  Deployers of high-risk systems must complete a fundamental rights impact assessment before first
                  use when any of the following apply (Art. 27). Leave all unticked if none do.
                </p>
                <OptionCards
                  options={FRIA_TRIGGERS}
                  selected={answers.friaTriggers}
                  onSelect={(id) => toggle("friaTriggers", id)}
                  multi
                />
              </>
            )}

            {step === "review" && (
              <ReviewStep
                preview={preview}
                complete={completeness.complete}
                notes={notes}
                onNotes={setNotes}
              />
            )}

            {error && <p className="text-sm text-[var(--critical)]">{error}</p>}

            <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-4">
              <Button
                variant="outline"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                disabled={safeIndex === 0 || saving}
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
              {isLast ? (
                <Button onClick={handleSave} disabled={saving || !completeness.complete}>
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                  {existing ? "Save updated classification" : "Save classification"}
                </Button>
              ) : (
                <Button onClick={() => setStepIndex((i) => i + 1)} disabled={!canAdvance()}>
                  Next <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live preview */}
      <aside className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Live result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {answers.role ? (
              <>
                <Badge variant={tierBadgeVariant(preview.tier)} className="text-xs">
                  {TIER_LABELS[preview.tier]}
                </Badge>
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{preview.rationale[0]}</p>
                {preview.deadline && (
                  <p className="text-[11px] text-[var(--text-muted)]">{describeDeadline(preview.deadline)}</p>
                )}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                    Applicable articles ({preview.applicableArticles.length})
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {preview.applicableArticles.map((code) => (
                      <span
                        key={code}
                        className="rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
                      >
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
                {!completeness.complete && (
                  <p className="flex items-start gap-1.5 text-[11px] text-[var(--warning)]">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    Provisional until every step is answered.
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                The tier and obligations update here as you answer.
              </p>
            )}
          </CardContent>
        </Card>
        {existing && (
          <Card>
            <CardContent className="pt-5 text-xs text-[var(--text-muted)]">
              Currently stored as <span className="font-medium text-[var(--text-secondary)]">{existing.tier.replace(/_/g, " ")}</span>{" "}
              (classified {new Date(existing.classifiedAt).toLocaleDateString()}). Saving replaces it and keeps
              the change in the audit trail.
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-5 text-[11px] leading-relaxed text-[var(--text-faint)]">
            Dates reflect Regulation (EU) 2024/1689 as adopted. Pending amendments may move the high-risk
            application dates; the classification itself is unaffected.
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function OptionCards({
  options,
  selected,
  onSelect,
  multi = false,
  tone = "accent",
}: {
  options: EuAiActOption[];
  selected: string[];
  onSelect: (id: string) => void;
  multi?: boolean;
  tone?: "accent" | "critical" | "high" | "medium";
}) {
  const color =
    tone === "critical"
      ? "var(--critical)"
      : tone === "high"
        ? "var(--high)"
        : tone === "medium"
          ? "var(--medium)"
          : "var(--accent)";
  return (
    <div className="grid gap-2">
      {options.map((option) => {
        const isSelected = selected.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={isSelected}
            onClick={() => onSelect(option.id)}
            className="flex items-start gap-3 rounded-lg border p-3 text-left transition-all hover:bg-[var(--bg-hover)]"
            style={{
              borderColor: isSelected ? color : "var(--border-subtle)",
              backgroundColor: isSelected ? `color-mix(in srgb, ${color} 8%, var(--bg-base))` : "var(--bg-base)",
            }}
          >
            <span
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border",
                multi ? "rounded-sm" : "rounded-full"
              )}
              style={{ borderColor: isSelected ? color : "var(--border-default)", backgroundColor: isSelected ? color : "transparent" }}
            >
              {isSelected && <Check className="h-3 w-3 text-[var(--bg-deep)]" />}
            </span>
            <span>
              <span className="block text-sm font-medium text-[var(--text-primary)]">{option.label}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-muted)]">{option.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function YesNo({
  value,
  onChange,
  yesLabel,
  noLabel,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  yesLabel: string;
  noLabel: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {[
        { v: true, label: yesLabel },
        { v: false, label: noLabel },
      ].map(({ v, label }) => {
        const isSelected = value === v;
        return (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(v)}
            className={cn(
              "rounded-lg border p-3 text-left text-sm font-medium transition-all hover:bg-[var(--bg-hover)]",
              isSelected
                ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-secondary)]"
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function ReviewStep({
  preview,
  complete,
  notes,
  onNotes,
}: {
  preview: ReturnType<typeof classifyEuAiAct>;
  complete: boolean;
  notes: string;
  onNotes: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
        <Badge variant={tierBadgeVariant(preview.tier)} className="text-sm">
          {TIER_LABELS[preview.tier]}
        </Badge>
        <div className="text-xs text-[var(--text-muted)]">
          {preview.deadline ? describeDeadline(preview.deadline) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Rationale</p>
        {preview.rationale.map((line, i) => (
          <p key={i} className="text-sm leading-relaxed text-[var(--text-secondary)]">
            {line}
          </p>
        ))}
      </div>

      {preview.warnings.length > 0 && (
        <div className="space-y-1.5">
          {preview.warnings.map((w, i) => (
            <p
              key={i}
              className="flex items-start gap-2 rounded-md border border-[var(--warning-border)] bg-[var(--warning-dim)] px-3 py-2 text-xs text-[var(--warning-strong)]"
            >
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
          Obligations to evidence ({preview.obligations.length})
        </p>
        <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)]">
          {preview.obligations.map((o) => (
            <div key={o.code} className="flex gap-3 p-3">
              <span className="shrink-0 font-mono text-xs text-[var(--accent)]">{o.code}</span>
              <span className="text-xs leading-relaxed text-[var(--text-secondary)]">{o.why}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[var(--text-faint)]">
          Saving creates a Not Assessed entry for each article on the system&apos;s Compliance tab so they can be
          evidenced one by one.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Notes for the record (optional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          rows={3}
          placeholder="Who was consulted, what was assumed, links to the legal memo or Art. 6(4) documentation."
        />
      </div>

      {!complete && (
        <p className="text-xs text-[var(--critical)]">Some steps are unanswered. Use Back to complete them before saving.</p>
      )}
    </div>
  );
}
