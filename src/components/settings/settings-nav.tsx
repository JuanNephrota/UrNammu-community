"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Cog,
  Cpu,
  Eye,
  KeyRound,
  Search,
  Shield,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SettingsNavItem = {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const allItems: SettingsNavItem[] = [
  {
    href: "/settings",
    label: "Overview",
    description: "Jump to a settings area quickly",
    icon: Cog,
  },
  {
    href: "/settings/general",
    label: "General",
    description: "Environment and model defaults",
    icon: Cpu,
  },
  {
    href: "/settings/provider-admin",
    label: "Provider Admin APIs",
    description: "Anomaly, governance, and attribution tuning",
    icon: Eye,
  },
  {
    href: "/settings/proxy",
    label: "Proxy Setup",
    description: "Claude and OpenAI proxy routing",
    icon: KeyRound,
  },
  {
    href: "/settings/users",
    label: "Users & Identity",
    description: "Roles, local auth, Microsoft 365, and Google sign-in",
    icon: Shield,
  },
  {
    href: "/settings/shadow-ai",
    label: "Shadow AI",
    description: "Google Workspace discovery and shadow AI scan controls",
    icon: Search,
  },
  {
    href: "/settings/reporting",
    label: "Reporting",
    description: "Email delivery for scheduled reports (Resend)",
    icon: BarChart3,
  },
];

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? allItems : allItems.filter((item) => ["/settings", "/settings/general"].includes(item.href));

  return (
    <div className="overflow-x-auto">
      <nav className="flex min-w-max gap-3 pb-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/settings"
              ? pathname === "/settings"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "min-w-[200px] rounded-xl border px-4 py-3 transition-all",
                isActive
                  ? "border-[var(--accent-border)] bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                <span className="text-sm font-medium">{item.label}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-faint)]">
                {item.description}
              </p>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
