"use client";

import { Badge } from "@/components/ui/badge";
import {
  SCOPE_ACCESS_LEVEL_LABELS,
  summariseScopeAccess,
  type ScopeAccessCategory,
  type ScopeAccessSummary,
} from "@/lib/oauth-scopes";

function variantFor(entry: ScopeAccessSummary): "warning" | "info" | "outline" {
  if (!entry.broad) return "outline";
  return entry.access === "read" ? "info" : "warning";
}

/**
 * One chip per access category the app's OAuth scopes reach — "Email ·
 * read/write", "Calendar · read" — so a reviewer sees what company data a
 * discovered tool can touch without expanding the raw scope list. Broad
 * read access is informational; broad write/full access is a warning;
 * sign-in-only identity is outlined.
 */
export function ScopeAccessBadges({
  scopes,
  activeCategory,
  onSelect,
  className,
}: {
  scopes?: string[] | null;
  /** Highlights the chip whose category matches the active list filter. */
  activeCategory?: ScopeAccessCategory | "";
  /** When set, chips become filter toggles. */
  onSelect?: (category: ScopeAccessCategory) => void;
  className?: string;
}) {
  const summary = summariseScopeAccess(scopes);
  if (summary.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {summary.map((entry) => {
        const title = `${entry.scopes.length} scope${entry.scopes.length === 1 ? "" : "s"}: ${entry.scopes.join(", ")}`;
        const content = (
          <>
            {entry.label}
            {entry.category !== "identity" && entry.category !== "other" && (
              <span className="opacity-80"> &middot; {SCOPE_ACCESS_LEVEL_LABELS[entry.access]}</span>
            )}
          </>
        );
        const active = activeCategory === entry.category;
        const badge = (
          <Badge
            variant={variantFor(entry)}
            className={`text-[9px] px-1.5 normal-case tracking-normal ${active ? "ring-1 ring-[var(--accent)]" : ""}`}
            title={title}
          >
            {content}
          </Badge>
        );
        if (!onSelect) return <span key={entry.category}>{badge}</span>;
        return (
          <button
            key={entry.category}
            type="button"
            onClick={() => onSelect(entry.category)}
            aria-pressed={active}
            className="rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
          >
            {badge}
          </button>
        );
      })}
    </div>
  );
}
