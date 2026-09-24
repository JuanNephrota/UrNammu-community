"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { WizardStepper } from "@/components/workflow/wizard-stepper";
import { WizardFooter } from "@/components/workflow/wizard-footer";
import { TagInput } from "@/components/workflow/tag-input";
import {
  VENDOR_SETUP_STEPS,
  type VendorSetupStepId,
  type VendorSetupValues,
} from "@/lib/vendor-onboarding";

interface VendorSetupWizardProps {
  /** Omitted when adding a new vendor: the identity step creates the profile. */
  profileId?: string;
  initialValues: VendorSetupValues;
  initialStepId: VendorSetupStepId;
  /** Vendor names already used by systems/discoveries but lacking a profile. */
  knownVendors?: string[];
  /** Use cases of live systems for this vendor, offered as one-click suggestions. */
  liveUseCases?: string[];
}

const CONTRACT_STATUSES = [
  { value: "UNKNOWN", label: "Unknown", hint: "Nothing documented yet" },
  { value: "IN_REVIEW", label: "In review", hint: "Being negotiated" },
  { value: "ACTIVE", label: "Active", hint: "Signed and in force" },
  { value: "EXPIRED", label: "Expired", hint: "Past its end date" },
  { value: "TERMINATED", label: "Terminated", hint: "Ended early" },
];

const RESIDENCY_SUGGESTIONS = ["United States", "European Union", "United Kingdom", "Canada", "Australia", "Japan"];
const SUBPROCESSOR_SUGGESTIONS = ["AWS", "Microsoft Azure", "Google Cloud", "Cloudflare", "Snowflake", "OpenAI", "Anthropic"];

const selectClass =
  "flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none";

function isStepComplete(step: VendorSetupStepId, v: VendorSetupValues) {
  switch (step) {
    case "identity":
      return Boolean(v.vendor.trim() && v.website.trim() && v.description.trim());
    case "contract":
      return Boolean(v.contractOwner.trim() && v.contractStatus !== "UNKNOWN" && v.contractRenewalDate);
    case "data":
      return v.dataResidency.length > 0 && v.subprocessors.length > 0;
    case "use-cases":
      return v.approvedUseCases.length > 0;
    case "review":
      return false;
  }
}

