"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { HelpHint } from "@/components/help/help-hint";
import { WizardStepper } from "@/components/workflow/wizard-stepper";
import { WizardFooter } from "@/components/workflow/wizard-footer";
import {
  SYSTEM_SETUP_STEPS,
  isExternalVendor,
  type SystemSetupStepId,
  type SystemSetupValues,
} from "@/lib/system-onboarding";

interface SystemSetupWizardProps {
  /** Omitted when registering: the Basics step creates the system. */
  systemId?: string;
  initialValues: SystemSetupValues;
  initialStepId: SystemSetupStepId;
  /** Set when converting a shadow AI discovery; linked on create. */
  discoveredToolId?: string;
  knownVendors?: string[];
  knownDepartments?: string[];
  /** Vendor names (lowercased) that already have a governance profile. */
  profiledVendors?: string[];
}

const selectClass =
  "flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none";

const SENSITIVITY = [
  { value: "PUBLIC", label: "Public", hint: "Already public, or safe to publish" },
  { value: "INTERNAL", label: "Internal", hint: "Everyday business data" },
  { value: "CONFIDENTIAL", label: "Confidential", hint: "Customer, financial or employee data" },
  { value: "RESTRICTED", label: "Restricted", hint: "Regulated data: PHI, PCI, credentials" },
];

const STAGES = [
  { key: "requireOwnerApproval", label: "Owner review" },
  { key: "requireSecurityApproval", label: "Security review" },
  { key: "requireLegalApproval", label: "Legal review" },
  { key: "requireComplianceApproval", label: "Compliance review" },
] as const;

function isStepComplete(step: SystemSetupStepId, v: SystemSetupValues) {
  switch (step) {
    case "basics":
      return Boolean(v.name.trim() && v.department.trim() && v.description.trim() && v.useCase.trim());
    case "data":
      return Boolean(v.dataInputs.trim() && v.dataOutputs.trim() && (v.vendor.trim() || v.modelType.trim()));
    case "governance":
      return true;
    case "review":
      return false;
  }
}

function payloadFor(step: SystemSetupStepId, v: SystemSetupValues) {
  switch (step) {
    case "basics":
      return {
        name: v.name,
        department: v.department,
        description: v.description,
        useCase: v.useCase,
        version: v.version,
      };
    case "data":
      return {
        vendor: v.vendor,
        modelType: v.modelType,
        dataSensitivity: v.dataSensitivity,
        dataInputs: v.dataInputs,
        dataOutputs: v.dataOutputs,
      };
    case "governance":
      return {
        riskLevel: v.riskLevel,
        status: v.status,
        reviewIntervalDays: v.reviewIntervalDays,
        ...(v.nextReviewDate ? { nextReviewDate: v.nextReviewDate } : {}),
        requireOwnerApproval: v.requireOwnerApproval,
        requireSecurityApproval: v.requireSecurityApproval,
        requireLegalApproval: v.requireLegalApproval,
        requireComplianceApproval: v.requireComplianceApproval,
      };
    case "review":
      return null;
  }
}

async function readError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  const fieldErrors = body?.details?.fieldErrors as Record<string, string[]> | undefined;
  const firstField = fieldErrors ? Object.values(fieldErrors).flat()[0] : undefined;
  return firstField ?? body?.error ?? fallback;
}

