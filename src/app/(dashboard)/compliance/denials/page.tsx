import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Download } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { parseEnforcementMode } from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { FilterBar } from "./filter-bar";

type Reason = { ruleKey: string; message: string; policyId: string; policyName: string };

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

function modeBadge(mode: string) {
  if (mode === "enforced") {
    return (
      <Badge className="bg-[var(--critical)]/15 text-[var(--critical)] border border-[var(--critical)]/30">
        Enforced
      </Badge>
    );
  }
  if (mode === "dryrun") {
    return (
      <Badge className="bg-[var(--warning)]/15 text-[var(--warning)] border border-[var(--warning)]/30">
        Dry run
      </Badge>
    );
  }
  return <Badge variant="outline">{mode}</Badge>;
}

export default async function PolicyDenialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const mode =
    typeof params.mode === "string" && (params.mode === "dryrun" || params.mode === "enforced")
      ? params.mode
      : null;
  const aiSystemIdParam = typeof params.aiSystemId === "string" ? params.aiSystemId : "";
  const policyIdParam = typeof params.policyId === "string" ? params.policyId : "";
  const sinceParam = typeof params.since === "string" ? params.since : "";
  const untilParam = typeof params.until === "string" ? params.until : "";
  const pageParam = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const since = parseDate(sinceParam) ?? defaultSince();
  const until = parseDate(untilParam);

  // Build the filter once; re-used for list, count, and available-policy lookup.
  const where: Prisma.PolicyDenialWhereInput = {
    createdAt: {
      gte: since,
      ...(until ? { lte: until } : {}),
    },
    ...(mode ? { mode } : {}),
    ...(aiSystemIdParam ? { aiSystemId: aiSystemIdParam } : {}),
    ...(policyIdParam ? { policyIds: { has: policyIdParam } } : {}),
  };

  const [denials, totalCount, systems, policies, enforcementModeSetting] = await Promise.all([
    prisma.policyDenial.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.policyDenial.count({ where }),
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

  // Hydrate aiSystemId → name for the rows we just read.
  const systemNames = new Map(systems.map((s) => [s.id, s.name]));
  const policyNames = new Map(policies.map((p) => [p.id, p.name]));

  // Pass the current filter state to the CSV export link.
  const exportQs = new URLSearchParams();
  if (mode) exportQs.set("mode", mode);
  if (aiSystemIdParam) exportQs.set("aiSystemId", aiSystemIdParam);
  if (policyIdParam) exportQs.set("policyId", policyIdParam);
  if (sinceParam) exportQs.set("since", sinceParam);
  if (untilParam) exportQs.set("until", untilParam);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Policy Denials"
        description={
          currentMode === "off"
            ? "Global enforcement is currently off — no new denials are being recorded. Change the mode in Settings → General to start collecting."
            : currentMode === "dryrun"
              ? "Dry-run mode — denials are logged, but requests still pass through."
              : "Enforce mode — blocking denials return 403 to the caller."
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
              mode: mode ?? "all",
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
          {denials.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No denials in this range. {currentMode === "off" ? "(Enforcement is off.)" : ""}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase text-[var(--text-muted)]">
                    <th className="py-2 pr-4 font-medium">Time</th>
                    <th className="py-2 pr-4 font-medium">Mode</th>
                    <th className="py-2 pr-4 font-medium">System</th>
                    <th className="py-2 pr-4 font-medium">Provider · Model</th>
                    <th className="py-2 pr-4 font-medium">Policies</th>
                    <th className="py-2 pr-4 font-medium">Reasons</th>
                    <th className="py-2 pr-4 font-medium">User</th>
                  </tr>
                </thead>
                <tbody>
                  {denials.map((row) => {
                    const reasons = Array.isArray(row.reasons)
                      ? (row.reasons as unknown as Reason[])
                      : [];
                    const firstReason = reasons[0]?.message ?? "—";
                    const extraReasons = reasons.length > 1 ? ` (+${reasons.length - 1})` : "";
                    const systemName = row.aiSystemId
                      ? systemNames.get(row.aiSystemId) ?? row.aiSystemId
                      : "—";
                    const policyList = row.policyIds
                      .map((id) => policyNames.get(id) ?? id)
                      .join(", ");

                    return (
                      <tr
                        key={row.id}
                        className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-base)]/50"
                      >
                        <td className="py-2 pr-4 text-xs text-[var(--text-muted)] whitespace-nowrap">
                          <Link href={`/compliance/denials/${row.id}`} className="hover:underline">
                            {formatDateTime(row.createdAt)}
                          </Link>
                        </td>
                        <td className="py-2 pr-4">{modeBadge(row.mode)}</td>
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
                          <span className="text-[var(--text-muted)]">{row.provider}</span>
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
                        <td className="py-2 pr-4 text-xs max-w-[320px] truncate" title={reasons.map((r) => r.message).join("\n")}>
                          {firstReason}
                          {extraReasons}
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
                    Page {page} of {totalPages} · {totalCount} total
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