function payloadFor(step: VendorSetupStepId, v: VendorSetupValues) {
  switch (step) {
    case "identity":
      return { website: v.website, description: v.description };
    case "contract":
      return {
        contractOwner: v.contractOwner,
        contractStatus: v.contractStatus,
        contractStartDate: v.contractStartDate,
        contractRenewalDate: v.contractRenewalDate,
        renewalNoticeDays: v.renewalNoticeDays,
        renewalNotes: v.renewalNotes,
      };
    case "data":
      return { dataResidency: v.dataResidency, subprocessors: v.subprocessors };
    case "use-cases":
      return { approvedUseCases: v.approvedUseCases, notes: v.notes };
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

export function VendorSetupWizard({
  profileId,
  initialValues,
  initialStepId,
  knownVendors = [],
  liveUseCases = [],
}: VendorSetupWizardProps) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [stepId, setStepId] = useState<VendorSetupStepId>(profileId ? initialStepId : "identity");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const stepIndex = VENDOR_SETUP_STEPS.findIndex((step) => step.id === stepId);
  const completed = new Set(
    VENDOR_SETUP_STEPS.filter((step) => isStepComplete(step.id, values)).map((step) => step.id)
  );

  function update<K extends keyof VendorSetupValues>(key: K, value: VendorSetupValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setStatus(null);
  }

  function goTo(next: VendorSetupStepId, id = profileId) {
    setStepId(next);
    setError(null);
    if (id) {
      // Keep the URL shareable/resumable without a server round-trip.
      window.history.replaceState(null, "", `/oversight/vendors/${id}/setup?step=${next}`);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Saves the current step (if changed) and moves to `target`. */
  async function saveAndGo(target: VendorSetupStepId) {
    setError(null);

    if (!profileId) {
      // Identity step of a brand-new vendor: create the profile first.
      if (!values.vendor.trim()) {
        setError("Enter the vendor's name.");
        return;
      }
      setSaving(true);
      try {
        const res = await fetch("/api/vendor-profiles/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendor: values.vendor,
            website: values.website,
            description: values.description,
            contractOwner: values.contractOwner,
          }),
        });
        if (!res.ok) throw new Error(await readError(res, "Could not create the vendor"));
        const body = (await res.json()) as { id: string; created: boolean };
        // Resuming an existing profile: load its saved values rather than ours.
        const step = body.created ? target : "identity";
        router.replace(`/oversight/vendors/${body.id}/setup?step=${step}${body.created ? "" : "&existing=1"}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create the vendor");
        setSaving(false);
      }
      return;
    }

    const payload = payloadFor(stepId, values);
    if (!payload || !dirty) {
      goTo(target);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/vendor-profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not save this step"));
      setDirty(false);
      setStatus("Saved");
      goTo(target);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this step");
    } finally {
      setSaving(false);
    }
  }

  const nextStep = VENDOR_SETUP_STEPS[stepIndex + 1]?.id;
  const prevStep = VENDOR_SETUP_STEPS[stepIndex - 1]?.id;
  const current = VENDOR_SETUP_STEPS[stepIndex];

  return (
    <div className="space-y-6">
      <WizardStepper
        steps={VENDOR_SETUP_STEPS}
        currentStepId={stepId}
        completedStepIds={completed}
        onSelect={profileId ? (id) => saveAndGo(id as VendorSetupStepId) : undefined}
        disabled={saving}
      />

      <Card>
        <CardHeader>
          <CardTitle>{current.label}</CardTitle>
          <p className="text-sm text-[var(--text-muted)]">{stepIntro(stepId, Boolean(profileId))}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {stepId === "identity" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="vendor-name">Vendor name</Label>
                <Input
                  id="vendor-name"
                  value={values.vendor}
                  onChange={(e) => update("vendor", e.target.value)}
                  disabled={Boolean(profileId)}
                  list="known-vendors"
                  placeholder="e.g. Anthropic"
                  autoFocus={!profileId}
                />
                <datalist id="known-vendors">
                  {knownVendors.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <p className="text-xs text-[var(--text-faint)]">
                  {profileId
                    ? "The name can't be changed here because AI systems and discoveries link to the vendor by name."
                    : "Use the same spelling as your AI systems so they link to this profile. Suggestions come from systems and shadow AI discoveries."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor-website">Website</Label>
                <Input
                  id="vendor-website"
                  value={values.website}
                  onChange={(e) => update("website", e.target.value)}
                  placeholder="https://www.anthropic.com"
                  inputMode="url"
                />
              </div>
              {!profileId && (
                <div className="space-y-2">
                  <Label htmlFor="vendor-owner">Contract owner (optional)</Label>
                  <Input
                    id="vendor-owner"
                    value={values.contractOwner}
                    onChange={(e) => update("contractOwner", e.target.value)}
                    placeholder="Legal or procurement owner"
                  />
                </div>
              )}
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="vendor-description">What does this vendor provide?</Label>
                <Textarea
                  id="vendor-description"
                  value={values.description}
                  onChange={(e) => update("description", e.target.value)}
                  rows={3}
                  placeholder="e.g. Foundation model API and the Claude chat product, used for coding assistance and internal knowledge search."
                />
              </div>
            </div>
          )}

          {stepId === "contract" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contract-owner">Contract owner</Label>
                <Input
                  id="contract-owner"
                  value={values.contractOwner}
                  onChange={(e) => update("contractOwner", e.target.value)}
                  placeholder="Legal or procurement owner"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-status">Contract status</Label>
                <select
                  id="contract-status"
                  className={selectClass}
                  value={values.contractStatus}
                  onChange={(e) => update("contractStatus", e.target.value)}
                >
                  {CONTRACT_STATUSES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}: {option.hint}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-start">Start date</Label>
                <Input
                  id="contract-start"
                  type="date"
                  value={values.contractStartDate}
                  onChange={(e) => update("contractStartDate", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-renewal">Renewal date</Label>
                <Input
                  id="contract-renewal"
                  type="date"
                  value={values.contractRenewalDate}
                  onChange={(e) => update("contractRenewalDate", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notice-days">Renewal notice window (days)</Label>
                <Input
                  id="notice-days"
                  type="number"
                  min={1}
                  max={365}
                  value={values.renewalNoticeDays}
                  onChange={(e) => update("renewalNoticeDays", Number(e.target.value) || 60)}
                />
                <p className="text-xs text-[var(--text-faint)]">
                  The vendor enters the renewal queue this many days before the renewal date.
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="renewal-notes">Renewal notes (optional)</Label>
                <Textarea
                  id="renewal-notes"
                  value={values.renewalNotes}
                  onChange={(e) => update("renewalNotes", e.target.value)}
                  rows={2}
                  placeholder="Procurement blockers, legal follow-up, negotiation timeline"
                />
              </div>
            </div>
          )}

          {stepId === "data" && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="residency">Where is data processed and stored?</Label>
                <TagInput
                  id="residency"
                  value={values.dataResidency}
                  onChange={(next) => update("dataResidency", next)}
                  suggestions={RESIDENCY_SUGGESTIONS}
                  placeholder="Type a region and press Enter"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subprocessors">Subprocessors</Label>
                <TagInput
                  id="subprocessors"
                  value={values.subprocessors}
                  onChange={(next) => update("subprocessors", next)}
                  suggestions={SUBPROCESSOR_SUGGESTIONS.filter(
                    (name) => name.toLowerCase() !== values.vendor.trim().toLowerCase()
                  )}
                  placeholder="Type a subprocessor and press Enter"
                />
                <p className="text-xs text-[var(--text-faint)]">
                  Most vendors publish this list on their trust or legal page.
                </p>
              </div>
            </div>
          )}

          {stepId === "use-cases" && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="use-cases">Approved use cases</Label>
                <TagInput
                  id="use-cases"
                  value={values.approvedUseCases}
                  onChange={(next) => update("approvedUseCases", next)}
                  suggestions={liveUseCases}
                  placeholder="e.g. Code generation"
                />
                <p className="text-xs text-[var(--text-faint)]">
                  {liveUseCases.length > 0
                    ? "Suggestions are the use cases of AI systems already using this vendor. Any live use case not on this list is flagged as unapproved."
                    : "AI systems using this vendor outside these use cases will be flagged as unapproved."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor-notes">Conditions and notes (optional)</Label>
                <Textarea
                  id="vendor-notes"
                  value={values.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  rows={3}
                  placeholder="Contract carve-outs, regional restrictions, approval conditions"
                />
              </div>
            </div>
          )}

          {stepId === "review" && profileId && (
            <ReviewSummary values={values} completed={completed} onEdit={(id) => goTo(id)} />
          )}

          {stepId === "review" && profileId ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
              <Link href={`/oversight/vendors/${profileId}`} className={buttonVariants({ variant: "outline" })}>
                Back to vendor
              </Link>
              <Link href={`/oversight/vendors/${profileId}/assessment`} className={buttonVariants()}>
                Continue to risk questionnaire
              </Link>
            </div>
          ) : (
            <WizardFooter
              onBack={prevStep ? () => saveAndGo(prevStep) : undefined}
              onSkip={profileId && nextStep && !dirty && !completed.has(stepId) ? () => goTo(nextStep) : undefined}
              onNext={() => nextStep && saveAndGo(nextStep)}
              nextLabel={profileId ? "Save & continue" : "Create vendor"}
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

function stepIntro(step: VendorSetupStepId, existing: boolean) {
  switch (step) {
    case "identity":
      return existing
        ? "Basic facts about the vendor."
        : "Start with the basics. You can fill in the rest now or come back later. Progress is saved after each step.";
    case "contract":
      return "Who owns the relationship and when it renews. This feeds the renewal queue and the vendor risk score.";
    case "data":
      return "Where your data goes once it leaves your organization.";
    case "use-cases":
      return "What people are allowed to use this vendor for.";
    case "review":
      return "Check the profile. Steps with a gap are marked. Click one to fill it in.";
  }
}

function ReviewSummary({
  values,
  completed,
  onEdit,
}: {
  values: VendorSetupValues;
  completed: Set<string>;
  onEdit: (step: VendorSetupStepId) => void;
}) {
  const list = (items: string[]) => (items.length > 0 ? items.join(", ") : "Not documented");
  const rows: Array<{ step: VendorSetupStepId; label: string; lines: Array<[string, string]> }> = [
    {
      step: "identity",
      label: "Identity",
      lines: [
        ["Name", values.vendor],
        ["Website", values.website || "Not documented"],
        ["Description", values.description || "Not documented"],
      ],
    },
    {
      step: "contract",
      label: "Contract",
      lines: [
        ["Owner", values.contractOwner || "Not assigned"],
        ["Status", values.contractStatus.replace(/_/g, " ").toLowerCase()],
        ["Renewal", values.contractRenewalDate || "No date"],
      ],
    },
    {
      step: "data",
      label: "Data",
      lines: [
        ["Residency", list(values.dataResidency)],
        ["Subprocessors", list(values.subprocessors)],
      ],
    },
    {
      step: "use-cases",
      label: "Use cases",
      lines: [["Approved", list(values.approvedUseCases)]],
    },
  ];

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={row.step}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{row.label}</p>
              <Badge variant={completed.has(row.step) ? "success" : "warning"}>
                {completed.has(row.step) ? "Complete" : "Gaps"}
              </Badge>
            </div>
            <button
              type="button"
              onClick={() => onEdit(row.step)}
              className="text-xs font-medium text-[var(--accent)] hover:underline"
            >
              Edit
            </button>
          </div>
          <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
            {row.lines.map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="text-[var(--text-faint)]">{term}</dt>
                <dd className="text-[var(--text-secondary)] break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
