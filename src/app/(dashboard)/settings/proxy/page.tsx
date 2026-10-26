import { requireRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ProxySetupGuide } from "../proxy-setup-guide";
import { NetworkProxySettings } from "../network-proxy-settings";
import { getSettingsPageData } from "../data";

export default async function ProxySettingsPage() {
  await requireRole(["ADMIN"]);

  const { proxySecret, platformUrl, azureOpenAIProxy, functionAppName, networkProxyMode } =
    await getSettingsPageData();

  // Sequential on purpose: the dev server shares one pooled connection.
  const rules = await prisma.networkBlockRule.findMany({
    orderBy: [{ action: "asc" }, { createdAt: "asc" }],
    include: { createdBy: { select: { name: true, email: true } } },
  });
  const recent = await prisma.networkRequestLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      proxy: true,
      method: true,
      host: true,
      path: true,
      action: true,
      status: true,
      rulePattern: true,
      ruleSource: true,
      reason: true,
      userEmail: true,
      createdAt: true,
    },
  });
  const shadowBlockedCount = await prisma.discoveredAITool.count({
    where: { status: "BLOCKED", detectedDomain: { not: null } },
  });

  const base = platformUrl.replace(/\/$/, "");
  return (
    <div className="space-y-6">
      <ProxySetupGuide
        proxySecret={proxySecret}
        platformUrl={platformUrl}
        azureOpenAIEndpoint={azureOpenAIProxy.endpoint}
        azureOpenAIDeployments={azureOpenAIProxy.deployments}
        functionAppName={functionAppName}
      />
      <NetworkProxySettings
        currentMode={networkProxyMode}
        rules={rules.map((r) => ({
          id: r.id,
          pattern: r.pattern,
          action: r.action,
          enabled: r.enabled,
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
          createdBy: r.createdBy,
        }))}
        recent={recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
        vercelBase={`${base}/api/proxy/net`}
        azureBase={functionAppName ? `https://${functionAppName}.azurewebsites.net/api/proxy/net` : ""}
        shadowBlockedCount={shadowBlockedCount}
      />
    </div>
  );
}
