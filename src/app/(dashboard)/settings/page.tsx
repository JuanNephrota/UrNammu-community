import Link from "next/link";
import {
  ArrowRight,
  Cog,
  Cpu,
  Eye,
  KeyRound,
  Search,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSettingsPageData } from "./data";

export default async function SettingsOverviewPage() {
  const {
    isAdmin,
    providerLabel,
    modelLabel,
    users,
    hasAnthropicAdminKey,
    hasOpenAIAdminKey,
    settingsMap,
  } = await getSettingsPageData();

  const cards = [
    {
      href: "/settings/general",
      title: "General",
      description: "Environment details and default AI provider settings.",
      icon: Cpu,
      badge: `${providerLabel} · ${modelLabel}`,
      visible: true,
    },
    {
      href: "/settings/provider-admin",
      title: "Provider Admin APIs",
      description: "Admin telemetry keys and background provider sync cadence.",
      icon: Eye,
      badge: `${Number(hasAnthropicAdminKey) + Number(hasOpenAIAdminKey)} connected`,
      visible: isAdmin,
    },
    {
      href: "/settings/proxy",
      title: "Proxy Setup",
      description: "Claude and OpenAI proxy routing instructions and shared secret setup.",
      icon: KeyRound,
      badge: "Developer routing",
      visible: isAdmin,
    },
    {
      href: "/settings/users",
      title: "Users & Identity",
      description: "Current users, roles, local auth, Microsoft 365, and Google sign-in.",
      icon: Shield,
      badge: `${users.length} users · identity controls`,
      visible: isAdmin,
    },
    {
      href: "/settings/shadow-ai",
      title: "Shadow AI",
      description: "Google Workspace discovery, service account setup, and scan cadence.",
      icon: Search,
      badge: `${settingsMap.google_scan_enabled === "true" ? "Google auto-scan on" : "Google manual"} · shadow AI`,
      visible: isAdmin,
    },
  ].filter((card) => card.visible);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cog className="h-4 w-4 text-[var(--accent)]" />
            Settings Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Settings are now split into focused pages so it is easier to manage integrations,
            security controls, and operational defaults without scrolling through one long form.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 transition-all hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-[var(--accent)]" />
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                      {card.title}
                    </h2>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
                    {card.description}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />
              </div>
              <div className="mt-4">
                <Badge variant="outline">{card.badge}</Badge>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
