"use client";

import { useState } from "react";
import { Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AI_TOOL_CATEGORIES,
  categoryLabel,
  isAIToolCategory,
} from "@/lib/ai-tools-registry";

/** Compact category chip shown beside a discovered tool's name. */
export function CategoryBadge({ category }: { category?: string | null }) {
  return (
    <Badge
      variant={isAIToolCategory(category) ? "default" : "outline"}
      className="gap-1 text-[9px] px-1.5 normal-case tracking-normal"
      title={isAIToolCategory(category) ? "Registry category" : "No registry category"}
    >
      <Tag className="h-2.5 w-2.5" />
      {categoryLabel(category)}
    </Badge>
  );
}

/**
 * Inline category editor. Persists through the existing
 * PUT /api/discovered-tools/[id] route, which validates the value against the
 * registry's closed category set. Reverts on failure.
 */
export function CategorySelect({
  toolId,
  category,
  onChange,
}: {
  toolId: string;
  category?: string | null;
  onChange: (category: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string) {
    const value = next === "" ? null : next;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/discovered-tools/${toolId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Failed (${res.status})`);
      }
      onChange(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        aria-label="Tool category"
        value={isAIToolCategory(category) ? category : ""}
        disabled={saving}
        onChange={(e) => save(e.target.value)}
        className="h-7 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-[11px] text-[var(--text-secondary)] disabled:opacity-60"
      >
        <option value="">Uncategorized</option>
        {AI_TOOL_CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      {error && <span className="text-[11px] text-[var(--critical)]">{error}</span>}
    </span>
  );
}
