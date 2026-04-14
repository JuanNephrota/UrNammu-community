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
    glow: "shadow-[0_0_30px_-5px] shadow-emerald-500/15",
    accent: "var(--success)",
    border: "rgba(16, 185, 129, 0.15)",
  },
  warning: {
    icon: "text-[var(--warning)]",
    glow: "shadow-[0_0_30px_-5px] shadow-amber-500/15",
    accent: "var(--warning)",
    border: "rgba(245, 158, 11, 0.15)",
  },
  danger: {
    icon: "text-[var(--critical)]",
    glow: "shadow-[0_0_30px_-5px] shadow-red-500/15",
    accent: "var(--critical)",
    border: "rgba(239, 68, 68, 0.15)",
  },
  info: {
    icon: "text-[var(--accent)]",
    glow: "shadow-[0_0_30px_-5px] shadow-cyan-500/15",
    accent: "var(--accent)",
    border: "rgba(34, 211, 238, 0.15)",
  },
};

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

      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            {title}
          </p>
          <p
            className="text-3xl font-bold tracking-tight text-[var(--text-primary)] tabular-nums"
            style={{ fontFamily: "var(--font-display)" }}
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
