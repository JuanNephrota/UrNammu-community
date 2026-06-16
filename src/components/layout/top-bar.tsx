"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Bell, LogOut, User, Activity, ExternalLink } from "lucide-react";
import { HelpTrigger } from "@/components/help/help-trigger";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Badge, riskBadgeVariant } from "@/components/ui/badge";

type Alert = {
  id: string;
  title: string;
  severity: string;
  source: string;
  status: string;
  createdAt: string;
};

type WorkflowNotification = {
  id: string;
  title: string;
  detail: string;
  href: string;
  category: string;
  createdAt: string;
  tone: "critical" | "warning" | "info";
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function severityDot(severity: string): string {
  switch (severity) {
    case "CRITICAL": return "var(--critical)";
    case "HIGH": return "var(--high)";
    case "MEDIUM": return "var(--warning)";
    default: return "var(--text-muted)";
  }
}

export function TopBar() {
  const { data: session } = useSession();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [workflowNotifications, setWorkflowNotifications] = useState<WorkflowNotification[]>([]);
  const [openCount, setOpenCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchAlerts = async () => {
      try {
        const [alertRes, notificationRes] = await Promise.all([
          fetch("/api/alerts?status=OPEN"),
          fetch("/api/workflow-notifications"),
        ]);
        if (cancelled) return;
        let alertCount = 0;
        let workflowCount = 0;
        if (alertRes.ok) {
          const data = await alertRes.json();
          if (cancelled) return;
          setAlerts(data.slice(0, 6));
          alertCount = Array.isArray(data) ? data.length : 0;
        }
        if (notificationRes.ok) {
          const notifications = await notificationRes.json();
          if (cancelled) return;
          const workflowItems = Array.isArray(notifications) ? notifications : [];
          setWorkflowNotifications(workflowItems.slice(0, 6));
          workflowCount = workflowItems.length;
        }
        setOpenCount(alertCount + workflowCount);
      } catch {
        // silently fail
      }
    };

    fetchAlerts();
    // Poll every 30 seconds for new alerts
    const interval = setInterval(fetchAlerts, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/80 backdrop-blur-md px-6">
      {/* Left: live status indicator. Pulse only when there's something new to convey
          (open alerts or workflow notifications); otherwise remain calm. */}
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-faint)]">
        <Activity
          className={openCount > 0 ? "h-3.5 w-3.5 text-[var(--accent)]" : "h-3.5 w-3.5 text-[var(--text-muted)]"}
          style={openCount > 0 ? { animation: "pulseGlow 2s ease-in-out infinite" } : undefined}
        />
        <span className="hidden sm:inline">Governance Monitoring Active</span>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-3">
        <HelpTrigger />

        {/* Alerts dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="relative rounded-lg p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors outline-none">
            <Bell className="h-[18px] w-[18px]" />
            {openCount > 0 && (
              <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--critical)] opacity-40" />
                <span className="relative inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--critical)] px-1 text-[10px] font-bold text-white">
                  {openCount > 99 ? "99+" : openCount}
                </span>
              </span>
            )}
          </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Workflow Activity</span>
              {openCount > 0 && (
                <Badge variant="critical">{openCount}</Badge>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {alerts.length === 0 && workflowNotifications.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-sm font-medium text-[var(--success)]">All clear</p>
                <p className="text-xs text-[var(--text-faint)] mt-0.5">No open alerts</p>
              </div>
            ) : (
              <>
                {workflowNotifications.length > 0 && (
                  <>
                    <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
                      Notifications
                    </DropdownMenuLabel>
                    {workflowNotifications.map((item) => (
                      <DropdownMenuItem key={item.id} asChild>
                        <Link href={item.href} className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer">
                          <div
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                            style={{
                              backgroundColor:
                                item.tone === "critical"
                                  ? "var(--critical)"
                                  : item.tone === "warning"
                                    ? "var(--warning)"
                                    : "var(--accent)",
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-[var(--text-primary)] truncate">
                              {item.title}
                            </p>
                            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                              {item.category} &middot; {timeAgo(item.createdAt)}
                            </p>
                          </div>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                {alerts.length > 0 && (
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
                    Open Alerts
                  </DropdownMenuLabel>
                )}
                {alerts.map((alert) => (
                  <DropdownMenuItem key={alert.id} asChild>
                    <Link href="/alerts" className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer">
                      <div
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: severityDot(alert.severity),
                          boxShadow: alert.severity === "CRITICAL" ? `0 0 6px ${severityDot(alert.severity)}` : "none",
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-[var(--text-primary)] truncate">
                          {alert.title}
                        </p>
                        <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                          {alert.source} &middot; {timeAgo(alert.createdAt)}
                        </p>
                      </div>
                      <Badge variant={riskBadgeVariant(alert.severity)} className="shrink-0 mt-0.5">
                        {alert.severity}
                      </Badge>
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/alerts" className="flex items-center justify-center gap-1.5 py-2 text-xs text-[var(--accent)]">
                    View all alerts <ExternalLink className="h-3 w-3" />
                  </Link>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="h-5 w-px bg-[var(--border-subtle)]" />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-hover)] transition-colors outline-none">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-dim)] ring-1 ring-[var(--accent-border)]">
              {session?.user?.image ? (
                <Image
                  src={session.user.image}
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 rounded-full"
                />
              ) : (
                <User className="h-3.5 w-3.5 text-[var(--accent)]" />
              )}
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-[13px] font-medium text-[var(--text-primary)] leading-tight">
                {session?.user?.name ?? "User"}
              </p>
              <p className="text-[11px] text-[var(--accent)] font-semibold uppercase tracking-wider">
                {session?.user?.role?.replace("_", " ") ?? "VIEWER"}
              </p>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="text-sm text-[var(--text-primary)]">{session?.user?.name}</p>
              <p className="text-xs text-[var(--text-muted)]">{session?.user?.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
