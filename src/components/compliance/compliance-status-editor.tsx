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

interface Props {
  assignmentId: string;
  policyId: string;
  aiSystemId: string;
  currentStatus: string;
  currentEvidence: string | null;
  systemName: string;
  policyName: string;
}

const statusOptions = [
  {
    value: "COMPLIANT",
    label: "Compliant",
    icon: CheckCircle2,
    color: "var(--success)",
    description: "System fully meets policy requirements",
  },
  {
    value: "PARTIALLY_COMPLIANT",
    label: "Partially Compliant",
    icon: MinusCircle,
    color: "var(--warning)",
    description: "System meets some but not all requirements",
  },
  {
    value: "NON_COMPLIANT",
    label: "Non-Compliant",
    icon: AlertCircle,
    color: "var(--critical)",
    description: "System does not meet policy requirements",
  },
  {
    value: "NOT_ASSESSED",
    label: "Not Assessed",
    icon: HelpCircle,
    color: "var(--text-muted)",
    description: "Compliance has not been evaluated yet",
  },
];

export function ComplianceStatusEditor({
  policyId,
  aiSystemId,
  currentStatus,
  currentEvidence,
  systemName,
  policyName,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(currentStatus);
  const [evidence, setEvidence] = useState(currentEvidence ?? "");
  const [saving, setSaving] = useState(false);

  const requiresEvidence = status === "NON_COMPLIANT" || status === "PARTIALLY_COMPLIANT";

  async function handleSave() {
    if (requiresEvidence && !evidence.trim()) return;
    setSaving(true);

    await fetch(`/api/policies/${policyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policyId,
        aiSystemId,
        complianceStatus: status,
        evidence: evidence.trim() || null,
      }),
    });

    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1 group">
          <Badge variant={statusBadgeVariant(currentStatus)} className="cursor-pointer group-hover:brightness-125 transition-all">
            {currentStatus.replace(/_/g, " ")}
          </Badge>
          <ChevronDown className="h-3 w-3 text-[var(--text-faint)] opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Update Compliance Status</DialogTitle>
          <DialogDescription>
            {systemName} &mdash; {policyName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Status
              <HelpHint hint="compliance_status" />
            </Label>
            <div className="grid gap-2">
              {statusOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = status === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => setStatus(option.value)}
                    className="flex items-center gap-3 rounded-lg border p-3 text-left transition-all"
                    style={{
                      borderColor: isSelected ? option.color : "var(--border-subtle)",
                      backgroundColor: isSelected ? `color-mix(in srgb, ${option.color} 8%, var(--bg-base))` : "var(--bg-base)",
                    }}
                  >
                    <Icon
                      className="h-4 w-4 shrink-0"
                      style={{ color: option.color }}
                    />
                    <div>
                      <p className="text-sm font-medium" style={{ color: isSelected ? option.color : "var(--text-primary)" }}>
                        {option.label}
                      </p>
                      <p className="text-[11px] text-[var(--text-faint)]">{option.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Evidence / Reason */}
          <div className="space-y-2">
            <Label>
              {status === "NON_COMPLIANT"
                ? "Reason for Non-Compliance *"
                : status === "PARTIALLY_COMPLIANT"
                  ? "What is missing? *"
                  : "Evidence / Notes"}
            </Label>
            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              {status === "COMPLIANT"
                ? "Describe the controls, testing, or artifacts that support this rating — e.g. vendor security review, DPIA on file, bias evaluation, model card, change-management approval. This text is surfaced to reviewers at approval time."
                : status === "PARTIALLY_COMPLIANT"
                  ? "Say which requirements are met, which are not, and what the remediation plan is. Reference any mitigating evidence artifacts already attached to the system."
                  : status === "NON_COMPLIANT"
                    ? "Explain the specific requirement(s) that fail and any compensating controls. If a waiver is needed, create a Governance Exception instead."
                    : "Capture an initial note while the assessment is in progress. Evidence is required before the system can be approved."}
            </p>
            <Textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              rows={4}
              placeholder={
                status === "NON_COMPLIANT"
                  ? "Example: No DPIA on file; restricted data flows to vendor outside EU. Remediation plan: commission DPIA and add EU-only data residency addendum."
                  : status === "PARTIALLY_COMPLIANT"
                    ? "Example: Vendor security review completed (Security/2026-02); bias evaluation outstanding (owner: Jane Doe, due 2026-Q3)."
                    : status === "COMPLIANT"
                      ? "Example: DPIA signed 2026-01, vendor SOC 2 Type II on file, quarterly bias evaluation attached as an Evidence Artifact."
                      : "Example: Initial triage in progress; awaiting vendor security review."
              }
            />
            {requiresEvidence && !evidence.trim() && (
              <p className="text-[11px] text-[var(--critical)]">
                A description is required when marking as {status === "NON_COMPLIANT" ? "non-compliant" : "partially compliant"}.
              </p>
            )}
            {status === "COMPLIANT" && !evidence.trim() && (
              <p className="text-[11px] text-[var(--warning)]">
                Recommended: add at least one sentence describing the controls or artifacts that back this rating. Approval will flag empty evidence as a reviewer concern.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || (requiresEvidence && !evidence.trim())}
            >
              {saving ? "Saving..." : "Update Status"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Read-only display of compliance evidence/reason.
 */
export function ComplianceEvidence({
  status,
  evidence,
}: {
  status: string;
  evidence: string | null;
}) {
  if (!evidence) return null;

  const isNonCompliant = status === "NON_COMPLIANT" || status === "PARTIALLY_COMPLIANT";

  return (
    <div
      className="mt-1.5 rounded-md px-3 py-2 text-xs leading-relaxed"
      style={{
        backgroundColor: isNonCompliant
          ? "rgba(239, 68, 68, 0.06)"
          : "rgba(16, 185, 129, 0.06)",
        borderLeft: `2px solid ${isNonCompliant ? "var(--critical)" : "var(--success)"}`,
        color: "var(--text-secondary)",
      }}
    >
      {evidence}
    </div>
  );
}
