import Link from "next/link";
import { Eye, Settings } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UsageChart } from "@/components/dashboard/usage-chart";
import { formatCompactNumber, formatDateTime } from "@/lib/utils";
import { loadClaudePlatformDashboard } from "@/lib/claude-platform-dashboard";

// Human labels for the Anthropic cost-report `cost_type` line items.
const LINE_ITEM_LABELS: Record<string, string> = {
  uncached_input_tokens: "Input (uncached)",
  cache_read_input_tokens: "Cache read",
  cache_creation_input_tokens: "Cache creation",
  output_tokens: "Output",
  tokens: "Tokens",
};

function lineItemLabel(key: string): string {
  return LINE_ITEM_LABELS[key] ?? key.replace(/_/g, " ");
}

export default async function ClaudePlatformPage() {
  const data = await loadClaudePlatformDashboard();
  const { summary, sync } = data;
  const syncFresh = sync?.fresh ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claude Platform"
        description="Anthropic Console / API usage, cost, and access — sourced from the Anthropic Admin API sync. Last 30 days."
      >
        <Link href="/oversight/usage?provider=anthropic">
          <Button variant="outline">
            <Eye className="mr-2 h-4 w-4" /> View All Logs
          </Button>
        </Link>
        <Link href="/settings/provider-admin">
          <Button variant="outline">
            <Settings className="mr-2 h-4 w-4" /> Provider Admin
          </Button>
        </Link>
      </PageHeader>

      {!data.configured && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--text-muted)]">
            The Anthropic Admin API is not connected. Add an admin key in{" "}
            <Link
              href="/settings/provider-admin"
              className="text-[var(--accent)] hover:underline"
            >
              Settings → Provider Admin APIs → Anthropic
            </Link>{" "}
            and run a telemetry sync to populate this dashboard.
          </CardContent>
        </Card>
      )}

      {data.configured && !data.hasData && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--text-muted)]">
            No Anthropic usage has been synced yet. Once a telemetry sync runs,
            usage and cost land here. Trigger one from{" "}
            <Link
              href="/settings/provider-admin"
              className="text-[var(--accent)] hover:underline"
            >
              Settings → Provider Admin APIs
            </Link>
            .
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard
          title="Total Cost"
          value={`$${summary.totalCost.toFixed(2)}`}
          description="Last 30 days"
          iconName="DollarSign"
          variant="info"
          href="/oversight/usage?provider=anthropic"
        />
        <StatCard
          title="Total Tokens"
          value={formatCompactNumber(summary.totalTokens)}
          description={
            summary.cachedTokens > 0
              ? `incl. ${formatCompactNumber(summary.cachedTokens)} cached`
              : `${summary.totalTokens.toLocaleString("en-US")} in 30 days`
          }
          iconName="Database"
          variant="default"
        />
        <StatCard
          title="Cache Hit Rate"
          value={summary.cacheHitRate == null ? "—" : `${Math.round(summary.cacheHitRate * 100)}%`}
          description="Cache-read tokens / input tokens"
          iconName="Activity"
          variant={summary.cacheHitRate && summary.cacheHitRate > 0 ? "success" : "default"}
        />
        <StatCard
          title="Requests"
          value={summary.requests == null ? "—" : formatCompactNumber(summary.requests)}
          description={summary.requests == null ? "Not reported by Admin API" : "Last 30 days"}
          iconName="Eye"
          variant="default"
        />
        <StatCard
          title="Active API Keys"
          value={summary.activeApiKeys}
          description="From the organization key list"
          iconName="FileCheck"
          variant="info"
        />
        <StatCard
          title="Org Members"
          value={summary.orgMembers}
          description="Anthropic organization members"
          iconName="Bot"
          variant="info"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usage &amp; Cost Trend (30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          <UsageChart data={data.dailyUsage} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cost by Model</CardTitle>
          </CardHeader>
          <CardContent>
            {data.costByModel.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No cost data yet.</p>
            ) : (
              <div className="space-y-2">
                {data.costByModel.map((row) => (
                  <div
                    key={row.model}
                    className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                  >
                    <p className="truncate text-sm font-medium">{row.model}</p>
                    <p className="text-sm font-semibold">${row.amount.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost by Line-Item</CardTitle>
          </CardHeader>
          <CardContent>
            {data.costByLineItem.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No cost data yet.</p>
            ) : (
              <div className="space-y-2">
                {data.costByLineItem.map((row) => (
                  <div
                    key={row.lineItem}
                    className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                  >
                    <p className="text-sm font-medium">{lineItemLabel(row.lineItem)}</p>
                    <p className="text-sm font-semibold">${row.amount.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tokens by Model</CardTitle>
        </CardHeader>
        <CardContent>
          {data.tokensByModel.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No usage data yet.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 text-xs uppercase tracking-wider text-[var(--text-faint)]">
                <span>Model</span>
                <span className="flex gap-6">
                  <span className="w-24 text-right">Input</span>
                  <span className="w-24 text-right">Output</span>
                  <span className="w-24 text-right">Cache read</span>
                  <span className="w-24 text-right">Total</span>
                </span>
              </div>
              {data.tokensByModel.map((row) => (
                <div
                  key={row.model}
                  className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                >
                  <p className="truncate text-sm font-medium">{row.model}</p>
                  <span className="flex gap-6 text-sm tabular-nums">
                    <span className="w-24 text-right text-[var(--text-muted)]">
                      {formatCompactNumber(row.inputTokens)}
                    </span>
                    <span className="w-24 text-right text-[var(--text-muted)]">
                      {formatCompactNumber(row.outputTokens)}
                    </span>
                    <span className="w-24 text-right text-[var(--text-muted)]">
                      {formatCompactNumber(row.cacheReadTokens)}
                    </span>
                    <span className="w-24 text-right font-semibold">
                      {formatCompactNumber(row.totalTokens)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Usage by API Key</CardTitle>
          </CardHeader>
          <CardContent>
            {data.usageByApiKey.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No per-key usage yet.</p>
            ) : (
              <div className="space-y-2">
                {data.usageByApiKey.map((row) => (
                  <div
                    key={row.apiKeyExternalId ?? row.apiKeyName ?? "unattributed"}
                    className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {row.apiKeyName ?? row.apiKeyExternalId ?? "(unattributed)"}
                      </p>
                      {row.status && (
                        <Badge variant={row.status === "active" ? "success" : "outline"}>
                          {row.status}
                        </Badge>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        {formatCompactNumber(row.totalTokens)} tokens
                      </p>
                      {row.requests != null && (
                        <p className="text-xs text-[var(--text-muted)]">
                          {row.requests.toLocaleString("en-US")} requests
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organization Members</CardTitle>
          </CardHeader>
          <CardContent>
            {data.members.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No members synced yet.</p>
            ) : (
              <div className="space-y-2">
                {data.members.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {m.name ?? m.email ?? "(unknown)"}
                      </p>
                      {m.name && m.email && (
                        <p className="truncate text-xs text-[var(--text-muted)]">{m.email}</p>
                      )}
                    </div>
                    {m.role && (
                      <Badge variant="info" className="capitalize">
                        {m.role.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sync Health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!sync ? (
            <p className="text-sm text-[var(--text-muted)]">
              No Anthropic telemetry sync has run yet.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                <div>
                  <p className="text-sm font-medium">Anthropic telemetry</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {sync.lastSuccessAt
                      ? `Last success ${formatDateTime(sync.lastSuccessAt)}`
                      : "No successful sync yet"}
                  </p>
                </div>
                <Badge variant={syncFresh ? "success" : "warning"}>
                  {syncFresh ? "Fresh" : "Stale"}
                </Badge>
              </div>
              {sync.errorMessage && (
                <div className="rounded-md border border-[var(--critical)]/20 bg-[var(--critical)]/5 p-3">
                  <p className="text-sm font-medium text-[var(--critical)]">Most recent failure</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{sync.errorMessage}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
