"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DeleteReportButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function del() {
    setBusy(true);
    const res = await fetch(`/api/reports/${reportId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/reports");
      router.refresh();
    } else {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 className="h-4 w-4" /> Delete
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-muted)]">Delete this report?</span>
      <Button variant="destructive" size="sm" onClick={del} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Confirm
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
