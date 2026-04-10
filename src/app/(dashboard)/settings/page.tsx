import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GoogleWorkspaceSettings } from "./google-workspace-settings";
import { ProxySetupGuide } from "./proxy-setup-guide";

export default async function SettingsPage() {
  let isAdmin = false;
  try {
    await requireRole(["ADMIN"]);
    isAdmin = true;
  } catch {
    // not admin
  }

  const users = isAdmin
    ? await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          createdAt: true,
        },
      })
    : [];

  // Load current Google settings for the form
  const googleSettings = isAdmin
    ? await prisma.appSetting.findMany({
        where: {
          key: {
            in: [
              "google_service_account_key",
              "google_admin_email",
              "google_scan_enabled",
              "google_scan_lookback_days",
            ],
          },
        },
      })
    : [];

  const settingsMap: Record<string, string> = {};
  for (const s of googleSettings) {
    settingsMap[s.key] = s.value;
  }

  // Load proxy secret for the setup guide
  const proxySecret = isAdmin
    ? (await prisma.appSetting.findUnique({ where: { key: "proxy_secret" } }))?.value
      ?? process.env.PROXY_SECRET
      ?? "change-me-proxy-secret"
    : "";
  const platformUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3001";

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Platform configuration and integrations" />

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          {isAdmin && <TabsTrigger value="integrations">Integrations</TabsTrigger>}
          {isAdmin && <TabsTrigger value="users">Users</TabsTrigger>}
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader><CardTitle>Environment</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Platform</dt>
                  <dd className="font-medium">Nammu v1.0</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Database</dt>
                  <dd className="font-medium">PostgreSQL</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">AI Provider</dt>
                  <dd className="font-medium">Anthropic Claude</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="integrations" className="space-y-8">
            <ProxySetupGuide
              proxySecret={proxySecret}
              platformUrl={platformUrl}
            />
            <div className="border-t border-[var(--border-subtle)] pt-8" />
            <GoogleWorkspaceSettings
              hasServiceKey={!!settingsMap.google_service_account_key}
              adminEmail={settingsMap.google_admin_email ?? ""}
              scanEnabled={settingsMap.google_scan_enabled === "true"}
              lookbackDays={parseInt(settingsMap.google_scan_lookback_days ?? "30")}
            />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="users">
            <Card>
              <CardHeader><CardTitle>Users ({users.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {users.map((user) => (
                    <div key={user.id} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                      <div>
                        <p className="text-sm font-medium">{user.name ?? user.email}</p>
                        <p className="text-xs text-[var(--text-muted)]">{user.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {user.department && <Badge variant="outline">{user.department}</Badge>}
                        <Badge variant="info">{user.role.replace("_", " ")}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
