import { PageHeader } from "@/components/layout/page-header";
import { ClaudeCodeAnalyticsView } from "@/components/oversight/claude-code-analytics-view";

// Dedicated Cowork dashboard — the same OTel analytics view, scoped to the
// Cowork surface (app.entrypoint = "local-agent").
const COWORK_SURFACE = "local-agent";

export default async function CoworkPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const selectedUser = ((await searchParams).user ?? "").trim() || null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cowork Analytics"
        description="Productivity, cost, and governance metrics for Claude Cowork sessions (Claude Desktop VM), sourced from live OTel telemetry. Last 7 days."
      />
      <ClaudeCodeAnalyticsView
        surface={COWORK_SURFACE}
        userEmail={selectedUser}
        showUserFilter
      />
    </div>
  );
}
