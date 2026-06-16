import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EventLogFilters } from "@/components/oversight/event-log-filters";
import {
  CLAUDE_CODE_EVENT_SELECT,
  eventDetail,
  surfaceLabel,
  type ClaudeCodeEventRow,
} from "@/lib/claude-code-events";

const PAGE_SIZE = 50;
// Audit retention window the log searches over (matches the prune cron default).
const WINDOW_DAYS = 30;

// Wrapped in a helper so the component body stays pure (react-hooks/purity).
function windowStart(): Date {
  return new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export default async function ClaudeCodeEventsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    event?: string;
    page?: string;
    risk?: string;
    surface?: string;
  }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const event = (params.event ?? "").trim();
  const risk = (params.risk ?? "").trim();
  const surface = (params.surface ?? "").trim();
  const pageParam = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const since = windowStart();

  const riskWhere: Prisma.ClaudeCodeEventWhereInput =
    risk === "flagged"
      ? { riskSeverity: { not: null } }
      : risk === "critical" || risk === "warning"
        ? { riskSeverity: risk }
        : {};

  const where: Prisma.ClaudeCodeEventWhereInput = {
    timestamp: { gte: since },
    ...riskWhere,
    ...(surface ? { entrypoint: surface } : {}),
    ...(event ? { eventName: event } : {}),
    ...(q
      ? {
          OR: [
            { userEmail: { contains: q, mode: "insensitive" } },
            { sessionId: { contains: q, mode: "insensitive" } },
            { toolName: { contains: q, mode: "insensitive" } },
            { model: { contains: q, mode: "insensitive" } },
            { errorType: { contains: q, mode: "insensitive" } },
            { decision: { contains: q, mode: "insensitive" } },
            { decisionSource: { contains: q, mode: "insensitive" } },
            { eventName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, eventTypeGroups, surfaceGroups] = await Promise.all([
    prisma.claudeCodeEvent.count({ where }),
    prisma.claudeCodeEvent.groupBy({
      by: ["eventName"],
      where: { timestamp: { gte: since } },
      orderBy: { eventName: "asc" },
    }),
    prisma.claudeCodeEvent.groupBy({
      by: ["entrypoint"],
      where: { timestamp: { gte: since }, entrypoint: { not: null } },
      orderBy: { entrypoint: "asc" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const rows: ClaudeCodeEventRow[] = await prisma.claudeCodeEvent.findMany({
    where,
    orderBy: { timestamp: "desc" },
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: CLAUDE_CODE_EVENT_SELECT,
  });

  const eventTypes = eventTypeGroups.map((g) => g.eventName);
  const surfaces = surfaceGroups
    .map((g) => g.entrypoint)
    .filter((e): e is string => Boolean(e))
    .map((value) => ({ value, label: surfaceLabel(value) }));

  // Build a pagination href preserving the active filters.
  const hrefForPage = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (event) sp.set("event", event);
    if (risk) sp.set("risk", risk);
    if (surface) sp.set("surface", surface);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `/oversight/claude-code/events?${qs}` : "/oversight/claude-code/events";
  };

  const firstRow = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(currentPage * PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claude Code Audit Log"
        description="Per-event audit trail from Claude Code telemetry (metadata only — no prompt or code content). Searchable and filterable across the last 30 days."
      />

      <Link
        href="/oversight/claude-code"
        className="inline-block text-xs font-medium text-[var(--accent)] hover:underline"
      >
        ← Back to Claude Code analytics
      </Link>

      <EventLogFilters
        eventTypes={eventTypes}
        surfaces={surfaces}
        initialQuery={q}
        initialEvent={event}
        initialRisk={risk}
        initialSurface={surface}
      />

      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>
              {total === 0
                ? "No matching events"
                : `Showing ${firstRow.toLocaleString("en-US")}–${lastRow.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`}
            </span>
            {(q || event) && (
              <span className="text-[var(--text-faint)]">
                filtered{event ? ` · ${event}` : ""}
                {q ? ` · "${q}"` : ""}
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["Time", "Event", "Risk", "Source", "User", "Detail", "Session"].map((h) => (
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
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-[var(--text-muted)]"
                    >
                      No events match the current filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((e) => (
                    <tr
                      key={e.id}
                      className="border-t border-[var(--border-subtle)]"
                    >
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--text-muted)]">
                        {e.timestamp.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            e.eventName === "api_error" ||
                            e.decision === "reject" ||
                            e.success === false
                              ? "warning"
                              : "default"
                          }
                        >
                          {e.eventName}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {e.riskSeverity ? (
                          <Badge
                            variant={
                              e.riskSeverity === "critical" ? "critical" : "warning"
                            }
                            title={e.riskCategory ?? undefined}
                          >
                            {e.riskSeverity}
                          </Badge>
                        ) : (
                          <span className="text-[var(--text-faint)]">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">
                        {e.entrypoint === "local-agent" ? (
                          <Badge variant="info">Cowork</Badge>
                        ) : (
                          surfaceLabel(e.entrypoint)
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">
                        {e.userEmail ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-primary)]">
                        {eventDetail(e) || "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-faint)]">
                        {e.sessionId ? e.sessionId.slice(0, 8) : "—"}
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
