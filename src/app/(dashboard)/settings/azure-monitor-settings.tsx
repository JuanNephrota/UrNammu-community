"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface Props {
  initial: {
    subscriptionId: string;
    resourceGroup: string;
    functionAppName: string;
    region: string;
    hasTenantId: boolean;
    hasClientId: boolean;
    hasClientSecret: boolean;
  };
}

/**
 * Settings card for the Azure Monitor integration used by /proxy-health.
 * Plain values (subscription ID, RG, app name, region) are editable.
 * Credential fields are write-only from the UI — we show a "configured"
 * indicator when the setting exists and let the user paste a new value
 * to replace it.
 */
export function AzureMonitorSettings({ initial }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const [subscriptionId, setSubscriptionId] = useState(initial.subscriptionId);
  const [resourceGroup, setResourceGroup] = useState(initial.resourceGroup);
  const [functionAppName, setFunctionAppName] = useState(initial.functionAppName);
  const [region, setRegion] = useState(initial.region);
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  async function handleSave() {
    setSaving(true);
    setResult(null);

    const updates: Record<string, string | null> = {
      azure_subscription_id: subscriptionId.trim() || null,
      azure_resource_group: resourceGroup.trim() || null,
      azure_function_app_name: functionAppName.trim() || null,
      azure_function_app_region: region.trim() || null,
    };
    // Only update credential fields when non-empty — blanking them in the UI
    // is not how you'd clear them (use the separate delete path if we add one).
    if (tenantId.trim()) updates.azure_tenant_id = tenantId.trim();
    if (clientId.trim()) updates.azure_client_id = clientId.trim();
    if (clientSecret.trim()) updates.azure_client_secret = clientSecret.trim();

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const body = await res.json();
        setResult(`Failed: ${body.error ?? res.statusText}`);
      } else {
        setResult("Azure Monitor settings saved.");
        setTenantId("");
        setClientId("");
        setClientSecret("");
        router.refresh();
      }
    } catch {
      setResult("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--accent)]" />
          Azure Monitor (Proxy Health)
        </CardTitle>
        <CardDescription>
          Required for the /proxy-health board to pull Azure Monitor metrics
          from the nammu-ai-proxy Function App. Service-principal credentials
          are only needed in production; local dev uses your Azure CLI login.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="azure-sub">Subscription ID</Label>
            <Input
              id="azure-sub"
              value={subscriptionId}
              onChange={(e) => setSubscriptionId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="azure-rg">Resource Group</Label>
            <Input
              id="azure-rg"
              value={resourceGroup}
              onChange={(e) => setResourceGroup(e.target.value)}
              placeholder="certifid-ai-governance"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="azure-app">Function App Name</Label>
            <Input
              id="azure-app"
              value={functionAppName}
              onChange={(e) => setFunctionAppName(e.target.value)}
              placeholder="nammu-ai-proxy"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="azure-region">Region</Label>
            <Input
              id="azure-region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="eastus"
            />
          </div>
        </div>

        <div className="pt-2 space-y-3 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Service principal (production)
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="azure-tenant">
                Tenant ID {initial.hasTenantId ? <span className="text-[var(--success)]">· set</span> : null}
              </Label>
              <Input
                id="azure-tenant"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder={initial.hasTenantId ? "(configured)" : "00000000-…"}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="azure-client">
                Client ID {initial.hasClientId ? <span className="text-[var(--success)]">· set</span> : null}
              </Label>
              <Input
                id="azure-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={initial.hasClientId ? "(configured)" : "00000000-…"}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="azure-secret">
                Client Secret {initial.hasClientSecret ? <span className="text-[var(--success)]">· set</span> : null}
              </Label>
              <Input
                id="azure-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={initial.hasClientSecret ? "(configured)" : "paste secret"}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <p className="text-[10px] text-[var(--text-faint)]">
            Needs the <strong>Monitoring Reader</strong> role on the function app. Leave empty to use Azure CLI credentials locally.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : "Save Azure Monitor settings"}
          </Button>
          {result ? (
            <p
              className={`text-sm font-medium ${
                result.includes("saved")
                  ? "text-[var(--success)]"
                  : "text-[var(--critical)]"
              }`}
            >
              {result}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
