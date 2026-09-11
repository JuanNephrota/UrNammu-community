"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, AlertCircle, CheckCircle2, MinusCircle, HelpCircle } from "lucide-react";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { HelpHint } from "@/components/help/help-hint";

type Status = "COMPLIANT" | "PARTIALLY_COMPLIANT" | "NON_COMPLIANT" | "NOT_ASSESSED";

interface Props {
  systemId: string;
  systemName: string;
  controlId: string;
  controlCode: string;
  controlTitle: string;
  frameworkLabel: string;
  /** Direct status, or "INHERITED" when satisfied only via crosswalk. */
  currentStatus: Status | "INHERITED";
  currentEvidence: string | null;
  inheritedFrom?: string[];
}

const statusOptions: Array<{
  value: Status;
  label: string;
  icon: typeof CheckCircle2;
  color: string;
  description: string;
}> = [
  { value: "COMPLIANT", label: "Compliant", icon: CheckCircle2, color: "var(--success)", description: "Control is fully implemented and evidenced for this system" },
  { value: "PARTIALLY_COMPLIANT", label: "Partially Compliant", icon: MinusCircle, color: "var(--warning)", description: "Some requirements met; remediation plan expected" },
  { value: "NON_COMPLIANT", label: "Non-Compliant", icon: AlertCircle, color: "var(--critical)", description: "Control is not met; remediate or record an exception" },
  { value: "NOT_ASSESSED", label: "Not Assessed", icon: HelpCircle, color: "var(--text-muted)", description: "Clear the direct assessment (crosswalk inheritance still applies)" },
];

export function ControlMappingEditor({
  systemId,
  systemName,
  controlId,
  controlCode,
  controlTitle,
  frameworkLabel,
  currentStatus,
  currentEvidence,
  inheritedFrom = [],
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>(
    currentStatus === "INHERITED" ? "NOT_ASSESSED" : currentStatus
  );
  const [evidence, setEvidence] = useState(currentEvidence ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiresEvidence = status === "NON_COMPLIANT" || status === "PARTIALLY_COMPLIANT";

  async function handleSave() {
    if (requiresEvidence && !evidence.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-systems/${systemId}/control-mappings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controlId, status, evidence: evidence.trim() || null }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Save failed (${res.status})`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const badgeLabel =
    currentStatus === "INHERITED" ? "Inherited" : currentStatus.replace(/_/g, " ");
  const badgeVariant =
    currentStatus === "INHERITED" ? "info" : statusBadgeVariant(currentStatus);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="group flex items-center gap-1" title="Update control status">
          <Badge variant={badgeVariant} className="cursor-pointer transition-all group-hover:brightness-125">
            {badgeLabel}
          </Badge>
          <ChevronDown className="h-3 w-3 text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {controlCode} — {controlTitle}
          </DialogTitle>
          <DialogDescription>
            {systemName} &middot; {frameworkLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {currentStatus === "INHERITED" && inheritedFrom.length > 0 && (
            <p className="rounded-md border border-[var(--info-border)] bg-[var(--info-dim)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              Currently satisfied by crosswalk from {inheritedFrom.join(", ")}. Recording a direct
              assessment here overrides the inherited status for this control only.
            </p>
          )}

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Status
              <HelpHint hint="framework_control_status" />
            </Label>
            <div className="grid gap-2">
              {statusOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = status === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatus(option.value)}
                    className="flex items-center gap-3 rounded-lg border p-3 text-left transition-all"
                    style={{
                      borderColor: isSelected ? option.color : "var(--border-subtle)",
                      backgroundColor: isSelected
                        ? `color-mix(in srgb, ${option.color} 8%, var(--bg-base))`
                        : "var(--bg-base)",
                    }}
                  >
                    <Icon className="h-4 w-4 shrink-0" style={{ color: option.color }} />
                    <div>
                      <p
                        className="text-sm font-medium"
                        style={{ color: isSelected ? option.color : "var(--text-primary)" }}
                      >
                        {option.label}
                      </p>
                      <p className="text-[11px] text-[var(--text-faint)]">{option.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              {status === "NON_COMPLIANT"
                ? "Reason for Non-Compliance *"
                : status === "PARTIALLY_COMPLIANT"
                  ? "What is missing? *"
                  : "Evidence / Notes"}
            </Label>
            <Textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              rows={4}
              placeholder={
                status === "COMPLIANT"
                  ? "Reference the policy, procedure, test result or evidence artifact that satisfies this control."
                  : status === "NON_COMPLIANT"
                    ? "Which part of the control fails, and what is the remediation plan?"
                    : status === "PARTIALLY_COMPLIANT"
                      ? "What is in place, what is outstanding, and who owns the gap?"
                      : "Optional note while the assessment is in progress."
              }
            />
            {requiresEvidence && !evidence.trim() && (
              <p className="text-[11px] text-[var(--critical)]">
                A description is required for this status.
              </p>
            )}
            {status === "COMPLIANT" && !evidence.trim() && (
              <p className="text-[11px] text-[var(--warning)]">
                Recommended: cite the evidence so auditors can trace the rating.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-[var(--critical)]">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || (requiresEvidence && !evidence.trim())}>
              {saving ? "Saving..." : "Save Assessment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
