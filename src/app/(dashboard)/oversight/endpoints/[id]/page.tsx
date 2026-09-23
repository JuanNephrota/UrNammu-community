import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import {
  collectorLabel,
  collectorReasonLabel,
  isStale,
  signalLabel,
} from "@/lib/endpoint-fleet";
import { ENDPOINT_COLLECTORS } from "@/lib/endpoint-agent";
import { categoryLabel } from "@/lib/ai-tools-registry";
import { formatDateTime } from "@/lib/utils";
import { EndpointDeviceActions } from "@/components/oversight/endpoint-device-actions";
import { getSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];

export default async function EndpointDevicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [device, session] = await Promise.all([
    prisma.endpointDevice.findUnique({
      where: { id },
      include: { detections: { orderBy: [{ signal: "asc" }, { lastSeenAt: "desc" }] } },
    }),
    getSession(),
  ]);

  if (!device) notFound();

  const canManage = Boolean(session && MANAGE_ROLES.includes(session.user.role));
  const stale = isStale(device);
  const collectorStatus = (device.collectorStatus ?? {}) as Record<
    string,
    { ok?: boolean; reason?: string; itemsScanned?: number }
  >;

  const bySignal = new Map<string, typeof device.detections>();
  for (const detection of device.detections) {
    const list = bySignal.get(detection.signal) ?? [];
    list.push(detection);
    bySignal.set(detection.signal, list);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={device.hostname}
        description={`${device.platform === "darwin" ? "macOS" : "Windows"}${
          device.osVersion ? ` ${device.osVersion}` : ""
        }${device.userEmail ? ` · ${device.userEmail}` : " · unattributed"} · agent ${
          device.agentVersion ?? "unknown"
        }`}
      >
        {canManage && (
          <EndpointDeviceActions deviceId={device.id} status={device.status} />
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {device.status === "REVOKED" ? (
          <Badge variant="critical">Revoked</Badge>
        ) : stale ? (
          <Badge variant="warning">Stale</Badge>
        ) : (
          <Badge variant="success">Active</Badge>
        )}
        <span className="text-sm text-[var(--text-muted)]">
          Enrolled {formatDateTime(device.enrolledAt)} · last report{" "}
          {device.lastReportAt ? formatDateTime(device.lastReportAt) : "never"}
        </span>
      </div>

      {device.statusReason && (
        <Card>
          <CardContent className="py-3 text-sm text-[var(--text-secondary)]">
            {device.statusReason}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Collector health</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ENDPOINT_COLLECTORS.map((collector) => {
            const status = collectorStatus[collector];
            const ran = status?.ok === true;
            const partial = ran && Boolean(status?.reason);
            return (
              <div
                key={collector}
                className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-primary)]">
                    {collectorLabel(collector)}
                  </span>
                  {!status ? (
                    <Badge variant="outline">Off</Badge>
                  ) : partial ? (
                    <Badge variant="warning">Partial</Badge>
                  ) : ran ? (
                    <Badge variant="success">OK</Badge>
                  ) : (
                    <Badge variant="medium">Skipped</Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  {status?.reason
                    ? collectorReasonLabel(status.reason)
                    : status?.itemsScanned !== undefined
                      ? `${status.itemsScanned.toLocaleString()} items scanned`
                      : "No data"}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {[...bySignal.entries()].map(([signal, detections]) => (
        <Card key={signal}>
          <CardHeader>
            <CardTitle>
              {signalLabel(signal)} ({detections.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-muted)]">
                    <th className="px-4 py-2 font-medium">Tool</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 font-medium">Evidence</th>
                    <th className="px-4 py-2 font-medium">Activity</th>
                    <th className="px-4 py-2 font-medium">First seen</th>
                    <th className="px-4 py-2 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {detections.map((detection) => {
                    const detail = (detection.detail ?? {}) as Record<string, unknown>;
                    const models = Array.isArray(detail.models)
                      ? (detail.models as string[])
                      : [];
                    return (
                      <tr
                        key={detection.id}
                        className="border-b border-[var(--border-subtle)] last:border-0"
                      >
                        <td className="px-4 py-2">
                          <div className="text-[var(--text-primary)]">
                            {detection.toolName}
                          </div>
                          {detection.vendor && (
                            <div className="text-xs text-[var(--text-muted)]">
                              {detection.vendor}
                            </div>
                          )}
                          {!detection.matchConfidence && (
                            // Unmatched observations stay on the device and are
                            // deliberately kept out of Shadow AI — one laptop's
                            // unrecognized app name is not fleet-wide evidence.
                            <Badge variant="outline" className="mt-1">
                              Unclassified
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2 text-[var(--text-secondary)]">
                          {categoryLabel(detection.category)}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-[var(--text-secondary)]">
                          {detection.evidence || "—"}
                          {models.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {models.slice(0, 8).map((model) => (
                                <Badge key={model} variant="info">
                                  {model}
                                </Badge>
                              ))}
                              {models.length > 8 && (
                                <span className="text-[var(--text-muted)]">
                                  +{models.length - 8} more
                                </span>
                              )}
                            </div>
                          )}
                          {typeof detail.browser === "string" && (
                            <div className="mt-1 text-[var(--text-muted)]">
                              {detail.browser}
                            </div>
                          )}
                          {detection.signal === "mcp" && (
                            <div className="mt-1 flex flex-wrap items-center gap-1 font-sans text-[var(--text-muted)]">
                              {typeof detail.clientLabel === "string" && (
                                <span>{detail.clientLabel}</span>
                              )}
                              {typeof detail.transport === "string" && (
                                <Badge variant="outline">{detail.transport}</Badge>
                              )}
                              {typeof detail.known === "string" ? (
                                <Badge variant="info">{detail.known}</Badge>
                              ) : detail.risk === "unknown_remote" ? (
                                <Badge variant="warning">Unrecognized remote host</Badge>
                              ) : detail.risk === "unknown_package" ? (
                                <Badge variant="warning">Unrecognized package</Badge>
                              ) : detail.risk === "bridge" ? (
                                <Badge variant="warning">Bridge to unseen remote</Badge>
                              ) : null}
                            </div>
                          )}
                          {detection.signal === "framework" &&
                            typeof detail.environments === "number" && (
                              <div className="mt-1 font-sans text-[var(--text-muted)]">
                                {detail.environments} environment
                                {detail.environments === 1 ? "" : "s"}
                              </div>
                            )}
                        </td>
                        <td className="px-4 py-2 text-[var(--text-secondary)]">
                          {detection.observations.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-[var(--text-muted)]">
                          {formatDateTime(detection.firstSeenAt)}
                        </td>
                        <td className="px-4 py-2 text-[var(--text-muted)]">
                          {formatDateTime(detection.lastSeenAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      {device.detections.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-[var(--text-secondary)]">
            No AI activity observed on this device yet.
          </CardContent>
        </Card>
      )}

      <div>
        <Link
          href="/oversight/endpoints"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          &larr; All endpoints
        </Link>
      </div>
    </div>
  );
}
