import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { ExceptionToggle } from "./exception-toggle";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function PromptRiskExceptionsPage() {
  const exceptions = await prisma.promptRiskException.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      createdByUser: { select: { name: true, email: true } },
      sourceAlert: { select: { id: true, title: true } },
    },
  });

  const activeCount = exceptions.filter((e) => e.active && (!e.expiresAt || e.expiresAt > new Date())).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/alerts" className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <PageHeader
          title="Prompt Risk Exceptions"
          description={`${activeCount} active exception${activeCount !== 1 ? "s" : ""} suppressing future alerts`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Exceptions ({exceptions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {exceptions.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-8 text-center">
              No exceptions yet. Mark an alert as a false positive to create one.
            </p>
          ) : (
            <div className="space-y-3">
              {exceptions.map((exc) => {
                const expired = exc.expiresAt && exc.expiresAt < new Date();
                const isActive = exc.active && !expired;

                return (
                  <div
                    key={exc.id}
                    className={`rounded-lg border p-4 transition-all ${
                      isActive
                        ? "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-base)] opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={isActive ? "info" : "outline"}>
                            {exc.category.replace(/_/g, " ")}
                          </Badge>
                          {exc.pattern ? (
                            <code className="rounded bg-[var(--bg-base)] px-2 py-0.5 text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                              {exc.pattern}
                            </code>
                          ) : (
                            <span className="text-xs text-[var(--text-faint)]">All signals in category</span>
                          )}
                          {!isActive && (
                            <Badge variant="outline">{expired ? "Expired" : "Inactive"}</Badge>
                          )}
                        </div>

                        <p className="text-sm text-[var(--text-secondary)]">{exc.reason}</p>

                        <p className="text-xs text-[var(--text-faint)]">
                          Created by {exc.createdByUser.name ?? exc.createdByUser.email} &middot; {formatDateTime(exc.createdAt)}
                          {exc.expiresAt && (
                            <> &middot; Expires {formatDateTime(exc.expiresAt)}</>
                          )}
                          {exc.sourceAlert && (
                            <> &middot; From alert: {exc.sourceAlert.title}</>
                          )}
                        </p>
                      </div>

                      <ExceptionToggle id={exc.id} active={exc.active} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
