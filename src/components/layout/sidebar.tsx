"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Database,
  Bot,
  Search,
  ShieldAlert,
  ShieldCheck,
  Eye,
  FileCheck,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
  Terminal,
  MousePointer2,
  Building2,
  Presentation,
  Activity,
  Network,
  BarChart3,
  Cpu,
  ScanSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const navItems = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "Executive", href: "/executive", icon: Presentation },
      { name: "Reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "Registry",
    items: [
      { name: "AI Systems", href: "/registry", icon: Database },
      { name: "AI Agents", href: "/agents", icon: Bot },
    ],
  },
  {
    label: "Governance",
    items: [
      { name: "Shadow AI", href: "/shadow-ai", icon: Search },
      { name: "Sensitive Scan", href: "/sensitive-scan", icon: ScanSearch },
      { name: "Provider Security", href: "/oversight/provider-security", icon: ShieldCheck },
      { name: "Risk Center", href: "/risk-center", icon: ShieldAlert },
      { name: "AI Oversight", href: "/oversight", icon: Eye },
      { name: "Investigations", href: "/oversight/investigations", icon: Bell },
      { name: "Vendor Governance", href: "/oversight/vendors", icon: Building2 },
      { name: "Claude Platform", href: "/oversight/claude-platform", icon: Cpu },
      { name: "Claude Code", href: "/oversight/claude-code", icon: Terminal },
      { name: "Cowork", href: "/oversight/cowork", icon: Bot },
      { name: "Cursor", href: "/oversight/cursor", icon: MousePointer2 },
      { name: "Compliance", href: "/compliance", icon: FileCheck },
    ],
  },
  {
    label: "System",
    items: [
      { name: "Alerts", href: "/alerts", icon: Bell },
      { name: "Proxy Health", href: "/proxy-health", icon: Activity },
      { name: "Integrations", href: "/integrations", icon: Network },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-base)] transition-all duration-300 ease-in-out relative",
        collapsed ? "w-[68px]" : "w-[260px]"
      )}
    >
      {/* Subtle right edge glow */}
      <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-[var(--accent)]/10 to-transparent" />

      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-[var(--border-subtle)] px-4">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <Image
              src="/urnammu_logo_dark.png"
              alt="UrNammu"
              width={28}
              height={28}
              className="shrink-0 transition-all group-hover:drop-shadow-[0_0_8px_var(--accent-glow)]"
            />
            <Image
              src="/urnammu_wordmark_dark.png"
              alt="UrNammu"
              width={100}
              height={24}
              className="transition-all group-hover:opacity-90"
            />
          </Link>
        )}
        {collapsed && (
          <Link href="/dashboard" className="mx-auto group">
            <Image
              src="/urnammu_logo_dark.png"
              alt="UrNammu"
              width={28}
              height={28}
              className="transition-all group-hover:drop-shadow-[0_0_8px_var(--accent-glow)]"
            />
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors",
            collapsed && "mx-auto"
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-5">
        {navItems.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-faint)]">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200",
                        isActive
                          ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                        collapsed && "justify-center px-2"
                      )}
                      title={collapsed ? item.name : undefined}
                    >
                      {/* Active indicator bar */}
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent-glow)]" />
                      )}
                      <item.icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0 transition-all",
                          isActive && "drop-shadow-[0_0_6px_var(--accent-glow)]"
                        )}
                      />
                      {!collapsed && <span>{item.name}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom status */}
      {!collapsed && (
        <div className="border-t border-[var(--border-subtle)] p-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[var(--success)] shadow-[0_0_6px_var(--success)]" />
            <span className="text-[11px] text-[var(--text-faint)]">All systems operational</span>
          </div>
        </div>
      )}
    </aside>
  );
}
