"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { FilterX } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type FilterSystem = { id: string; name: string };
type FilterPolicy = { id: string; name: string };

interface Props {
  systems: FilterSystem[];
  policies: FilterPolicy[];
  initial: {
    mode: string;
    aiSystemId: string;
    policyId: string;
    since: string;
    until: string;
  };
}

function toIsoDateInput(value: string): string {
  if (!value) return "";
  // Accept both full ISO and YYYY-MM-DD; normalize to YYYY-MM-DD for <input type=date>.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function FilterBar({ systems, policies, initial }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [mode, setMode] = useState(initial.mode);
  const [aiSystemId, setAiSystemId] = useState(initial.aiSystemId);
  const [policyId, setPolicyId] = useState(initial.policyId);
  const [since, setSince] = useState(toIsoDateInput(initial.since));
  const [until, setUntil] = useState(toIsoDateInput(initial.until));

  function apply() {
    const params = new URLSearchParams(search.toString());
    const set = (key: string, value: string) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };
    set("mode", mode === "all" ? "" : mode);
    set("aiSystemId", aiSystemId);
    set("policyId", policyId);
    set("since", since);
    set("until", until);
    params.delete("page"); // reset pagination on filter change
    startTransition(() => {
      router.push(`/compliance/denials?${params.toString()}`);
    });
  }

  function reset() {
    setMode("all");
    setAiSystemId("");
    setPolicyId("");
    setSince("");
    setUntil("");
    startTransition(() => {
      router.push(`/compliance/denials`);
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end">
      <div className="space-y-1">
        <Label>Mode</Label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
        >
          <option value="all">All</option>
          <option value="enforced">Enforced (blocked)</option>
          <option value="dryrun">Dry run</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label>AI System</Label>
        <select
          value={aiSystemId}
          onChange={(e) => setAiSystemId(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
        >
          <option value="">All systems</option>
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>Policy</Label>
        <select
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
        >
          <option value="">All policies</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>Since</Label>
        <input
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)]"
        />
      </div>
      <div className="space-y-1">
        <Label>Until</Label>
        <input
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)]"
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={apply}
          disabled={pending}
          className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110"
        >
          {pending ? "Applying..." : "Apply"}
        </Button>
        <Button type="button" variant="outline" onClick={reset} disabled={pending}>
          <FilterX className="mr-1 h-3.5 w-3.5" />
          Reset
        </Button>
      </div>
    </div>
  );
}
