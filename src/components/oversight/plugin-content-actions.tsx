"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Outcome = { marketplace: string; plugin: string; status: string; reason?: string };

// "Fetch plugin content" — reads every named plugin the inventory has seen
// from its marketplace's GitHub source. Loops while the API reports it ran
// out of time. Admin / compliance only.
export function PluginContentFetchButton({
  plugins,
  force = false,
  label = "Fetch plugin content",
}: {
  /** Restrict to these plugins; omit for everything the inventory knows. */
  plugins?: { marketplace: string; plugin: string }[];
  force?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setStatus("Fetching…");
    const tally: Record<string, number> = {};
    const skipped: string[] = [];
    try {
      for (let i = 0; i < 20; i++) {
        const res = await fetch("/api/assistant-extensions/plugins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plugins, force }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Fetch failed");
        for (const o of (data.outcomes ?? []) as Outcome[]) tally[o.status] = (tally[o.status] ?? 0) + 1;
        for (const s of data.skippedMarketplaces ?? []) skipped.push(s.reason);
        if (data.done || (data.outcomes ?? []).length === 0) break;
      }
      const parts = Object.entries(tally).map(([k, v]) => `${v} ${k}`);
      setStatus([parts.join(" · ") || "nothing to fetch", ...skipped].join(" — "));
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status && <span className="max-w-md truncate text-xs text-[var(--text-muted)]" title={status}>{status}</span>}
      <Button variant="outline" size="sm" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
        {label}
      </Button>
    </div>
  );
}

// "Mark reviewed" — records the current content hash as signed off.
export function PluginContentReviewButton({ id, needsReview }: { id: string; needsReview: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review() {
    const note = window.prompt("Review note (optional):", "") ?? null;
    if (note === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assistant-extensions/plugins/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not record review");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record review");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-[var(--critical)]">{error}</span>}
      <Button variant={needsReview ? "default" : "outline"} size="sm" onClick={review} disabled={busy}>
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
        {needsReview ? "Mark reviewed" : "Review again"}
      </Button>
    </div>
  );
}
