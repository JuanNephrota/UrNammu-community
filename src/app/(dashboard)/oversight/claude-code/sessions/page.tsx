import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SessionTraceFilters } from "@/components/oversight/session-trace-filters";
import { surfaceLabel } from "@/lib/claude-code-events";
import {
  countSessions,
  formatElapsed,
  loadSessionList,
  loadSessionSurfaces,
  SESSION_WINDOW_DAYS,
  SESSIONS_PAGE_SIZE,
  type SessionListFilters,
} from "@/lib/claude-code-traces";

export default async function ClaudeCodeSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    risk?: string;
    surface?: string;
    errors?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const risk = (params.risk ?? "").trim();
  const surface = (params.surface ?? "").trim();
  const errorsOnly = params.errors === "1";
  const pageParam = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const filters: SessionListFilters = {
    q: q || null,
    risk: risk || null,
    surface: surface || null,
    errorsOnly,
  };

  // Sequential: the prod DB runs with connection_limit=1.
  const total = await countSessions(filters);
  const totalPages = Math.max(1, Math.ceil(total / SESSIONS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const sessions = await loadSessionList(filters, currentPage);
  const surfaceValues = await loadSessionSurfaces();

  const surfaces = surfaceValues.map((value) => ({
    value,
    label: surfaceLabel(value),
  }));

  const hrefForPage = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (risk) sp.set("risk", risk);
    if (surface) sp.set("surface", surface);
    if (errorsOnly) sp.set("errors", "1");
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs
      ? `/oversight/claude-code/sessions?${qs}`
      : "/oversight/claude-code/sessions";
  };

  const firstRow = total === 0 ? 0 : (currentPage - 1) * SESSIONS_PAGE_SIZE + 1;
  const lastRow = Math.min(currentPage * SESSIONS_PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claude Code Session Traces"
        description={`Every Claude Code session as a trace — turns, model calls, and tool use in order, with timing. Synthesized from OTel events (metadata only, no prompt or code content). Last ${SESSION_WINDOW_DAYS} days.`}
      />

      <Link
        href="/oversight/claude-code"
        className="inline-block text-xs font-medium text-[var(--accent)] hover:underline"
      >
        ← Back to Claude Code analytics
      </Link>

      <SessionTraceFilters
        surfaces={surfaces}
        initialQuery={q}
        initialRisk={risk}
        initialSurface={surface}
        initialErrorsOnly={errorsOnly}
      />

      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 text-xs text-[var(--text-muted)]">
            {total === 0
              ? "No matching sessions"
              : `Showing ${firstRow.toLocaleString("en-US")}–${lastRow.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} sessions`}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {[
                    "Started",
                    "Session",
                    "User",
                    "Source",
                    "Elapsed",
                    "Turns",
                    "Tools",
                    "Events",
                    "Status",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-8 text-center text-[var(--text-muted)]"
                    >
                      No sessions match the current filters.
                    </td>
                  </tr>
                ) : (
                  sessions.map((s) => (
                    <tr
                      key={s.sessionId}
                      className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                    >
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--text-muted)]">
                        {s.startedAt.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/oversight/claude-code/sessions/${encodeURIComponent(s.sessionId)}`}
                          className="font-mono text-[11px] text-[var(--accent)] hover:underline"
                        >
                          {s.sessionId.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">
                        {s.userEmail ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">
                        {s.entrypoint === "local-agent" ? (
                          <Badge variant="info">Cowork</Badge>
                        ) : (
                          surfaceLabel(s.entrypoint)
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums text-[var(--text-secondary)]">
                        {formatElapsed(s.durationMs)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">
                        {s.turns}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">
                        {s.tools}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-[var(--text-muted)]">
                        {s.events}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          {s.flagged > 0 && (
                            <Badge variant="critical">{s.flagged} flagged</Badge>
                          )}
                          {s.errors > 0 && (
                            <Badge variant="warning">{s.errors} err</Badge>
                          )}
                          {s.flagged === 0 && s.errors === 0 && (
                            <span className="text-[var(--text-faint)]">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex gap-2">
                {currentPage > 1 ? (
                  <Link
                    href={hrefForPage(currentPage - 1)}
                    className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                  >
                    ← Prev
                  </Link>
                ) : (
                  <span className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-faint)]">
                    ← Prev
                  </span>
                )}
                {currentPage < totalPages ? (
                  <Link
                    href={hrefForPage(currentPage + 1)}
                    className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                  >
                    Next →
                  </Link>
                ) : (
                  <span className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-faint)]">
                    Next →
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
