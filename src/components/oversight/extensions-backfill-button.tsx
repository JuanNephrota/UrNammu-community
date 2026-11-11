"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// "Rebuild from history" — walks stored Claude Code events and Cursor spans
// through the inventory extractors. The API hands back a resume cursor when
// it runs out of time, so this loops until `done`. Admin only.
export function ExtensionsBackfillButton({ hasRows }: { hasRows: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function run() {
    if (
      hasRows &&
      !window.confirm(
        "Observation counts are additive, so rebuilding over history that is already counted will double them. Continue?",
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus("Scanning…");
    let resume: unknown = null;
    let scanned = 0;
    let rows = 0;
    try {
      for (let i = 0; i < 50; i++) {
        const res = await fetch("/api/assistant-extensions/backfill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resume }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Backfill failed");
        scanned += data.scanned ?? 0;
        rows += data.rows ?? 0;
        setStatus(`${scanned.toLocaleString()} events scanned · ${rows.toLocaleString()} rows merged`);
        if (data.done) break;
        resume = data.resume;
      }
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Backfill failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status && <span className="text-xs text-[var(--text-muted)]">{status}</span>}
      <Button variant="outline" size="sm" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <History className="mr-1.5 h-3.5 w-3.5" />}
        Rebuild from history
      </Button>
    </div>
  );
}
