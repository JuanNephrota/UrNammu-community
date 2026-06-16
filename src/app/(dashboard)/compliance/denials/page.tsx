import Link from "next/link";
import { Download } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { parseEnforcementMode } from "@/lib/settings";
import { listBlockedEvents, type BlockedEventSource } from "@/lib/blocked-events";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { FilterBar } from "./filter-bar";

const PAGE_SIZE = 50;

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function defaultSince(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sourceBadge(source: "policy" | "content", modeLabel: string) {
  if (source === "policy") {
    if (modeLabel === "enforced") {
      return (
        <Badge className="bg-[var(--critical)]/15 text-[var(--critical)] border border-[var(--critical)]/30">
          Policy · Enforced
        </Badge>
      );
    }
    return (
      <Badge className="bg-[var(--warning)]/15 text-[var(--warning)] border border-[var(--warning)]/30">
        Policy · Dry run
      </Badge>
    );
  }
  // content
  return (
    <Badge className="bg-[var(--critical)]/15 text-[var(--critical)] border border-[var(--critical)]/30">
      Content · Blocked
    </Badge>
  );
}

export default async function BlockedQueriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sourceParam = typeof params.source === "string" ? params.source : "";
  const source: BlockedEventSource | undefined =
    sourceParam === "policy" || sourceParam === "content" ? sourceParam : undefined;
  const aiSystemIdParam = typeof params.aiSystemId === "string" ? params.aiSystemId : "";
  const policyIdParam = typeof params.policyId === "string" ? params.policyId : "";
  const sinceParam = typeof params.since === "string" ? params.since : "";
  const untilParam = typeof params.until === "string" ? params.until : "";
  const pageParam = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const since = parseDate(sinceParam) ?? defaultSince();
  const until = parseDate(untilParam) ?? undefined;

  const [{ items, total }, systems, policies, enforcementModeSetting] =
    await Promise.all([
      listBlockedEvents(
        {
          since,
          until,
          aiSystemId: aiSystemIdParam || undefined,
          policyId: policyIdParam || undefined,
          source,
        },
        { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }
      ),
      prisma.aISystem.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.policy.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.appSetting.findUnique({ where: { key: "policy_enforcement_mode" } }),
    ]);

  const currentMode = parseEnforcementMode(enforcementModeSetting?.value);

  const systemNames = new Map(systems.map((s) => [s.id, s.name]));
  const policyNames = new Map(policies.map((p) => [p.id, p.name]));

  const exportQs = new URLSearchParams();
  if (source) exportQs.set("source", source);
  if (aiSystemIdParam) exportQs.set("aiSystemId", aiSystemIdParam);
  if (policyIdParam) exportQs.set("policyId", policyIdParam);
  if (sinceParam) exportQs.set("since", sinceParam);
  if (untilParam) exportQs.set("until", untilParam);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blocked Queries"
        description={
          `Requests rejected or flagged by UrNammu — policy denials from the proxy plus dangerous-prompt content blocks. ` +
          (currentMode === "off"
            ? "Policy enforcement is off; new policy rows only appear once you flip the mode in Settings → General."
            : currentMode === "dryrun"
              ? "Policy enforcement is in dry-run; rows are recorded but requests still forward."
              : "Policy enforcement is on; blocking denials return 403.")
        }
      >
        <a href={`/api/policy-denials/export?${exportQs.toString()}`}>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </a>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          <FilterBar
            systems={systems}
            policies={policies}
            initial={{
              source: source ?? "all",
              aiSystemId: aiSystemIdParam,
              policyId: policyIdParam,
              since: sinceParam || since.toISOString(),
              until: untilParam,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {items.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No blocked queries in this range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase text-[var(--text-muted)]">
                    <th className="py-2 pr-4 font-medium">Time</th>
                    <th className="py-2 pr-4 font-medium">Source</th>
                    <th className="py-2 pr-4 font-medium">System</th>
                    <th className="py-2 pr-4 font-medium">Provider · Model</th>
                    <th className="py-2 pr-4 font-medium">Policies</th>
                    <th className="py-2 pr-4 font-medium">Reason</th>
                    <th className="py-2 pr-4 font-medium">User</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const systemName = row.aiSystemId
                      ? systemNames.get(row.aiSystemId) ?? row.aiSystemId
                      : "—";
                    const policyList = row.policyIds
                      .map((id) => policyNames.get(id) ?? id)
                      .join(", ");
                    const extra = row.reasonCount > 1 ? ` (+${row.reasonCount - 1})` : "";
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-base)]/50"
                      >
                        <td className="py-2 pr-4 text-xs text-[var(--text-muted)] whitespace-nowrap">
                          <Link href={row.detailHref} className="hover:underline">
                            {formatDateTime(row.createdAt)}
                          </Link>
                        </td>
                        <td className="py-2 pr-4">
                          {sourceBadge(row.source, row.modeLabel)}
                        </td>
                        <td className="py-2 pr-4">
                          {row.aiSystemId ? (
                            <Link
                              href={`/registry/${row.aiSystemId}`}
                              className="hover:underline text-[var(--accent)]"
                            >
                              {systemName}
                            </Link>
                          ) : (
                            <span className="text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          <span className="text-[var(--text-muted)]">
                            {row.provider ?? "—"}
                          </span>
                          {row.model ? (
                            <>
                              {" · "}
                              <span>{row.model}</span>
                            </>
                          ) : null}
                        </td>
                        <td className="py-2 pr-4 text-xs max-w-[220px] truncate" title={policyList}>
                          {policyList || "—"}
                        </td>
                        <td className="py-2 pr-4 text-xs max-w-[320px] truncate" title={row.primaryReason}>
                          {row.primaryReason}
                          {extra}
                        </td>
                        <td className="py-2 pr-4 text-xs text-[var(--text-muted)] whitespace-nowrap">
                          {row.userEmail ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {totalPages > 1 ? (
                <div className="flex items-center justify-between pt-4 text-xs text-[var(--text-muted)]">
                  <span>
                    Page {page} of {totalPages} · {total} total
                  </span>
                  <div className="flex gap-2">
                    {page > 1 ? (
                      <Link
                        href={{
                          pathname: "/compliance/denials",
                          query: { ...params, page: page - 1 },
                        }}
                        className="rounded-md border border-[var(--border-subtle)] px-3 py-1 hover:bg-[var(--bg-base)]"
                      >
                        Previous
                      </Link>
                    ) : null}
                    {page < totalPages ? (
                      <Link
                        href={{
                          pathname: "/compliance/denials",
                          query: { ...params, page: page + 1 },
                        }}
                        className="rounded-md border border-[var(--border-subtle)] px-3 py-1 hover:bg-[var(--bg-base)]"
                      >
                        Next
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
