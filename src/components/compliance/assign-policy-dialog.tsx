"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface AssignPolicyDialogProps {
  /** Pre-fill the system (when assigning from a system detail page) */
  systemId?: string;
  systemName?: string;
  /** Pre-fill the policy (when assigning from a policy detail page) */
  policyId?: string;
  policyName?: string;
  /** IDs already assigned, to exclude from the dropdown */
  excludeSystemIds?: string[];
  excludePolicyIds?: string[];
}

type SelectOption = { id: string; name: string };

export function AssignPolicyDialog({
  systemId,
  systemName,
  policyId,
  policyName,
  excludeSystemIds = [],
  excludePolicyIds = [],
}: AssignPolicyDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systems, setSystems] = useState<SelectOption[]>([]);
  const [policies, setPolicies] = useState<SelectOption[]>([]);
  const [selectedSystem, setSelectedSystem] = useState(systemId ?? "");
  const [selectedPolicy, setSelectedPolicy] = useState(policyId ?? "");
  const [status, setStatus] = useState("NOT_ASSESSED");
  const [evidence, setEvidence] = useState("");

  // Fetch available systems/policies when dialog opens
  useEffect(() => {
    if (!open) return;
    if (!systemId) {
      fetch("/api/ai-systems")
        .then((r) => r.json())
        .then((data) => {
          const filtered = data.filter((s: SelectOption) => !excludeSystemIds.includes(s.id));
          setSystems(filtered);
        })
        .catch(() => {});
    }
    if (!policyId) {
      fetch("/api/policies")
        .then((r) => r.json())
        .then((data) => {
          const filtered = data.filter((p: SelectOption) => !excludePolicyIds.includes(p.id));
          setPolicies(filtered);
        })
        .catch(() => {});
    }
  }, [open, systemId, policyId, excludeSystemIds, excludePolicyIds]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sid = systemId ?? selectedSystem;
    const pid = policyId ?? selectedPolicy;

    if (!sid || !pid) {
      setError("Select both a system and a policy.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/policies/${pid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: pid,
          aiSystemId: sid,
          complianceStatus: status,
          evidence: evidence.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to assign");
      }

      setOpen(false);
      setSelectedSystem("");
      setSelectedPolicy("");
      setStatus("NOT_ASSESSED");
      setEvidence("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign policy");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Assign Policy
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Policy</DialogTitle>
          <DialogDescription>
            {systemName
              ? `Assign a compliance policy to ${systemName}`
              : policyName
                ? `Assign ${policyName} to an AI system`
                : "Link a compliance policy to an AI system"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-[var(--critical)]/10 p-2 text-xs text-[var(--critical)]">{error}</div>
          )}

          {/* System selector (if not pre-filled) */}
          {!systemId && (
            <div className="space-y-2">
              <Label>AI System *</Label>
              <select
                value={selectedSystem}
                onChange={(e) => setSelectedSystem(e.target.value)}
                required
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="">Select a system...</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Policy selector (if not pre-filled) */}
          {!policyId && (
            <div className="space-y-2">
              <Label>Policy *</Label>
              <select
                value={selectedPolicy}
                onChange={(e) => setSelectedPolicy(e.target.value)}
                required
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="">Select a policy...</option>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Compliance status */}
          <div className="space-y-2">
            <Label>Initial Compliance Status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
            >
              <option value="NOT_ASSESSED">Not Assessed</option>
              <option value="COMPLIANT">Compliant</option>
              <option value="PARTIALLY_COMPLIANT">Partially Compliant</option>
              <option value="NON_COMPLIANT">Non-Compliant</option>
            </select>
          </div>

          {/* Evidence */}
          <div className="space-y-2">
            <Label>
              {status === "NON_COMPLIANT" ? "Reason for Non-Compliance" :
               status === "PARTIALLY_COMPLIANT" ? "What is missing?" :
               "Evidence / Notes"}{" "}
              {(status === "NON_COMPLIANT" || status === "PARTIALLY_COMPLIANT") && "*"}
            </Label>
            <Textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              rows={3}
              required={status === "NON_COMPLIANT" || status === "PARTIALLY_COMPLIANT"}
              placeholder={
                status === "NON_COMPLIANT" ? "Describe why this system is not compliant..." :
                status === "PARTIALLY_COMPLIANT" ? "Describe which requirements are met and which are not..." :
                "Optional notes about this assignment..."
              }
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? "Assigning..." : "Assign Policy"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
