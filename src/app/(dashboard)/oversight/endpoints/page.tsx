import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  collectorLabel,
  collectorReasonLabel,
  isStale,
  loadFleetView,
  signalLabel,
} from "@/lib/endpoint-fleet";
import { categoryLabel } from "@/lib/ai-tools-registry";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EndpointsPage() {
  const { summary, devices, tools, neverEnrolled } = await loadFleetView();
  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Endpoints"
        description="Machines running the UrNammu endpoint agent, and the AI tools they actually run and reach. Covers the laptops that network and SaaS-side sources go blind on — off-VPN browsing, personal-tier accounts, desktop apps and local inference."
      />

      {neverEnrolled ? (
        <Card>
          <CardHeader>
            <CardTitle>No endpoints enrolled yet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[var(--text-secondary)]">
            <p>
              The endpoint agent reports which AI tools a machine runs and reaches —
              installed AI apps, allowlisted AI hostnames from browser history, and
              local inference runtimes such as Ollama or LM Studio. It never collects
              prompts, responses, URLs or window titles.
            </p>
            <p>
              Generate an enrollment secret in{" "}
              <Link
                href="/settings/endpoint-agent"
                className="text-[var(--accent)] hover:underline"
              >
                Settings &rarr; Endpoint Agent
              </Link>
              , then push the agent with the Hexnode scripts in{" "}
              <code className="text-[var(--text-primary)]">ops/endpoint-agent/mdm</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Enrolled devices"
              value={summary.total}
              description={`${summary.active} active · ${summary.stale} stale · ${summary.revoked} revoked`}
              iconName="Users"
            />
            <StatCard
              title="AI tools observed"
              value={summary.distinctTools}
              description="distinct tools across the fleet"
              iconName="Eye"
            />
            <StatCard
              title="Local model runtimes"
              value={summary.withLocalRuntime}
              description="devices serving models from loopback"
              iconName="Cpu"
              variant={summary.withLocalRuntime > 0 ? "danger" : "default"}
            />
            <StatCard
              title="Degraded collectors"
              value={summary.degraded}
              description="devices under-reporting"
              iconName="AlertTriangle"
              variant={summary.degraded > 0 ? "warning" : "default"}
            />
          </div>

          {summary.withLocalRuntime > 0 && (
            <Card className="border-[var(--critical-border)]">
              <CardHeader>
                <CardTitle>Local inference in use</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-[var(--text-secondary)]">
                {summary.withLocalRuntime} device
                {summary.withLocalRuntime === 1 ? " is" : "s are"} running a model
                server on loopback. Traffic to a local model never reaches the proxy,
                never appears in a vendor admin API and never resolves a domain the
                DNS logs could catch — so no other control in this platform applies
                to it.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>AI tools seen on endpoints</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-muted)]">
                      <th className="px-4 py-2 font-medium">Tool</th>
                      <th className="px-4 py-2 font-medium">Category</th>
                      <th className="px-4 py-2 font-medium">Devices</th>
                      <th className="px-4 py-2 font-medium">Seen via</th>
                      <th className="px-4 py-2 font-medium">Activity</th>
                      <th className="px-4 py-2 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tools.map((tool) => (
                      <tr
                        key={tool.toolName}
                        className="border-b border-[var(--border-subtle)] last:border-0"
                      >
                        <td className="px-4 py-2">
                          <div className="text-[var(--text-primary)]">{tool.toolName}</div>
                          {tool.vendor && (
                            <div className="text-xs text-[var(--text-muted)]">{tool.vendor}</div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-[var(--text-secondary)]">
                          {categoryLabel(tool.category)}
                        </td>
                        <td className="px-4 py-2 text-[var(--text-primary)]">
                          {tool.deviceCount}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {tool.signals.map((signal) => (
                              <Badge
                                key={signal}
                                variant={signal === "runtime" ? "high" : "outline"}
                              >
                                {signalLabel(signal)}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-[var(--text-secondary)]">
                          {tool.observations.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-[var(--text-muted)]">
                          {formatDateTime(tool.lastSeenAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Devices</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-muted)]">
                      <th className="px-4 py-2 font-medium">Device</th>
                      <th className="px-4 py-2 font-medium">Person</th>
                      <th className="px-4 py-2 font-medium">Platform</th>
                      <th className="px-4 py-2 font-medium">Agent</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Detections</th>
                      <th className="px-4 py-2 font-medium">Last report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device) => {
                      const stale = isStale(device, now);
                      return (
                        <tr
                          key={device.id}
                          className="border-b border-[var(--border-subtle)] last:border-0"
                        >
                          <td className="px-4 py-2">
                            <Link
                              href={`/oversight/endpoints/${device.id}`}
                              className="text-[var(--accent)] hover:underline"
                            >
                              {device.hostname}
                            </Link>
                            {device.degradedCollectors.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {device.degradedCollectors.map((d) => (
                                  <Badge key={d.collector} variant="warning">
                                    {collectorLabel(d.collector)}:{" "}
                                    {collectorReasonLabel(d.reason)}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-[var(--text-secondary)]">
                            {device.userEmail ?? (
                              <span className="text-[var(--text-muted)]">Unattributed</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-[var(--text-secondary)]">
                            {device.platform === "darwin" ? "macOS" : "Windows"}
                            {device.osVersion ? ` ${device.osVersion}` : ""}
                          </td>
                          <td className="px-4 py-2 text-[var(--text-muted)]">
                            {device.agentVersion ?? "—"}
                          </td>
                          <td className="px-4 py-2">
                            {device.status === "REVOKED" ? (
                              <Badge variant="critical">Revoked</Badge>
                            ) : stale ? (
                              <Badge variant="warning">Stale</Badge>
                            ) : (
                              <Badge variant="success">Active</Badge>
                            )}
                          </td>
                          <td className="px-4 py-2 text-[var(--text-primary)]">
                            {device.detectionCount}
                          </td>
                          <td className="px-4 py-2 text-[var(--text-muted)]">
                            {device.lastReportAt ? formatDateTime(device.lastReportAt) : "Never"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
