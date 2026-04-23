"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  Building2,
  Database,
  ExternalLink,
  Eye,
  Gauge,
  Network,
  Search,
  Shield,
  Sparkles,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AIProviderSettings } from "@/app/(dashboard)/settings/ai-provider-settings";
import { AzureMonitorSettings } from "@/app/(dashboard)/settings/azure-monitor-settings";
import { ForgeSkillsSettings } from "@/app/(dashboard)/settings/forge-skills-settings";
import {
  PROVIDERS,
  ProviderSection,
} from "@/app/(dashboard)/settings/admin-api-settings";
import { GeminiBillingSettings } from "./gemini-billing-settings";

type Category =
  | "AI Models"
  | "Provider Telemetry"
  | "AI Gateways"
  | "Identity"
  | "Directory Discovery"
  | "Observability"
  | "Skills";

const CATEGORY_ORDER: Category[] = [
  "AI Models",
  "Provider Telemetry",
  "AI Gateways",
  "Identity",
  "Directory Discovery",
  "Observability",
  "Skills",
];

interface IntegrationTile {
  id: string;
  category: Category;
  name: string;
  description: string;
  icon: LucideIcon;
  connected: boolean;
  statusLabel?: string;
}

export interface IntegrationsGridProps {
  aiProvider: { currentProvider: string; currentModel: string; hasApiKey: boolean };
  hasAnthropicAdminKey: boolean;
  hasOpenAIAdminKey: boolean;
  hasOpenRouterKey: boolean;
  hasHeliconeKey: boolean;
  hasPortkeyKey: boolean;
  hasGeminiBillingConfig: boolean;
  geminiBilling: {
    projectId: string;
    dataset: string;
    table: string;
    location: string;
    hasServiceAccountKey: boolean;
  };
  azureMonitor: {
    subscriptionId: string;
    resourceGroup: string;
    functionAppName: string;
    region: string;
    hasTenantId: boolean;
    hasClientId: boolean;
    hasClientSecret: boolean;
  };
  forgeSkills: {
    baseUrl: string;
    hasApiKey: boolean;
    syncEnabled: boolean;
    lastSince: string | null;
  };
  googleWorkspaceConnected: boolean;
  microsoftShadowAIConnected: boolean;
  googleSignInConnected: boolean;
  microsoftSignInConnected: boolean;
}

