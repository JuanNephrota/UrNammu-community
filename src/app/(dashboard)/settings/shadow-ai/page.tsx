import Link from "next/link";
import { Clock, Search } from "lucide-react";
import { requireRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleWorkspaceSettings } from "../google-workspace-settings";
import { getSettingsPageData } from "../data";

export default async function ShadowAISettingsPage() {
  await requireRole(["ADMIN"]);

  const [{ settingsMap }, lastSuccessfulScan] = await Promise.all([
    getSettingsPageData(),
    prisma.scanHistory.findFirst({
      where: { status: "completed", completedAt: { not: null } },
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
            Manage Google Workspace discovery settings for shadow AI detection, including the
            service account, admin delegation, and automated scan cadence.
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
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">Completed</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">
                  {lastSuccessfulScan.completedAt?.toLocaleString()}
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
                <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">Updated Tools</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{lastSuccessfulScan.updatedTools}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              No successful Google Workspace scan has been recorded yet.
            </p>
          )}
        </CardContent>
      </Card>

      <GoogleWorkspaceSettings
        hasServiceKey={!!settingsMap.google_service_account_key}
        adminEmail={settingsMap.google_admin_email ?? ""}
        scanEnabled={settingsMap.google_scan_enabled === "true"}
        lookbackDays={parseInt(settingsMap.google_scan_lookback_days ?? "30", 10)}
        scanIntervalHours={parseInt(settingsMap.google_scan_interval_hours ?? "24", 10)}
      />
    </div>
  );
}
