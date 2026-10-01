"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, OctagonX, Play } from "lucide-react";
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
 * Suspend / Resume control for an agent. Suspending flips the kill switch:
 * both proxies refuse this agent's traffic until it is resumed.
 */
export function AgentKillSwitch({
  agentId,
  agentName,
  suspended,
}: {
  agentId: string;
  agentName: string;
  suspended: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/suspend`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify({ reason: reason.trim() || undefined }) : undefined,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Failed (${res.status})`);
      }
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  if (suspended) {
    return (
      <span className="inline-flex items-center gap-2">
        <Button variant="outline" onClick={() => call("DELETE")} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          Resume
        </Button>
        {error && <span className="text-xs text-[var(--critical)]">{error}</span>}
      </span>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        className="border-[var(--critical-border)] text-[var(--critical-strong)] hover:bg-[var(--critical-dim)]"
        onClick={() => setOpen(true)}
      >
        <OctagonX className="mr-2 h-4 w-4" /> Suspend
      </Button>
      <Dialog open={open} onOpenChange={(next) => !loading && setOpen(next)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <OctagonX className="h-5 w-5 text-[var(--critical)]" /> Suspend {agentName}?
            </DialogTitle>
            <DialogDescription>
              Both proxies will refuse every request that carries this agent&apos;s{" "}
              <code className="text-xs">x-agent-id</code> with a 403 until you resume it. Each refused
              request is recorded under Compliance → Denials. Traffic that does not carry the header is
              unaffected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="suspend-reason" className="text-sm text-[var(--text-secondary)]">
              Reason <span className="text-[var(--text-faint)]">(optional, recorded in the audit trail)</span>
            </label>
            <Textarea
              id="suspend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. Invoked an unapproved payments tool; investigating."
            />
          </div>
          {error && <p className="text-xs text-[var(--critical)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              className="bg-[var(--critical)] text-[var(--bg-deep)] hover:brightness-110"
              onClick={() => call("POST")}
              disabled={loading}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <OctagonX className="mr-2 h-4 w-4" />}
              Suspend agent
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
