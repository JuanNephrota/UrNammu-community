"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { HelpHint } from "@/components/help/help-hint";

interface Props {
  alertId: string;
  ruleKeys: string[];
  categories: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FalsePositiveDialog({ alertId, ruleKeys, categories, open, onOpenChange }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [createException, setCreateException] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/alerts/${alertId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          falsePositive: true,
          falsePositiveReason: reason.trim(),
          createException,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to mark as false positive");
      }
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark as false positive");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">Mark as False Positive <HelpHint hint="false_positive" /></DialogTitle>
          <DialogDescription>
            This alert will be dismissed. You can optionally create an exception to suppress similar future alerts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Reason */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--text-primary)]">
              Reason <span className="text-[var(--critical)]">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this is a false positive (e.g. legitimate security testing, benign developer workflow)..."
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              rows={3}
            />
          </div>

          {/* Exception toggle */}
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={createException}
                onChange={(e) => setCreateException(e.target.checked)}
                className="rounded border-[var(--border-default)]"
              />
              <span className="text-sm text-[var(--text-primary)]">
                Create exception to suppress similar future alerts
              </span>
            </label>

            {createException && ruleKeys.length > 0 && (
              <div className="ml-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] flex items-center gap-1">
                  Categories that will be excepted
                  <HelpHint hint="prompt_risk_exception" />
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((cat) => (
                    <Badge key={cat} variant="outline">{cat}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-[var(--critical)]">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? "Saving..." : "Mark as False Positive"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
