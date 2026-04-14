import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AIProviderSettings } from "../ai-provider-settings";
import { getSettingsPageData } from "../data";

export default async function GeneralSettingsPage() {
  const {
    isAdmin,
    providerLabel,
    modelLabel,
    currentProvider,
    currentModel,
    hasAiKey,
  } = await getSettingsPageData();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Environment</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Platform</dt>
              <dd className="font-medium">UrNammu v1.0</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Database</dt>
              <dd className="font-medium">PostgreSQL</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">AI Provider</dt>
              <dd className="font-medium">{providerLabel} · {modelLabel}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {isAdmin && (
        <AIProviderSettings
          currentProvider={currentProvider}
          currentModel={currentModel}
          hasApiKey={hasAiKey}
        />
      )}
    </div>
  );
}
