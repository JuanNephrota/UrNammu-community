"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const SELECT =
  "h-6 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-1.5 text-[11px] text-[var(--text-primary)] appearance-none";

/**
 * Sets the org-wide classification (read / write / admin + system) for one
 * observed tool, keyed exactly by its server and name. Writes a
 * ToolClassification rule, so it applies to every agent that calls this tool.
 */
export function ClassifyToolControl({
  serverKey,
  toolName,
  current,
}: {
  /** "-" for tools with no server (client / provider tools). */
  serverKey: string;
  toolName: string;
  current: { access: string; system: string | null; source: "rule" | "heuristic" | "default" };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState(current.access);
  const [system, setSystem] = useState(current.system ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tool-classifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: serverKey, tool: toolName, access, system: system.trim() || undefined }),
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
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-[11px]"
        onClick={() => setOpen(true)}
        title={current.source === "rule" ? "Edit the org-wide classification" : "Classify this tool for every agent"}
        aria-label={`Classify ${toolName}`}
      >
        <Pencil className="h-3 w-3" />
      </Button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select value={access} onChange={(e) => setAccess(e.target.value)} className={SELECT} aria-label="Access">
        <option value="read">read</option>
        <option value="write">write</option>
        <option value="admin">admin</option>
      </select>
      <input
        value={system}
        onChange={(e) => setSystem(e.target.value)}
        placeholder="system (optional)"
        className={`${SELECT} w-28`}
        aria-label="System"
      />
      <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={save} disabled={saving} aria-label="Save classification">
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      </Button>
      <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setOpen(false)} disabled={saving} aria-label="Cancel">
        <X className="h-3 w-3" />
      </Button>
      {error && <span className="text-[10px] text-[var(--critical)]">{error}</span>}
    </span>
  );
}
