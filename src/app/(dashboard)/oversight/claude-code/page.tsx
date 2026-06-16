import { PageHeader } from "@/components/layout/page-header";
import { ClaudeCodeAnalyticsView } from "@/components/oversight/claude-code-analytics-view";

export default async function ClaudeCodePage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const selectedUser = ((await searchParams).user ?? "").trim() || null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claude Code Analytics"
        description="Per-user developer productivity and usage metrics, sourced entirely from live OTel telemetry. Last 7 days."
      />
      <ClaudeCodeAnalyticsView surface={null} userEmail={selectedUser} showUserFilter />
    </div>
  );
}
