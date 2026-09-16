import { requireRole } from "@/lib/auth-guard";
import { ProxySetupGuide } from "../proxy-setup-guide";
import { getSettingsPageData } from "../data";

export default async function ProxySettingsPage() {
  await requireRole(["ADMIN"]);

  const { proxySecret, platformUrl, azureOpenAIProxy, functionAppName } =
    await getSettingsPageData();

  return (
    <ProxySetupGuide
      proxySecret={proxySecret}
      platformUrl={platformUrl}
      azureOpenAIEndpoint={azureOpenAIProxy.endpoint}
      azureOpenAIDeployments={azureOpenAIProxy.deployments}
      functionAppName={functionAppName}
    />
  );
}
