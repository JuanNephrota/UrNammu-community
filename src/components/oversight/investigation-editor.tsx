"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Investigation = {
  id: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  summary: string | null;
  notes: string | null;
  resolutionSummary: string | null;
};

export function InvestigationEditor({ investigation }: { investigation: Investigation }) {
  const router = useRouter();
  const [status, setStatus] = useState(investigation.status);
  const [summary, setSummary] = useState(investigation.summary ?? "");
  const [notes, setNotes] = useState(investigation.notes ?? "");
  const [resolutionSummary, setResolutionSummary] = useState(
    investigation.resolutionSummary ?? ""
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/api/investigations/${investigation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          summary,
          notes,
          resolutionSummary,
        }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Investigation["status"])}
          className="h-9 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)]"
        >
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
      <Textarea
        rows={2}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="Investigation summary and current hypothesis"
      />
      <Textarea
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Working notes, evidence, owners contacted, or next checks"
      />
      <Textarea
        rows={3}
        value={resolutionSummary}
        onChange={(e) => setResolutionSummary(e.target.value)}
        placeholder="Resolution summary, root cause, and follow-up actions"
      />
    </div>
  );
}
