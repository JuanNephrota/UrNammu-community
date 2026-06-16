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

interface EventLogFiltersProps {
  eventTypes: string[];
  surfaces: { value: string; label: string }[];
  initialQuery: string;
  initialEvent: string;
  initialRisk: string;
  initialSurface: string;
}

const ALL = "__all__";

const RISK_OPTIONS = [
  { value: "flagged", label: "Flagged (any)" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
];

export function EventLogFilters({
  eventTypes,
  surfaces,
  initialQuery,
  initialEvent,
  initialRisk,
  initialSurface,
}: EventLogFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);

  // Push an updated query string. Any filter change resets pagination to
  // page 1 so you don't land on an out-of-range page.
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
    initialQuery || initialEvent || initialRisk || initialSurface,
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
            placeholder="user, tool, model, error, session…"
            className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
            Event type
          </label>
          <Select
            value={initialEvent || ALL}
            onValueChange={(v) => setParams({ event: v === ALL ? null : v })}
          >
            <SelectTrigger className="h-9 w-[200px] text-xs">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All events</SelectItem>
              {eventTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