export function IntegrationsGrid(props: IntegrationsGridProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  const tiles: IntegrationTile[] = [
    {
      id: "internal-ai",
      category: "AI Models",
      name: "Internal AI Provider",
      description: "Model used for risk assessments, classification, and compliance summarization.",
      icon: Sparkles,
      connected: props.aiProvider.hasApiKey,
      statusLabel: `${props.aiProvider.currentProvider === "openai" ? "OpenAI" : "Anthropic"} · ${props.aiProvider.currentModel}`,
    },
    {
      id: "anthropic-admin",
      category: "Provider Telemetry",
      name: "Anthropic Admin API",
      description: "Organization usage, workspace members, API key inventory, and audit logs from Anthropic.",
      icon: Eye,
      connected: props.hasAnthropicAdminKey,
    },
    {
      id: "openai-admin",
      category: "Provider Telemetry",
      name: "OpenAI Admin API",
      description: "Organization usage, costs, admin keys, and auto-discovered Assistants.",
      icon: Eye,
      connected: props.hasOpenAIAdminKey,
    },
    {
      id: "gemini-billing",
      category: "Provider Telemetry",
      name: "Google Cloud Billing (Gemini)",
      description: "Gemini and Vertex AI cost data from a BigQuery billing export.",
      icon: Database,
      connected: props.hasGeminiBillingConfig,
    },
    {
      id: "openrouter",
      category: "AI Gateways",
      name: "OpenRouter Activity",
      description: "Daily proxy activity from OpenRouter, normalized into Oversight.",
      icon: Network,
      connected: props.hasOpenRouterKey,
    },
    {
      id: "helicone",
      category: "AI Gateways",
      name: "Helicone Requests",
      description: "Request logs aggregated for third-party proxy oversight.",
      icon: Network,
      connected: props.hasHeliconeKey,
    },
    {
      id: "portkey",
      category: "AI Gateways",
      name: "Portkey Analytics",
      description: "Portkey gateway analytics synced into UrNammu.",
      icon: Network,
      connected: props.hasPortkeyKey,
    },
    {
      id: "google-signin",
      category: "Identity",
      name: "Google Sign-In",
      description: "Google OAuth for UrNammu login.",
      icon: Shield,
      connected: props.googleSignInConnected,
    },
    {
      id: "microsoft-signin",
      category: "Identity",
      name: "Microsoft 365 Sign-In",
      description: "Entra ID / Microsoft 365 SSO for UrNammu login.",
      icon: Shield,
      connected: props.microsoftSignInConnected,
    },
    {
      id: "google-workspace",
      category: "Directory Discovery",
      name: "Google Workspace",
      description: "OAuth app audit for shadow AI discovery across Google Workspace.",
      icon: Search,
      connected: props.googleWorkspaceConnected,
    },
    {
      id: "microsoft-tenant",
      category: "Directory Discovery",
      name: "Microsoft 365 Tenant Apps",
      description: "Entra ID tenant app discovery for Microsoft 365 shadow AI.",
      icon: Building2,
      connected: props.microsoftShadowAIConnected,
    },
    {
      id: "azure-monitor",
      category: "Observability",
      name: "Azure Monitor",
      description: "Function app metrics, invocation counts, and proxy health signals.",
      icon: Gauge,
      connected:
        !!props.azureMonitor.subscriptionId &&
        !!props.azureMonitor.functionAppName &&
        props.azureMonitor.hasClientSecret,
    },
    {
      id: "forge",
      category: "Skills",
      name: "Forge Skills",
      description: "Syncs the Forge skill catalog into the AI Skills registry.",
      icon: Bot,
      connected: props.forgeSkills.hasApiKey,
    },
  ];

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    tiles: tiles.filter((t) => t.category === category),
  })).filter((group) => group.tiles.length > 0);

  const active = tiles.find((t) => t.id === openId) ?? null;

  return (
    <div className="space-y-8">
      {grouped.map((group) => (
        <section key={group.category} className="space-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-faint)]">
              {group.category}
            </h2>
            <span className="text-[11px] text-[var(--text-faint)]">
              {group.tiles.filter((t) => t.connected).length}/{group.tiles.length} connected
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.tiles.map((tile) => (
              <IntegrationCard
                key={tile.id}
                tile={tile}
                onOpen={() => setOpenId(tile.id)}
              />
            ))}
          </div>
        </section>
      ))}

      <Dialog open={!!active} onOpenChange={(open) => !open && setOpenId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <active.icon className="h-4 w-4 text-[var(--accent)]" />
                  {active.name}
                </DialogTitle>
                <DialogDescription>{active.description}</DialogDescription>
              </DialogHeader>
              <div className="pt-2">{renderModalBody(active.id, props)}</div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IntegrationCard({
  tile,
  onOpen,
}: {
  tile: IntegrationTile;
  onOpen: () => void;
}) {
  const Icon = tile.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left transition-all hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)]">
            <Icon className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {tile.name}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)] line-clamp-2">
              {tile.description}
            </p>
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--text-faint)] group-hover:text-[var(--accent)]" />
      </div>
      <div className="mt-3 flex items-center justify-between">
        {tile.connected ? (
          <div className="inline-flex items-center gap-1.5 text-[11px] text-[var(--success)]">
            <Wifi className="h-3 w-3" /> Connected
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
            <WifiOff className="h-3 w-3" /> Not configured
          </div>
        )}
        {tile.statusLabel && (
          <Badge variant="outline" className="text-[10px]">
            {tile.statusLabel}
          </Badge>
        )}
      </div>
    </button>
  );
}

function renderModalBody(id: string, props: IntegrationsGridProps) {
  switch (id) {
    case "internal-ai":
      return (
        <AIProviderSettings
          currentProvider={props.aiProvider.currentProvider}
          currentModel={props.aiProvider.currentModel}
          hasApiKey={props.aiProvider.hasApiKey}
        />
      );
    case "anthropic-admin":
      return renderProviderSection("anthropic", props.hasAnthropicAdminKey);
    case "openai-admin":
      return renderProviderSection("openai", props.hasOpenAIAdminKey);
    case "openrouter":
      return renderProviderSection("openrouter", props.hasOpenRouterKey);
    case "helicone":
      return renderProviderSection("helicone", props.hasHeliconeKey);
    case "portkey":
      return renderProviderSection("portkey", props.hasPortkeyKey);
    case "gemini-billing":
      return <GeminiBillingSettings initial={props.geminiBilling} />;
    case "azure-monitor":
      return <AzureMonitorSettings initial={props.azureMonitor} />;
    case "forge":
      return <ForgeSkillsSettings initial={props.forgeSkills} />;
    case "google-signin":
    case "microsoft-signin":
      return (
        <LinkOutBody
          href="/settings/users"
          label="Open Users & Identity"
          explanation="Sign-in provider configuration lives alongside user management."
        />
      );
    case "google-workspace":
    case "microsoft-tenant":
      return (
        <LinkOutBody
          href="/settings/shadow-ai"
          label="Open Shadow AI settings"
          explanation="Directory discovery settings live with the shadow AI scan configuration so credentials, lookback windows, and scan cadence stay together."
        />
      );
    default:
      return null;
  }
}

function renderProviderSection(providerId: string, hasKey: boolean) {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return null;
  return <ProviderSection provider={{ ...provider, hasKey }} />;
}

function LinkOutBody({
  href,
  label,
  explanation,
}: {
  href: string;
  label: string;
  explanation: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">{explanation}</p>
      <Button asChild variant="outline" size="sm">
        <Link href={href} className="inline-flex items-center gap-2">
          <ExternalLink className="h-3.5 w-3.5" />
          {label}
        </Link>
      </Button>
    </div>
  );
}