export function SystemSetupWizard({
  systemId,
  initialValues,
  initialStepId,
  discoveredToolId,
  knownVendors = [],
  knownDepartments = [],
  profiledVendors = [],
}: SystemSetupWizardProps) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [stepId, setStepId] = useState<SystemSetupStepId>(systemId ? initialStepId : "basics");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Fields changed since the last save. Autofill can change fields on later
  // steps, so a save sends every changed field, not just the current step's.
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<keyof SystemSetupValues>>(new Set());
  const dirty = dirtyKeys.size > 0;
  const [autofill, setAutofill] = useState<{ loading: boolean; message: string | null; error: boolean }>({
    loading: false,
    message: null,
    error: false,
  });

  const stepIndex = SYSTEM_SETUP_STEPS.findIndex((step) => step.id === stepId);
  const completed = new Set(
    SYSTEM_SETUP_STEPS.filter((step) => isStepComplete(step.id, values)).map((step) => step.id)
  );

  function update<K extends keyof SystemSetupValues>(key: K, value: SystemSetupValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirtyKeys((prev) => new Set(prev).add(key));
    setStatus(null);
  }

  function goTo(next: SystemSetupStepId, id = systemId) {
    setStepId(next);
    setError(null);
    if (id) window.history.replaceState(null, "", `/registry/${id}/setup?step=${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleAutofill() {
    if (!values.name.trim()) {
      setAutofill({ loading: false, message: "Enter a system name first.", error: true });
      return;
    }
    setAutofill({ loading: true, message: null, error: false });
    try {
      const res = await fetch("/api/ai-systems/classify-by-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name.trim(), vendor: values.vendor.trim() || null }),
      });
      if (!res.ok) throw new Error(await readError(res, "The AI assistant couldn't classify this system."));
      const result = await res.json();
      const filled: string[] = [];
      const next = { ...values };
      const take = (key: keyof SystemSetupValues, label: string, onlyIfEmpty = false) => {
        const value = result[key];
        if (typeof value !== "string") return;
        if (onlyIfEmpty && String(next[key]).trim()) return;
        (next as Record<string, unknown>)[key] = value;
        filled.push(label);
      };
      take("description", "description");
      take("useCase", "use case");
      take("modelType", "model type");
      take("dataInputs", "data inputs");
      take("dataOutputs", "data outputs");
      take("riskLevel", "risk level");
      take("dataSensitivity", "data sensitivity");
      take("vendor", "vendor", true);
      setValues(next);
      setDirtyKeys((prev) => {
        const keys = new Set(prev);
        for (const key of Object.keys(next) as Array<keyof SystemSetupValues>) {
          if (next[key] !== values[key]) keys.add(key);
        }
        return keys;
      });
      setAutofill({
        loading: false,
        error: false,
        message: `Filled ${filled.join(", ") || "nothing"}. Fields on later steps were filled too, so check them as you go.${
          typeof result.reasoning === "string" ? ` ${result.reasoning}` : ""
        }`,
      });
    } catch (err) {
      setAutofill({
        loading: false,
        error: true,
        message: err instanceof Error ? err.message : "Autofill failed",
      });
    }
  }

  async function saveAndGo(target: SystemSetupStepId) {
    setError(null);

    if (!systemId) {
      if (!values.name.trim() || !values.department.trim()) {
        setError("Enter the system name and the department that owns it.");
        return;
      }
      setSaving(true);
      try {
        // Create with everything known so far: a shadow AI conversion or an
        // autofill may already have filled later steps.
        const res = await fetch("/api/ai-systems", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payloadFor("basics", values),
            ...payloadFor("data", values),
            ...payloadFor("governance", values),
            ...(discoveredToolId ? { discoveredToolId } : {}),
          }),
        });
        if (!res.ok) throw new Error(await readError(res, "Could not register the system"));
        const system = (await res.json()) as { id: string };
        router.replace(`/registry/${system.id}/setup?step=${target}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not register the system");
        setSaving(false);
      }
      return;
    }

    const allFields = {
      ...payloadFor("basics", values),
      ...payloadFor("data", values),
      ...payloadFor("governance", values),
    } as Record<string, unknown>;
    const payload = Object.fromEntries(
      Object.entries(allFields).filter(([key]) => dirtyKeys.has(key as keyof SystemSetupValues))
    );
    // A cleared review date means "today plus the interval", which the API
    // recalculates whenever the interval is sent.
    if (dirtyKeys.has("nextReviewDate") && !values.nextReviewDate) {
      payload.reviewIntervalDays = values.reviewIntervalDays;
    }
    if (Object.keys(payload).length === 0) {
      setDirtyKeys(new Set());
      goTo(target);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/ai-systems/${systemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not save this step"));
      setDirtyKeys(new Set());
      setStatus("Saved");
      goTo(target);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this step");
    } finally {
      setSaving(false);
    }
  }

  const nextStep = SYSTEM_SETUP_STEPS[stepIndex + 1]?.id;
  const prevStep = SYSTEM_SETUP_STEPS[stepIndex - 1]?.id;
  const current = SYSTEM_SETUP_STEPS[stepIndex];
  const vendorNeedsProfile =
    isExternalVendor(values.vendor) && !profiledVendors.includes(values.vendor.trim().toLowerCase());

  return (
    <div className="space-y-6">
      <WizardStepper
        steps={SYSTEM_SETUP_STEPS}
        currentStepId={stepId}
        completedStepIds={completed}
        onSelect={systemId ? (id) => saveAndGo(id as SystemSetupStepId) : undefined}
        disabled={saving}
      />

      <Card>
        <CardHeader>
          <CardTitle>{current.label}</CardTitle>
          <p className="text-sm text-[var(--text-muted)]">{stepIntro(stepId, Boolean(systemId))}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {stepId === "basics" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="system-name">System name</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAutofill}
                    disabled={autofill.loading || !values.name.trim()}
                    className="gap-1.5 text-xs"
                    title="Look this system up with the AI assistant and fill in the details"
                  >
                    {autofill.loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                    )}
                    {autofill.loading ? "Analyzing..." : "Autofill with AI"}
                  </Button>
                </div>
                <Input
                  id="system-name"
                  value={values.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="e.g. Customer Support Chatbot"
                  autoFocus={!systemId}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="system-department">Owning department</Label>
                <Input
                  id="system-department"
                  value={values.department}
                  onChange={(e) => update("department", e.target.value)}
                  list="known-departments"
                  placeholder="e.g. Customer Success"
                />
                <datalist id="known-departments">
                  {knownDepartments.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              {autofill.message && (
                <div
                  className={`md:col-span-2 rounded-md border p-3 text-xs ${
                    autofill.error
                      ? "border-[var(--critical-border)] bg-[var(--critical-dim)] text-[var(--critical-strong)]"
                      : "border-[var(--accent-border)] bg-[var(--accent-faint)] text-[var(--text-secondary)]"
                  }`}
                >
                  {!autofill.error && <Badge variant="info" className="mr-2">AI-filled</Badge>}
                  {autofill.message}
                </div>
              )}
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="system-description">What does it do?</Label>
                <Textarea
                  id="system-description"
                  value={values.description}
                  onChange={(e) => update("description", e.target.value)}
                  rows={3}
                  placeholder="A short description reviewers can understand without context. The AI risk assessment reads this too."
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="system-use-case">Use case</Label>
                <Textarea
                  id="system-use-case"
                  value={values.useCase}
                  onChange={(e) => update("useCase", e.target.value)}
                  rows={2}
                  placeholder="The business task it's used for, e.g. drafting replies to support tickets"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="system-version">Version (optional)</Label>
                <Input
                  id="system-version"
                  value={values.version}
                  onChange={(e) => update("version", e.target.value)}
                  placeholder="e.g. 1.0"
                />
              </div>
            </div>
          )}

          {stepId === "data" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="system-vendor">Vendor / provider</Label>
                <Input
                  id="system-vendor"
                  value={values.vendor}
                  onChange={(e) => update("vendor", e.target.value)}
                  list="known-system-vendors"
                  placeholder="e.g. Anthropic, OpenAI, Internal"
                />
                <datalist id="known-system-vendors">
                  {knownVendors.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <p className="text-xs text-[var(--text-faint)]">Use &ldquo;Internal&rdquo; for systems built in-house.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="system-model">Model type</Label>
                <Input
                  id="system-model"
                  value={values.modelType}
                  onChange={(e) => update("modelType", e.target.value)}
                  placeholder="e.g. LLM, Classification, Computer Vision"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className="flex items-center gap-1.5">
                  Most sensitive data it touches
                  <HelpHint hint="data_sensitivity" />
                </Label>
                <div role="radiogroup" aria-label="Data sensitivity" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {SENSITIVITY.map((option) => {
                    const selected = values.dataSensitivity === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => update("dataSensitivity", option.value)}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          selected
                            ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                            : "border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <div className="text-sm font-medium text-[var(--text-primary)]">{option.label}</div>
                        <div className="mt-0.5 text-xs text-[var(--text-muted)]">{option.hint}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="system-inputs">Data inputs</Label>
                <Textarea
                  id="system-inputs"
                  value={values.dataInputs}
                  onChange={(e) => update("dataInputs", e.target.value)}
                  rows={3}
                  placeholder="What goes in: prompts, documents, customer records..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="system-outputs">Data outputs</Label>
                <Textarea
                  id="system-outputs"
                  value={values.dataOutputs}
                  onChange={(e) => update("dataOutputs", e.target.value)}
                  rows={3}
                  placeholder="What comes out, and where it goes"
                />
              </div>
            </div>
          )}

          {stepId === "governance" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="system-risk">Initial risk level</Label>
                <select
                  id="system-risk"
                  className={selectClass}
                  value={values.riskLevel}
                  onChange={(e) => update("riskLevel", e.target.value)}
                >
                  {["MINIMAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"].map((level) => (
                    <option key={level} value={level}>
                      {level.charAt(0) + level.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--text-faint)]">
                  Your best guess for now. The risk assessment replaces it.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="system-status">Status</Label>
                <select
                  id="system-status"
                  className={selectClass}
                  value={values.status}
                  onChange={(e) => update("status", e.target.value)}
                >
                  <option value="DRAFT">Draft: still being documented</option>
                  <option value="UNDER_REVIEW">Under review: ready for reviewers</option>
                  {values.status === "APPROVED" && <option value="APPROVED">Approved</option>}
                  <option value="DEPLOYED">Deployed: already in use</option>
                </select>
                <p className="text-xs text-[var(--text-faint)]">
                  Approval is recorded later through the approval review.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="system-interval" className="flex items-center gap-1.5">
                  Review every (days)
                  <HelpHint hint="review_interval" />
                </Label>
                <Input
                  id="system-interval"
                  type="number"
                  min={1}
                  max={730}
                  value={values.reviewIntervalDays}
                  onChange={(e) => update("reviewIntervalDays", Number(e.target.value) || 365)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="system-next-review">Next review date (optional)</Label>
                <Input
                  id="system-next-review"
                  type="date"
                  value={values.nextReviewDate}
                  onChange={(e) => update("nextReviewDate", e.target.value)}
                />
                <p className="text-xs text-[var(--text-faint)]">Blank means today plus the review interval.</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className="flex items-center gap-1.5">
                  Who must sign off
                  <HelpHint hint="approval_stages" />
                </Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {STAGES.map((stage) => (
                    <label
                      key={stage.key}
                      className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-sm text-[var(--text-primary)]"
                    >
                      <input
                        type="checkbox"
                        checked={values[stage.key]}
                        onChange={(e) => update(stage.key, e.target.checked)}
                        className="h-4 w-4 rounded border-[var(--border-default)] bg-[var(--bg-elevated)]"
                      />
                      {stage.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {stepId === "review" && systemId && (
            <div className="space-y-4">
              <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-sm sm:grid-cols-2">
                <Summary term="Name" value={values.name} />
                <Summary term="Department" value={values.department} />
                <Summary term="Use case" value={values.useCase} wide />
                <Summary term="Vendor" value={values.vendor} />
                <Summary term="Model type" value={values.modelType} />
                <Summary term="Data sensitivity" value={values.dataSensitivity.toLowerCase()} />
                <Summary term="Initial risk" value={values.riskLevel.toLowerCase()} />
                <Summary term="Data inputs" value={values.dataInputs} wide />
                <Summary term="Data outputs" value={values.dataOutputs} wide />
                <Summary
                  term="Sign-off"
                  value={STAGES.filter((stage) => values[stage.key]).map((stage) => stage.label).join(", ")}
                  wide
                />
              </dl>
              <div className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-faint)] p-4">
                <p className="text-sm font-medium text-[var(--text-primary)]">What happens next</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
                  {vendorNeedsProfile && (
                    <li>
                      Set up a governance profile for {values.vendor.trim()} (
                      <Link
                        href={`/oversight/vendors/new?vendor=${encodeURIComponent(values.vendor.trim())}`}
                        className="text-[var(--accent)] hover:underline"
                      >
                        add vendor
                      </Link>
                      ).
                    </li>
                  )}
                  <li>Run the risk assessment. It sets the system&rsquo;s real risk level.</li>
                  <li>Classify it under the EU AI Act, assign policies and upload evidence.</li>
                  <li>Collect the sign-offs above, then record the approval decision.</li>
                </ol>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  The system page keeps a checklist of these, so you can pick up where you left off.
                </p>
              </div>
            </div>
          )}

          {stepId === "review" && systemId ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
              <Link href={`/registry/${systemId}`} className={buttonVariants({ variant: "outline" })}>
                Go to system
              </Link>
              <Link href={`/risk-center/assessments/new?systemId=${systemId}`} className={buttonVariants()}>
                <ClipboardList className="h-4 w-4" />
                Start risk assessment
              </Link>
            </div>
          ) : (
            <WizardFooter
              onBack={prevStep ? () => saveAndGo(prevStep) : undefined}
              onSkip={systemId && nextStep && !dirty && !completed.has(stepId) ? () => goTo(nextStep) : undefined}
              onNext={() => nextStep && saveAndGo(nextStep)}
              nextLabel={systemId ? "Save & continue" : "Register system"}
              saving={saving}
              error={error}
              status={status}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function stepIntro(step: SystemSetupStepId, existing: boolean) {
  switch (step) {
    case "basics":
      return existing
        ? "What the system is and who owns it."
        : "Start with the basics. The system is saved as a draft when you continue, and each later step saves as you go.";
    case "data":
      return "Where the model comes from and what data flows through it. This decides which risk questions apply.";
    case "governance":
      return "How often it is re-reviewed and who has to sign off before it's approved.";
    case "review":
      return "The system is registered. Check the details, then move on to the risk assessment.";
  }
}

function Summary({ term, value, wide }: { term: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-[var(--text-faint)]">{term}</dt>
      <dd className={value.trim() ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}>
        {value.trim() || "Not documented"}
      </dd>
    </div>
  );
}
