import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadForgeConfig } from "@/lib/forge-skills-client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { FilterBar } from "./filter-bar";
import { SyncButton } from "./sync-button";

const PAGE_SIZE = 50;

function contentTypeBadge(contentType: string) {
  const tone =
    contentType === "agent"
      ? "var(--accent)"
      : contentType === "app"
        ? "var(--success)"
        : "var(--text-muted)";
  return (
    <Badge
      variant="outline"
      className="font-mono text-[10px]"
      style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 30%, transparent)` }}
    >
      {contentType}
    </Badge>
  );
}

function statusBadge(status: string) {
  if (status === "retired") {
    return (
      <Badge variant="outline" className="text-[var(--text-muted)]">
        Retired
      </Badge>
    );
  }
  if (status === "draft") {
    return (
      <Badge
        variant="outline"
        className="text-[var(--warning)] border-[var(--warning)]/30"
      >
        Draft
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-[var(--success)] border-[var(--success)]/30"
    >
      Published
    </Badge>
  );
}

export default async function AISkillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const contentTypeParam = typeof params.contentType === "string" ? params.contentType : "";
  const categoryParam = typeof params.category === "string" ? params.category : "";
  const departmentParam = typeof params.department === "string" ? params.department : "";
  const statusParam = typeof params.status === "string" ? params.status : "";
  const pageParam = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const where: Prisma.AISkillWhereInput = {
    ...(contentTypeParam ? { contentType: contentTypeParam } : {}),
    ...(categoryParam ? { categoryName: categoryParam } : {}),
    ...(departmentParam ? { departmentName: departmentParam } : {}),
    ...(statusParam ? { status: statusParam } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { authorName: { contains: q, mode: "insensitive" as const } },
            { tags: { has: q } },
          ],
        }
      : {}),
  };

  const [skills, total, contentTypes, categories, departments, latestRun, config] =
    await Promise.all([
      prisma.aISkill.findMany({
        where,
        orderBy: { forgeUpdatedAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          linkedSystem: { select: { id: true, name: true } },
        },
      }),
      prisma.aISkill.count({ where }),
      prisma.aISkill
        .findMany({ distinct: ["contentType"], select: { contentType: true } })
        .then((r) => r.map((x) => x.contentType).filter(Boolean)),
      prisma.aISkill
        .findMany({
          distinct: ["categoryName"],
          select: { categoryName: true },
          where: { categoryName: { not: null } },
        })
        .then((r) => r.map((x) => x.categoryName!).filter(Boolean)),
      prisma.aISkill
        .findMany({
          distinct: ["departmentName"],
          select: { departmentName: true },
          where: { departmentName: { not: null } },
        })
        .then((r) => r.map((x) => x.departmentName!).filter(Boolean)),
      prisma.forgeSyncRun.findFirst({
        orderBy: { startedAt: "desc" },
        include: {
          triggeredByUser: { select: { name: true, email: true } },
        },
      }),
      loadForgeConfig(),
    ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const configured = config !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Skills"
        description="Published skills (agents, apps, prompts) synced from CertifID Forge."
      >
        <SyncButton configured={configured} />
      </PageHeader>

      {!configured ? (
        <Card>
          <CardContent className="pt-6 text-sm text-[var(--text-muted)]">
            Forge integration is not configured yet. Paste your{" "}
            <code>forge_integration_key</code> in Settings → General to enable sync.
          </CardContent>
        </Card>
      ) : null}

      {latestRun ? (
        <Card>
          <CardContent className="pt-6 flex items-center justify-between gap-4 text-xs text-[var(--text-muted)]">
            <div>
              Last sync {formatDateTime(latestRun.startedAt)}
              {" · "}
              {latestRun.trigger === "cron" ? "automatic" : "manual"}
              {latestRun.triggeredByUser
                ? ` by ${latestRun.triggeredByUser.name ?? latestRun.triggeredByUser.email}`
                : ""}
              {" · "}
              {latestRun.status === "succeeded"
                ? `${latestRun.skillsFetched} fetched (${latestRun.skillsCreated} new, ${latestRun.skillsUpdated} updated)`
                : latestRun.status === "failed"
                  ? `failed: ${latestRun.errorMessage ?? "(no detail)"}`
                  : "running…"}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <FilterBar
            contentTypes={contentTypes}
            categories={categories}
            departments={departments}
            initial={{
              q,
              contentType: contentTypeParam || "all",
              category: categoryParam || "all",
              department: departmentParam || "all",
              status: statusParam || "all",
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {skills.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No skills match this filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase text-[var(--text-muted)]">
                    <th className="py-2 pr-4 font-medium">Skill</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Category</th>
                    <th className="py-2 pr-4 font-medium">Author</th>
                    <th className="py-2 pr-4 font-medium">Department</th>
                    <th className="py-2 pr-4 font-medium">Linked System</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((skill) => (
                    <tr
                      key={skill.id}
                      className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-base)]/50"
                    >
                      <td className="py-2 pr-4">
                        <Link
                          href={`/registry/skills/${skill.id}`}
                          className="font-medium hover:underline"
                        >
                          {skill.name}
                        </Link>
                        {skill.tags.length > 0 ? (
                          <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">
                            {skill.tags.slice(0, 4).join(" · ")}
                            {skill.tags.length > 4 ? ` +${skill.tags.length - 4}` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4">{contentTypeBadge(skill.contentType)}</td>
                      <td className="py-2 pr-4 text-xs">{skill.categoryName ?? "—"}</td>
                      <td className="py-2 pr-4 text-xs">{skill.authorName ?? "—"}</td>
                      <td className="py-2 pr-4 text-xs text-[var(--text-muted)]">
                        {skill.departmentName ?? "—"}
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {skill.linkedSystem ? (
                          <Link
                            href={`/registry/${skill.linkedSystem.id}`}
                            className="text-[var(--accent)] hover:underline"
                          >
                            {skill.linkedSystem.name}
                          </Link>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">{statusBadge(skill.status)}</td>
                      <td className="py-2 pr-4 text-xs text-[var(--text-muted)] whitespace-nowrap">
                        {formatDateTime(skill.forgeUpdatedAt)}
                      </td>
                    </tr>
                  ))}
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
                          pathname: "/registry/skills",
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
                          pathname: "/registry/skills",
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
