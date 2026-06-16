"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  Database,
  Bot,
  ShieldAlert,
  Bell,
  Eye,
  FileCheck,
  DollarSign,
  AlertTriangle,
  Activity,
  MousePointer2,
  Wrench,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  Database,
  Bot,
  ShieldAlert,
  Bell,
  Eye,
  FileCheck,
  DollarSign,
  AlertTriangle,
  Activity,
  MousePointer2,
  Wrench,
};

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  iconName: string;
  href?: string;
  trend?: { value: number; label: string };
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

const variantConfig = {
  default: {
    icon: "text-[var(--text-muted)]",
    glow: "",
    accent: "var(--text-muted)",
    border: "var(--border-subtle)",
  },
  success: {
    icon: "text-[var(--success)]",
    glow: "shadow-[0_0_30px_-5px_var(--success-halo)]",
    accent: "var(--success)",
    border: "var(--success-halo)",
  },
  warning: {
    icon: "text-[var(--warning)]",
    glow: "shadow-[0_0_30px_-5px_var(--warning-halo)]",
    accent: "var(--warning)",
    border: "var(--warning-halo)",
  },
  danger: {
    icon: "text-[var(--critical)]",
    glow: "shadow-[0_0_30px_-5px_var(--critical-halo)]",
    accent: "var(--critical)",
    border: "var(--critical-halo)",
  },
  info: {
    icon: "text-[var(--accent)]",
    glow: "shadow-[0_0_30px_-5px_var(--accent-halo)]",
    accent: "var(--accent)",
    border: "var(--accent-halo)",
  },
};

// Auto-scale the value's font size so long numbers (e.g. formatted token counts
// like "2,145,678,901") don't overrun narrow cards in dense grids such as
// oversight's lg:grid-cols-8 layout.
function valueSizeClass(value: string | number): string {
  const len = String(value).length;
  if (len <= 6) return "text-3xl";
  if (len <= 9) return "text-2xl";
  if (len <= 12) return "text-xl";
  return "text-lg";
}

export function StatCard({
  title,
  value,
  description,
  iconName,
  href,
  trend,
  variant = "default",
}: StatCardProps) {
  const config = variantConfig[variant];
  const Icon = iconMap[iconName] ?? ShieldAlert;

  const content = (
    <>
      {/* Top accent line */}
      <div
        className="absolute inset-x-0 top-0 h-px rounded-t-xl"
        style={{
          background: `linear-gradient(90deg, transparent, ${config.accent}, transparent)`,
          opacity: 0.5,
        }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            {title}
          </p>
          <p
            className={cn(
              "font-bold tracking-tight text-[var(--text-primary)] tabular-nums truncate",
              valueSizeClass(value)
            )}
            style={{ fontFamily: "var(--font-display)" }}
            title={String(value)}
          >
            {value}
          </p>
          {description && (
            <p className="text-[11px] text-[var(--text-faint)]">{description}</p>
          )}
          {trend && (
            <p
              className={cn(
                "text-xs font-medium",
                trend.value >= 0 ? "text-[var(--success)]" : "text-[var(--critical)]"
              )}
            >
              {trend.value >= 0 ? "+" : ""}
              {trend.value}% {trend.label}
            </p>
          )}
        </div>
        <div className={cn("mt-1 transition-transform duration-300 group-hover:scale-110", config.icon)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </>
  );

  const sharedClassName = cn(
    "group relative block rounded-xl bg-[var(--bg-surface)] p-5 transition-all duration-300 hover:-translate-y-0.5",
    href && "cursor-pointer hover:bg-[var(--bg-hover)]",
    config.glow
  );
  const sharedStyle = { borderWidth: 1, borderStyle: "solid" as const, borderColor: config.border };

  if (href) {
    return (
      <Link href={href} className={sharedClassName} style={sharedStyle}>
        {content}
      </Link>
    );
  }

  return (
    <div className={sharedClassName} style={sharedStyle}>
      {content}
    </div>
  );
}
