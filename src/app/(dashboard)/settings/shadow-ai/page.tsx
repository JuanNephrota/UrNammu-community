import Link from "next/link";
import { Building2, Clock, Search } from "lucide-react";
import { requireRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleWorkspaceSettings } from "../google-workspace-settings";
import { NetskopeSettings } from "../netskope-settings";
import { getSettingsPageData } from "../data";

export default async function ShadowAISettingsPage() {
  await requireRole(["ADMIN"]);

  const [{ settingsMap, proxySecret, platformUrl }, lastSuccessfulScan] = await Promise.all([
    getSettingsPageData(),
    prisma.scanHistory.findFirst({
      where: { status: "completed", completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
    }),
  ]);
  const [lastGoogleScan, lastMicrosoftScan] = await Promise.all([
    prisma.scanHistory.findFirst({
      where: {
        scanType: "google_workspace",
        status: "completed",
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
    }),
    prisma.scanHistory.findFirst({
      where: {
        scanType: "microsoft_365",
        status: "completed",
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-4 w-4 text-[var(--accent)]" />
            Shadow AI
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Manage Google Workspace and Microsoft 365 discovery settings for shadow AI detection,
            including admin credentials, tenant apps, and automated scan cadence.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <Link href="/shadow-ai">Open Shadow AI Dashboard</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/settings/users">Open Users &amp; Identity</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--accent)]" />
            Last Successful Scan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lastSuccessfulScan ? (
            <div className="grid gap-3 sm:grid-cols-5">
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">Completed</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">
                  {lastSuccessfulScan.completedAt?.toLocaleString("en-US")}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">Tools Found</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{lastSuccessfulScan.toolsFound}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">New Tools</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{lastSuccessfulScan.newToolsAdded}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">Source</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{lastSuccessfulScan.scanType}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">Updated Tools</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{lastSuccessfulScan.updatedTools}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              No successful shadow AI scan has been recorded yet.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4 text-[var(--accent)]" />
              Google Workspace
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lastGoogleScan ? (
              <p className="text-sm text-[var(--text-secondary)]">
                Last completed {lastGoogleScan.completedAt?.toLocaleString("en-US")} with{" "}
                {lastGoogleScan.toolsFound} tools found and {lastGoogleScan.newToolsAdded} new.
              </p>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                No successful Google Workspace scan recorded yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-[var(--accent)]" />
              Microsoft 365
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lastMicrosoftScan ? (
              <p className="text-sm text-[var(--text-secondary)]">
                Last completed {lastMicrosoftScan.completedAt?.toLocaleString("en-US")} with{" "}
                {lastMicrosoftScan.toolsFound} tools found and {lastMicrosoftScan.newToolsAdded} new.
              </p>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                No successful Microsoft 365 scan recorded yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <NetskopeSettings
        webhookUrl={`${platformUrl}/api/discovered-tools/ingest/netskope`}
        proxySecret={proxySecret}
      />

      <GoogleWorkspaceSettings
        hasServiceKey={!!settingsMap.google_service_account_key}
        adminEmail={settingsMap.google_admin_email ?? ""}
        scanEnabled={settingsMap.google_scan_enabled === "true"}
        lookbackDays={parseInt(settingsMap.google_scan_lookback_days ?? "30", 10)}
        scanIntervalHours={parseInt(settingsMap.google_scan_interval_hours ?? "24", 10)}
        microsoftTenantId={settingsMap.microsoft_shadow_ai_tenant_id ?? ""}
        microsoftClientId={settingsMap.microsoft_shadow_ai_client_id ?? ""}
        hasMicrosoftClientSecret={!!settingsMap.microsoft_shadow_ai_client_secret}
        microsoftScanEnabled={settingsMap.microsoft_shadow_ai_scan_enabled === "true"}
        microsoftScanIntervalHours={parseInt(settingsMap.microsoft_shadow_ai_scan_interval_hours ?? "24", 10)}
      />
    </div>
  );
}
