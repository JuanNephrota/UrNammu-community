"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Controlled shutdown. Sets the agent to RETIRED (the proxies refuse its
 * traffic), revokes a standing approval, and records the disposal attestation.
 */
export function AgentRetireDialog({
  agentId,
  agentName,
  retired,
  attested,
}: {
  agentId: string;
  agentName: string;
  retired: boolean;
  attested: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [attest, setAttest] = useState(attested);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retire() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/retire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || undefined, attested: attest }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Failed (${res.status})`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Archive className="mr-2 h-4 w-4" /> {retired ? "Update retirement" : "Retire"}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !loading && setOpen(next)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-[var(--accent)]" /> {retired ? "Update retirement of" : "Retire"} {agentName}
            </DialogTitle>
            <DialogDescription>
              {retired
                ? "Record the disposal attestation or add notes. The agent stays retired."
                : "Sets the agent to RETIRED. Both proxies refuse its traffic from then on, a standing approval is revoked, and reactivating it means going back through the approval gate. The record and its history stay in the registry."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-sm">
              <input
                type="checkbox"
                checked={attest}
                onChange={(e) => setAttest(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium text-[var(--text-primary)]">Disposal attested.</span>{" "}
                <span className="text-[var(--text-secondary)]">
                  Credentials revoked, and stored data, prompts, and model artifacts deleted or archived per policy.
                </span>
              </span>
            </label>
            <div className="space-y-1">
              <label htmlFor="retire-notes" className="text-sm text-[var(--text-secondary)]">
                Notes <span className="text-[var(--text-faint)]">(optional, recorded in the audit trail)</span>
              </label>
              <Textarea
                id="retire-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={5000}
                placeholder="e.g. Replaced by the v2 routing agent; API keys revoked 2026-09-30; logs retained 90 days per policy."
              />
            </div>
          </div>
          {error && <p className="text-xs text-[var(--critical)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={retire} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
              {retired ? "Save" : "Retire agent"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
