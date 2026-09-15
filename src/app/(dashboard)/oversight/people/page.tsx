import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PeopleRangeFilter } from "@/components/oversight/people-range-filter";
import { PeopleReportButton } from "@/components/oversight/people-report-button";
import { PeopleUsageTable, type PersonUsageTableRow } from "@/components/oversight/people-usage-table";
import { getSession } from "@/lib/auth-guard";
import {
  loadPeopleUsage,
  parsePeopleUsageRange,
  resolvePeopleUsageWindow,
  PEOPLE_USAGE_RANGES,
} from "@/lib/people-usage";
import { REPORT_TEMPLATES } from "@/lib/reports/templates";
import { formatCompactNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const AUTHOR_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function PeopleUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const range = parsePeopleUsageRange((await searchParams).range);
  const rangeLabel = PEOPLE_USAGE_RANGES.find((r) => r.value === range)?.label ?? "Last 30 days";
  const window = resolvePeopleUsageWindow(range);

  const [data, session] = await Promise.all([loadPeopleUsage(window), getSession()]);
  const canAuthorReports = Boolean(session && AUTHOR_ROLES.includes(session.user.role));
  const template = REPORT_TEMPLATES.find((t) => t.key === "usage-by-person");

  const tableRows: PersonUsageTableRow[] = data.rows.map((r) => ({
    ...r,
    lastActiveAt: r.lastActiveAt ? r.lastActiveAt.toISOString() : null,
  }));

  const { summary, unattributed } = data;
  const unattributedSurfaces = (Object.keys(unattributed.bySurface) as (keyof typeof unattributed.bySurface)[]).filter(
    (s) => unattributed.bySurface[s].cost > 0 || unattributed.bySurface[s].tokens > 0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage by Person"
        description={`Who is using which AI surface, and what it costs — Claude Code, Cowork, Cursor, and proxied API calls merged by email. ${rangeLabel}.`}
      >
        <PeopleRangeFilter initialRange={range} />
        {canAuthorReports && template && (
          <PeopleReportButton
            template={{
              key: template.key,
              name: template.name,
              description: template.description,
              dataSource: template.dataSource,
              config: template.config as unknown as Record<string, unknown>,
            }}
          />
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="People with activity"
          value={summary.people}
          description={`${rangeLabel.toLowerCase()} · any surface`}
          iconName="Users"
          variant="info"
        />
        <StatCard
          title="Attributed cost"
          value={usd(summary.totalCost)}
          description="Sum of per-person cost across surfaces"
          iconName="DollarSign"
          variant="success"
        />
        <StatCard
          title="Cost per person"
          value={usd(summary.avgCostPerPerson)}
          description="Average across people with activity"
          iconName="Activity"
        />
        <StatCard
          title="Unattributed cost"
          value={usd(summary.unattributedCost)}
          description={
            summary.unattributedCost > 0
              ? "Usage with no email identity — see notes below"
              : "Every dollar in the window maps to a person"
          }
          iconName="AlertTriangle"
          variant={summary.unattributedCost > 0 ? "warning" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By surface</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summary.bySurface.map((s) => (
              <div
                key={s.surface}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
              >
                <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">{s.label}</p>
                <p className="mt-1 text-xl font-semibold text-[var(--text-primary)] tabular-nums">{usd(s.cost)}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {s.people} {s.people === 1 ? "person" : "people"} · {formatCompactNumber(s.tokens)} tokens
                </p>
                {unattributed.bySurface[s.surface].cost > 0 && (
                  <p className="mt-1 text-xs text-[var(--warning)]">
                    + {usd(unattributed.bySurface[s.surface].cost)} unattributed
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
        </CardHeader>
        <CardContent>
          {tableRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">
              No per-person telemetry in this window. Claude Code and Cowork need the OTel pipeline or the
              Anthropic Admin API key; Cursor needs the Cursor Admin API key; proxy traffic needs the{" "}
              <code className="text-xs">x-user-email</code> header. See{" "}
              <Link href="/settings" className="text-[var(--accent)] hover:underline">
                Settings
              </Link>
              .
            </p>
          ) : (
            <PeopleUsageTable rows={tableRows} rangeKey={range} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How these numbers are built</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-[var(--text-muted)]">
            <li>
              <span className="text-[var(--text-secondary)]">Identity.</span>{" "}
              People are matched by lower-cased email
              across every source. Name and department come from the UrNammu user profile when one exists, otherwise
              from the provider&apos;s member directory.
            </li>
            <li>
              <span className="text-[var(--text-secondary)]">Claude Code and Cowork</span>{" "}
              come from live OpenTelemetry
              metrics. Cowork is the Claude Desktop <code className="text-xs">local-agent</code> surface; everything else
              counts as Claude Code, so the two columns never overlap. When a person has no OTel data, the Anthropic
              Admin API analytics sync fills in sessions, lines, commits, and an estimated cost (marked{" "}
              <span className="uppercase text-[10px] tracking-wider">est.</span>).
            </li>
            <li>
              <span className="text-[var(--text-secondary)]">Cursor</span>{" "}
              comes from the Cursor Admin API sync. Per-user
              spend is recorded from the usage-events feed on each sync; days synced before that field existed show
              Cursor cost as <span className="text-[var(--text-faint)]">n/a</span> rather than zero.
            </li>
            <li>
              <span className="text-[var(--text-secondary)]">API (proxy)</span>{" "}
              covers Anthropic and OpenAI calls made
              through the governance proxy, attributed by the <code className="text-xs">x-user-email</code> header.
              Anthropic Console usage is reported per API key, not per person, and is intentionally excluded here — see{" "}
              <Link href="/oversight/claude-platform" className="text-[var(--accent)] hover:underline">
                Claude Platform
              </Link>
              .
            </li>
            {unattributedSurfaces.length > 0 && (
              <li>
                <span className="text-[var(--warning)]">Unattributed.</span>{" "}
              Usage with no email identity (anonymous
                proxy calls, API-key actors, un-tagged OTel clients) is excluded from the table and totalled in the
                Unattributed card:{" "}
                {unattributedSurfaces
                  .map((s) => `${summary.bySurface.find((b) => b.surface === s)?.label}: ${usd(unattributed.bySurface[s].cost)}`)
                  .join(" · ")}
                .
              </li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
