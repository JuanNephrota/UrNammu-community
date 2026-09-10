"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Filter bar for the session trace index. Mirrors EventLogFilters (same
// debounce + query-string idiom) but filters sessions rather than events:
// "event type" makes no sense per-session, and "errors only" does.

interface SessionTraceFiltersProps {
  surfaces: { value: string; label: string }[];
  initialQuery: string;
  initialRisk: string;
  initialSurface: string;
  initialErrorsOnly: boolean;
}

const ALL = "__all__";

const RISK_OPTIONS = [
  { value: "flagged", label: "Flagged (any)" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
];

export function SessionTraceFilters({
  surfaces,
  initialQuery,
  initialRisk,
  initialSurface,
  initialErrorsOnly,
}: SessionTraceFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v) params.set(k, v);
        else params.delete(k);
      }
      params.delete("page");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  // Debounce the free-text search so we don't navigate on every keystroke.
  useEffect(() => {
    if (query === initialQuery) return;
    const t = setTimeout(() => setParams({ q: query.trim() || null }), 400);
    return () => clearTimeout(t);
  }, [query, initialQuery, setParams]);

  const hasFilters = Boolean(
    initialQuery || initialRisk || initialSurface || initialErrorsOnly,
  );

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 space-y-1 min-w-[220px]">
          <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
            Search
          </label>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="session id or user…"
            className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>

        {surfaces.length > 0 && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
              Source
            </label>
            <Select
              value={initialSurface || ALL}
              onValueChange={(v) => setParams({ surface: v === ALL ? null : v })}
            >
              <SelectTrigger className="h-9 w-[150px] text-xs">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sources</SelectItem>
                {surfaces.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
            Prompt risk
          </label>
          <Select
            value={initialRisk || ALL}
            onValueChange={(v) => setParams({ risk: v === ALL ? null : v })}
          >
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any risk</SelectItem>
              {RISK_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex h-9 shrink-0 cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={initialErrorsOnly}
            onChange={(e) => setParams({ errors: e.target.checked ? "1" : null })}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          Errors only
        </label>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs"
            onClick={() => {
              setQuery("");
              router.replace(pathname);
            }}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
