"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Scope = "exact" | "trigger";

/**
 * Approve (as an exact-call or trigger-wide waiver) or reject a withheld
 * call. Approving does not replay anything: the agent re-runs the call and
 * the proxy lets the matching call through while the waiver lasts.
 */
export function ReviewDecisionControls({ requestId, triggerLabel }: { requestId: string; triggerLabel: string }) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("exact");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "APPROVED" | "REJECTED") {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/human-review/${requestId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, scope, note: note.trim() || undefined }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to record the decision.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record the decision.");
    } finally {
      setBusy(null);
    }
  }

  const radio = (value: Scope, label: string, detail: string) => (
    <label className="flex items-start gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-xs">
      <input type="radio" name={`scope-${requestId}`} checked={scope === value} onChange={() => setScope(value)} className="mt-0.5 accent-[var(--accent)]" />
      <span>
        <span className="block font-medium text-[var(--text-primary)]">{label}</span>
        <span className="text-[var(--text-muted)]">{detail}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {radio("exact", "Approve this exact call", "Same tool and arguments, once, within 24 hours.")}
        {radio("trigger", `Approve any “${triggerLabel}” call`, "Any call matching this trigger, up to 10 times in the next hour.")}
      </div>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="Reviewer note (optional, audited)" />
      {error && <p className="text-xs text-[var(--critical)]">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => decide("APPROVED")} disabled={busy !== null}>
          {busy === "APPROVED" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide("REJECTED")} disabled={busy !== null}>
          {busy === "REJECTED" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <X className="mr-1 h-3.5 w-3.5" />}
          Reject
        </Button>
      </div>
    </div>
  );
}
